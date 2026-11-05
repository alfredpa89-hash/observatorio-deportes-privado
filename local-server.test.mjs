import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { probeLocalServer, createLocalSupervisor } from './local-server.mjs';
import { startupCommand } from './configure-local-server.mjs';

test('local health never queries a provider, follows a redirect, or adopts another checkout', async () => {
  const root = path.resolve('app'); let calls = 0;
  const request = async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:4173/api/state'); assert.equal(options.redirect, 'error');
    return Response.json({ app: 'observatorio-futbol', appDirectory: root });
  };
  assert.equal((await probeLocalServer({ request, root })).status, 'ready'); assert.equal(calls, 1);
  assert.equal((await probeLocalServer({ root, request: async () => Response.json({ app: 'other', appDirectory: root }) })).status, 'foreign');
  assert.equal((await probeLocalServer({ root, request: async () => Response.json({ app: 'observatorio-futbol', appDirectory: root + '-other' }) })).status, 'foreign');
  assert.equal((await probeLocalServer({ request: async () => new Response('missing', { status: 404 }) })).status, 'foreign');
  assert.equal((await probeLocalServer({ request: async () => new Response('<html>other app</html>') })).status, 'foreign');
  assert.equal((await probeLocalServer({ request: async () => { throw Object.assign(new Error(), { cause: { code: 'ECONNREFUSED' } }); } })).status, 'offline');
  assert.equal((await probeLocalServer({ request: async () => { throw new DOMException('wait', 'TimeoutError'); } })).status, 'unresponsive');
});

test('local supervisor starts once, recovers a stopped process with backoff, and never kills an unresponsive or foreign service', async () => {
  let clock = Date.parse('2026-10-18T20:00:00Z'), state = 'offline', calls = 0, child; const events = [];
  const supervisor = createLocalSupervisor({ now: () => clock, probe: async () => ({ status: state }), record: async row => events.push(row), launch: async () => {
    calls++; child = { exitCode: null, signalCode: null }; return child;
  } });
  await supervisor.step(); assert.equal(calls, 1);
  clock += 1000; await supervisor.step(); assert.equal(calls, 1, 'no duplicate while the first process is starting');
  child.exitCode = 1; await supervisor.step(); assert.equal(events.at(-1).status, 'waiting');
  clock += 30000; await supervisor.step(); assert.equal(calls, 2);
  state = 'ready'; await supervisor.step(); assert.equal(events.at(-1).status, 'running');
  child.exitCode = 1; state = 'offline'; clock += 120000; await supervisor.step(); assert.equal(calls, 3);
  for (state of ['foreign', 'unresponsive']) { await supervisor.step(); assert.equal(events.at(-1).status, state); assert.equal(calls, 3); }
});

test('local checks coalesce and launch failures do not spin or expose process details', async () => {
  let release, calls = 0, clock = Date.parse('2026-10-18T20:00:00Z'); const events = [];
  const supervisor = createLocalSupervisor({ now: () => clock, probe: () => new Promise(resolve => { release = resolve; }), record: async row => events.push(row),
    launch: async () => { calls++; throw new Error('private process detail'); } });
  const first = supervisor.step(); await supervisor.step(); release({ status: 'offline' }); await first;
  assert.equal(calls, 1); assert.equal(events.at(-1).status, 'launch_failed');
  const second = supervisor.step(); release({ status: 'offline' }); await second; assert.equal(calls, 1);
  assert.ok(!JSON.stringify(events).includes('private process detail'));
});

test('startup only invokes a local hidden-child launcher, without credentials or changing PowerShell execution policy', () => {
  const content = startupCommand('C:\\Node Runtime\\node.exe', 'C:\\My Project');
  assert.ok(content.includes('"C:\\Node Runtime\\node.exe"')); assert.match(content, /--background/);
  assert.ok(content.includes('DisableDelayedExpansion')); assert.ok(!/ExecutionPolicy|powershell|api.key|token|password/i.test(content));
  assert.throws(() => startupCommand('node".exe', 'root'), /Ruta/);
  assert.ok(startupCommand('node.exe', 'Project%name').includes('Project%%name'));
});
