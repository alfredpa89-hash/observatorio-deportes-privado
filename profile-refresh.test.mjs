import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileRefresh } from './public/profile-refresh.js';

function setup(load = async item => item.key) {
  let selection = { key: 'one' }, callbacks = new Map(), next = 0;
  const applied = [], errors = [];
  const refresh = createProfileRefresh({ current: () => selection, load, apply: value => applied.push(value), onError: error => errors.push(error.message),
    schedule: fn => { const id = ++next; callbacks.set(id, fn); return id; }, cancel: id => callbacks.delete(id) });
  return { refresh, applied, errors, select: value => { selection = value; }, timers: () => callbacks.size,
    tick: async () => { const [id, fn] = callbacks.entries().next().value; callbacks.delete(id); await fn(); } };
}
test('background refresh coalesces data events, preserves a visible report until completion and defers while editing', async () => {
  const app = setup(); app.refresh.notify(); app.refresh.notify(); app.refresh.notify(); assert.equal(app.timers(), 1);
  app.select({ key: 'one', defer: true }); await app.tick(); assert.equal(app.applied.length, 0); assert.equal(app.timers(), 1);
  app.select({ key: 'one' }); await app.tick(); assert.deepEqual(app.applied, ['one']);
});
test('changing the selection or invalidating an analysis discards a pending result', async () => {
  let resolve; const app = setup(() => new Promise(done => { resolve = done; }));
  app.refresh.notify(); const running = app.tick(); app.select({ key: 'two' }); resolve('old'); await running; assert.equal(app.applied.length, 0);
  app.refresh.notify(); const second = app.tick(); app.refresh.cancel(); resolve('cancelled'); await second; assert.equal(app.applied.length, 0);
});
test('errors do not replace stored results, and a selection closed before the timer makes no request', async () => {
  let calls = 0; const app = setup(async () => { calls++; throw new Error('failure'); });
  app.refresh.notify(); await app.tick(); assert.deepEqual(app.errors, ['failure']); assert.equal(app.applied.length, 0);
  app.refresh.notify(); app.select(null); await app.tick(); assert.equal(calls, 1);
});
test('editing that begins during a background request postpones replacement until editing ends', async () => {
  let resolve, calls = 0; const app = setup(() => { calls++; return new Promise(done => { resolve = done; }); });
  app.refresh.notify(); const first = app.tick(); app.select({ key: 'one', defer: true }); resolve('first'); await first;
  assert.equal(app.applied.length, 0); assert.equal(app.timers(), 1);
  app.select({ key: 'one' }); const second = app.tick(); resolve('second'); await second;
  assert.equal(calls, 2); assert.deepEqual(app.applied, ['second']);
});
