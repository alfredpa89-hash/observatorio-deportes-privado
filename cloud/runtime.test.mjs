import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { superviseBackend } from './runtime.mjs';
import { createCloudGateway } from './gateway.mjs';

function setup(graceMs = 10000) {
  const backend = new EventEmitter(), exits = [], signals = [], closed = [];
  backend.postMessage = value => { signals.push(value); };
  const gateway = { listening: true, close() { this.listening = false; closed.push('listener'); }, closeIdleConnections() { closed.push('idle'); }, closeAllConnections() { closed.push('all'); } };
  const runtime = superviseBackend(backend, gateway, { exit: code => exits.push(code), graceMs, onFailure: () => {} });
  return { backend, gateway, runtime, exits, signals, closed };
}

test('a stopped or failed worker closes stale connections and exits instead of leaving healthy HTTPS', () => {
  for (const event of ['error', 'exit']) {
    const context = setup();
    context.backend.emit(event, event === 'error' ? Error('worker failure') : 0);
    assert.equal(context.runtime.ready, false); assert.deepEqual(context.exits, [1]);
    assert.equal(context.gateway.listening, false); assert.ok(context.closed.includes('all'));
    context.backend.emit('exit', 1); assert.deepEqual(context.exits, [1]);
  }
});

test('shutdown waits for a normal worker exit but bounds an indefinitely active request', async () => {
  const normal = setup(); normal.runtime.shutdown();
  assert.deepEqual(normal.signals, ['shutdown']); assert.equal(normal.runtime.ready, false);
  assert.deepEqual(normal.exits, []); normal.backend.emit('exit', 0); assert.deepEqual(normal.exits, [0]);
  const stuck = setup(10); stuck.runtime.shutdown();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(stuck.exits, [0]); assert.ok(stuck.closed.includes('all'));
});

test('health and new requests return unavailable while the analysis worker is stopping', async () => {
  let ready = true;
  const gateway = createCloudGateway({ origin: 'https://test.example' }, { backendPort: 1, isReady: () => ready,
    access: async (request, response) => { response.end('healthy'); return false; } });
  try {
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${gateway.address().port}`;
    assert.equal((await fetch(base + '/healthz')).status, 200);
    ready = false;
    for (const path of ['/healthz', '/api/basketball/state']) {
      const response = await fetch(base + path); assert.equal(response.status, 503);
      assert.match((await response.json()).error, /reiniciando/);
    }
  } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
});
