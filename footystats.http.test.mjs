import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('FootyStats HTTP routes protect credentials, honor origin restrictions and keep other sports untouched', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'footystats-http-'));
  const originalFetch = globalThis.fetch, oldPort = process.env.PORT, oldDir = process.env.OBSERVATORIO_DATA_DIR;
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = directory;
  let calls = 0, server;
  const secret = 'test-footystats-secret';
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname !== 'api.football-data-api.com') return originalFetch(input, options);
    calls++;
    assert.equal(url.searchParams.get('key'), secret);
    const data = url.pathname === '/league-list' ? [{ name: 'Liga de prueba', country: 'Ecuador', season: [{ id: 99, year: 2026 }] }]
      : url.pathname === '/league-matches' ? [{ id: 50, competition_id: 99, status: 'complete', home_name: 'A', away_name: 'B', homeGoalCount: 1, awayGoalCount: 0 }]
      : url.pathname === '/match' ? { id: 50 } : [];
    return Response.json({ success: true, data, metadata: { request_remaining: '90', request_limit: '100' } });
  };
  try {
    const { startServer } = await import('./server.mjs?footystats-http-test');
    server = await startServer(); const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body, extra = {}) => {
      const response = await originalFetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await post('/api/footystats/key', { key: secret }, { origin: 'https://outside.example' })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await post('/api/footystats/audit', { seasonId: 99 })).status, 401);
    const connected = await post('/api/footystats/key', { key: secret });
    assert.equal(connected.status, 200); assert.equal(connected.data.connected, true);
    assert.equal(JSON.stringify(connected).includes(secret), false);
    await post('/api/import', { season: 2024, leagueName: 'Original', csv: 'date,home,away,home_goals,away_goals\n2024-09-01,A,B,2,0' });
    const before = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    const audited = await post('/api/footystats/audit', { seasonId: 99, page: 1 });
    assert.equal(audited.status, 200); assert.equal(audited.data.report.matches.completed, 1);
    assert.equal(audited.data.report.players.returned, 0); assert.equal(audited.data.report.requests, 3);
    const content = await readFile(path.join(directory, 'state.json'), 'utf8');
    const after = JSON.parse(content);
    assert.equal(content.includes(secret), false);
    assert.deepEqual(after.matches, before.matches); assert.deepEqual(after.leagues, before.leagues);
    assert.equal(after.footystatsResearch.audits.length, 1);
    for (const route of ['/footystats.js', '/footystats.css']) assert.equal((await originalFetch(base + route)).status, 200);
    await post('/api/footystats/key', { key: '' });
    const state = await (await originalFetch(base + '/api/footystats/state')).json();
    assert.equal(state.connected, false); assert.equal(state.audits.length, 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['PORT', oldPort], ['OBSERVATORIO_DATA_DIR', oldDir]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(directory).startsWith('footystats-http-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
