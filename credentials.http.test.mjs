import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('credential HTTP never returns secrets, restores connections without provider calls or paid privileges, and forgets just one key', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'credentials-http-')), nativeFetch = globalThis.fetch;
  process.env.OBSERVATORIO_DATA_DIR = directory; process.env.PORT = '0'; process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1';
  let values = {}, calls = 0, server;
  const vaultState = () => ({ supported: true, available: true, error: null, saved: Object.fromEntries(['football', 'basketball', 'footystats'].map(key => [key, Boolean(values[key])])) });
  const vault = { state: vaultState, check: async () => vaultState(), load: async () => ({ ...values }), save: async (provider, value) => { if (value) values[provider] = value; else delete values[provider]; return vaultState(); } };
  const secrets = { football: 'synthetic-football-key-12345', basketball: 'synthetic-basketball-key-12345', footystats: 'synthetic-footystats-key-12345' };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
    calls++;
    if (url.pathname === '/league-list') return Response.json({ success: true, data: [] });
    assert.equal(url.pathname, '/status');
    return Response.json({ response: { subscription: { plan: 'Free', active: true }, requests: { limit_day: 100, limit: 100, current: 1 } } });
  };
  const post = async (base, route, body, origin) => {
    const response = await nativeFetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    server = await (await import(`./server.mjs?credential-start=${Date.now()}`)).startServer({ vault });
    let base = `http://127.0.0.1:${server.address().port}`;
    for (const [provider, route] of [['football', '/api/key'], ['basketball', '/api/basketball/key'], ['footystats', '/api/footystats/key']]) {
      const result = await post(base, route, { key: secrets[provider], remember: true }); assert.equal(result.status, 200);
      if (provider === 'basketball') { assert.equal(values.basketball, undefined); assert.equal((await post(base, '/api/basketball/research/access', {})).status, 200); }
      assert.equal(Object.values(secrets).some(key => JSON.stringify(result).includes(key)), false);
    }
    assert.deepEqual(Object.keys(values).sort(), Object.keys(secrets).sort());
    const publicState = await (await nativeFetch(base + '/api/data/state')).json();
    assert.equal(Object.values(secrets).some(key => JSON.stringify(publicState).includes(key)), false);
    const before = calls; await new Promise(resolve => server.close(resolve));
    server = await (await import(`./server.mjs?credential-restart=${Date.now()}`)).startServer({ vault });
    base = `http://127.0.0.1:${server.address().port}`;
    const status = await (await nativeFetch(base + '/api/credentials/state')).json();
    assert.deepEqual(status.connections, { footballConnected: true, basketballConnected: true, footystatsConnected: true });
    assert.equal(calls, before, 'restoring keys must not download providers or infer a paid subscription');
    const state = await (await nativeFetch(base + '/api/data/state')).json(); assert.equal(state.policies.basketball.paid, false); assert.equal(state.policies.football.paid, false);
    assert.equal((await post(base, '/api/credentials/forget', { provider: 'football' }, 'https://evil.example')).status, 403);
    const forgotten = await post(base, '/api/credentials/forget', { provider: 'football' }); assert.equal(forgotten.status, 200);
    assert.equal(forgotten.data.connections.footballConnected, false); assert.equal(forgotten.data.saved.basketball, true); assert.equal(forgotten.data.saved.footystats, true);
    const disk = await readFile(path.join(directory, 'state.json'), 'utf8'); assert.equal(Object.values(secrets).some(key => disk.includes(key)), false);
    assert.equal((await post(base, '/api/server/stop', {}, 'https://evil.example')).status, 403);
    const closed = new Promise(resolve => server.once('close', resolve));
    assert.equal((await post(base, '/api/server/stop', {})).status, 200); await closed; server = null;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); globalThis.fetch = nativeFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
