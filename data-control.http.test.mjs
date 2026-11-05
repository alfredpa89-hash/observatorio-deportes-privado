import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('data control HTTP verifies paid capacity, separates sports, protects backups and never persists keys', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'data-control-http-')), nativeFetch = globalThis.fetch;
  process.env.OBSERVATORIO_DATA_DIR = directory; process.env.PORT = '0'; process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1';
  let calls = 0, server;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
    calls++; assert.equal(url.hostname, 'v1.basketball.api-sports.io'); assert.equal(url.pathname, '/status');
    return Response.json({ response: { account: { email: 'private@example.invalid' }, subscription: { plan: 'Pro', active: true }, requests: { limit_day: 7500, current: 1 } } });
  };
  try {
    server = await (await import(`./server.mjs?data-control-http=${Date.now()}`)).startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, body) => { const response = await nativeFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
    let state = await (await nativeFetch(base + '/api/data/state')).json(); assert.equal(state.policies.basketball.paid, false); assert.equal(calls, 0);
    const readiness = await (await nativeFetch(base + '/api/data/basketball-readiness')).json();
    assert.deepEqual(readiness.leagues.map(row => row.league), ['nba', 'euroleague', 'endesa']);
    assert.equal(readiness.leagues.every(row => row.sampleSize === 0), true);
    assert.equal((await post('/api/data/basketball-check', {})).status, 400); assert.equal(calls, 0);
    const key = 'test-credential-only-123456789'; await post('/api/basketball/key', { key });
    state = await (await nativeFetch(base + '/api/data/state')).json(); assert.equal(state.policies.basketball.paid, false);
    const access = await post('/api/data/verify', { provider: 'basketball' });
    assert.equal(access.status, 200); assert.equal(access.data.policy.paid, true); assert.equal(access.data.policy.dailyBudget, 7500);
    assert.equal(access.data.policy.usable, 6750); assert.equal(access.data.policy.playerLimit, 4500); assert.equal(access.data.policy.teamLimit, 1500);
    assert.equal(JSON.stringify(access).includes('private@example.invalid'), false);
    await post('/api/data/settings', { automatic: { basketball: false, football: false, tennis: false } });
    assert.equal((await post('/api/data/refresh', { automatic: true })).status, 202);
    for (let i = 0; i < 20; i++) { state = await (await nativeFetch(base + '/api/data/state')).json(); if (!state.running) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(calls, 1); assert.equal(state.policies.football.dailyBudget, 100);
    assert.equal((await post('/api/data/visit', {})).status, 202);
    let progress;
    for (let i = 0; i < 20; i++) {
      progress = await (await nativeFetch(base + '/api/data/progress')).json();
      if (progress.phase !== 'updating') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(progress.phase, 'checked'); assert.equal(progress.total, 0);
    assert.deepEqual(progress.disabledSports.sort(), ['basketball', 'football', 'tennis']);
    assert.equal(progress.cacheMinutes, 15); assert.equal(calls, 1);
    const forbiddenVisit = await nativeFetch(base + '/api/data/visit', { method: 'POST', headers: { origin: 'https://malicious.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(forbiddenVisit.status, 403);
    const backup = await post('/api/data/backup', {}); assert.equal(backup.status, 200);
    assert.equal((await post('/api/data/backup/verify', { id: backup.data.id })).data.valid, true);
    assert.equal((await post('/api/data/backup/restore', { id: backup.data.id, confirmation: '' })).status, 400);
    assert.equal((await post('/api/data/backup/restore', { id: backup.data.id, confirmation: 'RESTAURAR' })).status, 200);
    assert.equal((await post('/api/data/backup/verify', { id: '../state' })).status, 400);
    const forbidden = await nativeFetch(base + '/api/data/backup', { method: 'POST', headers: { origin: 'https://malicious.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(forbidden.status, 403);
    const saved = await readFile(path.join(directory, 'state.json'), 'utf8');
    assert.equal(saved.includes(key), false); assert.equal(saved.includes('private@example.invalid'), false);
    await post('/api/basketball/key', { key: '' });
    state = await (await nativeFetch(base + '/api/data/state')).json(); assert.equal(state.policies.basketball.paid, false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); globalThis.fetch = nativeFetch;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(directory, { recursive: true, force: true });
  }
});
