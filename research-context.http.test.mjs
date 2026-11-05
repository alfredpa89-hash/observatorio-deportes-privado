import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('context HTTP is local, source-linked, independent of keys and cannot write retrospective news into sealed inputs', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'context-http-'));
  const original = { port: process.env.PORT, dir: process.env.OBSERVATORIO_DATA_DIR, scheduler: process.env.OBSERVATORIO_DISABLE_SCHEDULER };
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = folder; process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1';
  const initial = { version: 1, leagues: { 'api:39': { key: 'api:39', name: 'Premier League', country: 'England', source: 'api-football', seasons: [2024], teamsBySeason: { 2024: ['Alpha Team', 'Beta Team'] } } },
    matches: [{ id: 'test', leagueKey: 'api:39', season: 2024, date: '2024-11-10T15:00:00Z', home: 'Alpha Team', away: 'Beta Team', homeGoals: 2, awayGoals: 0, status: 'FT', stats: {}, source: 'simulated' }], cache: {} };
  await writeFile(path.join(folder, 'state.json'), JSON.stringify(initial));
  let server;
  try {
    const { startServer } = await import('./server.mjs'); server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body, origin) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const body = { sport: 'football', key: 'api:39', season: '2024', names: ['Alpha Team'], lookback: 5, cutoff: new Date().toISOString() };
    const summary = await post('/api/context/summary', body); assert.equal(summary.status, 200); assert.equal(summary.data.entities[0].n, 1); assert.equal(summary.data.modelChanged, false);
    assert.equal(summary.data.football.canRefresh, false);
    assert.equal((await post('/api/context/football', body)).status, 409);
    assert.equal((await post('/api/context/football', body, 'https://evil.example')).status, 403);
    const saved = await post('/api/context/report', { ...body, entityId: summary.data.entities[0].id, category: 'competition', title: 'Situacion por verificar', note: 'Nota de prueba ficticia; no es una noticia deportiva real.', sourceUrl: 'https://www.uefa.com/news/test',
      publishedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(saved.status, 200); assert.equal(saved.data.verification, 'manual-unverified');
    assert.equal((await post('/api/context/review', { ...body, noteId: saved.data.id, action: 'reviewed' })).status, 200);
    assert.equal((await post('/api/context/review', { ...body, noteId: saved.data.id, action: 'withdrawn' }, 'https://evil.example')).status, 403);
    assert.equal((await post('/api/context/summary', { ...body, cutoff: new Date().toISOString() })).data.notes.length, 1);
    const reviewed = await post('/api/context/summary', { ...body, cutoff: new Date().toISOString() });
    assert.equal(reviewed.data.notes[0].review.action, 'reviewed'); assert.equal(reviewed.data.brief.items[0].evidence, 'user-reviewed');
    assert.equal((await post('/api/context/news', { ...body, cutoff: '2024-12-01T00:00:00Z' })).status, 400);
    assert.equal((await post('/api/context/report', body, 'https://evil.example')).status, 403);
    assert.equal((await post('/api/context/summary', { ...body, names: ['Unknown'] })).status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of [['PORT', original.port], ['OBSERVATORIO_DATA_DIR', original.dir], ['OBSERVATORIO_DISABLE_SCHEDULER', original.scheduler]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(folder, { recursive: true, force: true });
  }
});
