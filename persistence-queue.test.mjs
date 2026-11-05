import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescedWriter } from './persistence-queue.mjs';

test('concurrent updates wait for the final durable value without repeating every queued scan', async () => {
  let release, started, state = 0;
  const began = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const saved = [], write = createCoalescedWriter(async () => {
    const captured = state;
    if (!saved.length) { started(); await held; }
    saved.push(captured);
  });
  state = 1; const first = write(); await began;
  const waiting = [];
  for (let index = 2; index <= 20; index++) { state = index; waiting.push(write()); }
  let completed = false; Promise.all(waiting).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false);
  release(); await Promise.all([first, ...waiting]);
  assert.deepEqual(saved, [1, 20]); assert.equal(completed, true);
});

test('all waiting callers see failure; a later explicit request can flush retained changes', async () => {
  let attempts = 0, saved = false;
  const write = createCoalescedWriter(async () => { if (++attempts === 1) throw Error('unavailable'); saved = true; });
  const results = await Promise.allSettled([write(), write(), write()]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(attempts, 1); assert.equal(saved, false);
  await write(); assert.equal(attempts, 2); assert.equal(saved, true);
});
