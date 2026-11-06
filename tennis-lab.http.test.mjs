import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('tennis lab HTTP updates free histories, preserves richer fields and isolates fixtures, availability and evaluation', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url)), temporary = path.resolve(root, '.test-tmp');
  await mkdir(temporary, { recursive: true }); const directory = await mkdtemp(path.join(temporary, 'tennis-http-'));
  assert.ok(directory.startsWith(temporary + path.sep));
  const original = { port: process.env.PORT, data: process.env.OBSERVATORIO_DATA_DIR, fetch: globalThis.fetch };
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = directory;
  let server, calls = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return original.fetch(input, options);
    assert.equal(url.hostname, 'stats.tennismylife.org'); calls++;
    const year = url.pathname.match(/(20\d\d)\.csv$/)[1];
    const header = 'date,tournament,category,surface,player1,player2,player1_id,player2_id,winner,best_of,score,indoor,minutes,player1_aces,player1_serve_points,player1_first_in,player1_first_won,player1_second_won,player1_service_games,player1_bp_saved,player1_bp_faced,player2_bp_saved,player2_bp_faced';
    return new Response([header, ...Array.from({ length: 30 }, (_, i) => `${year}-06-${String(i + 1).padStart(2, '0')},Test Open,atp-500,Hard,Alpha,Beta,1,2,1,3,6-4 6-4,No,90,5,60,40,30,10,10,3,5,1,3`)].join('\n'));
  };
  try {
    const { startServer } = await import('./server.mjs'); server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async route => (await original.fetch(base + route)).json();
    const post = async (route, body, extraHeaders = {}) => {
      const response = await original.fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await get('/api/tennis/state')).coverage.results, 0);
    const basketball = await get('/api/basketball/audit');
    assert.equal((await post('/api/tennis/refresh', { season: '2026' }, { origin: 'https://example.com' })).status, 403); assert.equal(calls, 0);
    const refreshed = await post('/api/tennis/refresh', { season: '2026' });
    assert.equal(refreshed.status, 200); assert.equal(calls, 2); assert.equal(refreshed.data.state.coverage.serviceMatches, 60);
    await post('/api/tennis/refresh', { season: '2026' }); assert.equal(calls, 2);
    const profile = await post('/api/tennis/player', { playerKey: 'atp:1', lookback: 30 });
    assert.equal(profile.status, 200); assert.equal(profile.data.history.length, 30); assert.equal(profile.data.summary.find(row => row.metric === 'breaks').average, 2);
    assert.equal(profile.data.lines[0].n, 30); assert.equal(profile.data.context.matches7Days, 0);
    const comparison = await post('/api/tennis/comparison', { player1Key: 'atp:1', player2Key: 'atp:2' }); assert.equal(comparison.status, 200);
    assert.ok(comparison.data.scenarios.some(row => row.group === 'handicap'));
    assert.equal(comparison.data.setScores.rows.length, 4);
    assert.ok(comparison.data.setScores.rows.every(row => row.probability !== null));
    const handicap = await post('/api/tennis/comparison', { player1Key: 'atp:1', player2Key: 'atp:2', handicapLine: 12.5 });
    assert.deepEqual(handicap.data.handicaps.filter(row => row.selected).map(row => row.line), [12.5, -12.5]);
    assert.equal((await post('/api/tennis/comparison', { player1Key: 'atp:1', player2Key: 'atp:2', handicapLine: 0 })).status, 400);
    assert.equal((await post('/api/tennis/player', { playerKey: 'atp:1', cutoff: 'bad' })).status, 400);
    assert.equal((await post('/api/tennis/player', { playerKey: 'atp:1', lookback: 500 })).status, 400);
    const fixture = await post('/api/tennis/fixtures', { player1Key: 'atp:1', player2Key: 'atp:2', season: '2026', tournament: 'Test Open', category: 'atp-500', surface: 'Hard', bestOf: 3,
      sourceUrl: 'https://example.com/calendar', date: new Date(Date.now() + 6 * 3600000).toISOString() }); assert.equal(fixture.status, 200);
    const prepared = await post('/api/tennis/daily/prepare', { season: '2026' }); assert.equal(prepared.status, 200); assert.equal(prepared.data.prepared, 1);
    const persisted = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    assert.equal(persisted.tennisLab.snapshots.length, 1); assert.ok(persisted.tennisLab.inputs[persisted.tennisLab.snapshots[0].inputHash]);
    assert.equal((await get('/api/tennis/evaluation')).snapshots, 1);
    assert.equal((await post('/api/tennis/backtest', { season: '2026' })).status, 200);
    assert.deepEqual(await get('/api/basketball/audit'), basketball);
    for (const asset of ['/tennis-lab.js', '/tennis-lab.css']) assert.equal((await original.fetch(base + asset)).status, 200);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    globalThis.fetch = original.fetch;
    if (original.port === undefined) delete process.env.PORT; else process.env.PORT = original.port;
    if (original.data === undefined) delete process.env.OBSERVATORIO_DATA_DIR; else process.env.OBSERVATORIO_DATA_DIR = original.data;
    await rm(directory, { recursive: true, force: true });
  }
});
