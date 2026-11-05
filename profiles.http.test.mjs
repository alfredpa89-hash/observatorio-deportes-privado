import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('individual HTTP reports need no opponent and player imports survive restart without replacing matches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'profiles-http-'));
  const oldPort = process.env.PORT; const oldDir = process.env.OBSERVATORIO_DATA_DIR;
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = directory;
  let server;
  try {
    const { startServer } = await import('./server.mjs?profiles-http'); server = await startServer();
    let base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const league = await post('/api/import', { season: 2026, leagueName: 'Individual HTTP',
      csv: 'date,home,away,home_goals,away_goals\n2026-09-01,A,B,2,1\n2026-09-02,B,A,1,3' });
    const args = { sport: 'football', leagueKey: league.data.league.key, season: 2026, name: 'A', cutoff: '2026-10-01', kind: 'team' };
    const result = await post('/api/profiles/report', args);
    assert.equal(result.status, 200); assert.equal(result.data.record.wins, 2);
    assert.equal(result.data.summary.find(field => field.id === 'goals').average, 2.5);
    const btts = result.data.scenarios.find(item => item.id === 'btts-yes');
    assert.equal(btts.hits, 2); assert.equal(btts.n, 2); assert.equal(btts.frequency, 100); assert.equal(btts.probability, null);
    assert.deepEqual(result.data.record.halfTime, { played: 0, wins: 0, draws: 0, losses: 0 });
    assert.ok(result.data.scenarios.some(item => item.id === 'corners-under-12.5'));
    assert.ok(result.data.scenarios.some(item => item.id === 'half-time-corners-over-4.5'));
    assert.equal((await post('/api/profiles/report', { ...args, thresholds: { cornersTotal: [2] } })).status, 400);
    const custom = await post('/api/profiles/report', { ...args, thresholds: { cornersTotal: [14.5] } });
    assert.equal(custom.status, 200); assert.ok(custom.data.scenarios.some(item => item.id === 'corners-over-14.5'));
    const handicapArgs = { ...args, thresholds: { handicapAsian: [-3.25], halfTimeHandicapEuropean: [-4] } };
    const handicap = await post('/api/profiles/report', handicapArgs);
    assert.equal(handicap.status, 200);
    assert.equal(handicap.data.scenarios.find(item => item.id === 'handicap-asian-ft--3.25-home').n, 2);
    assert.equal(handicap.data.scenarios.find(item => item.id === 'handicap-european-ht--4-draw').probability, null);
    assert.equal((await post('/api/profiles/report', { ...args, thresholds: { handicapAsian: [.1] } })).status, 400);
    assert.equal((await post('/api/report', { ...handicapArgs, home: 'A', away: 'B' })).status, 200);
    for (const thresholds of [{ handicapAsian: [.1] }, { halfTimeHandicapEuropean: [.5] }, { handicapAsian: Array(21).fill(0) }]) {
      assert.equal((await post('/api/report', { ...args, home: 'A', away: 'B', thresholds })).status, 400);
    }
    for (const lookback of [5, 15]) {
      assert.equal((await post('/api/profiles/report', { ...args, lookback })).data.meta.lookback, lookback);
      assert.equal((await post('/api/report', { ...args, home: 'A', away: 'B', lookback })).data.meta.lookback, lookback);
      assert.equal((await post('/api/list', { ...args, lookback })).data.lookback, lookback);
    }
    assert.equal((await post('/api/report', { ...args, home: 'A' })).status, 400);
    assert.equal((await post('/api/profiles/report', { ...args, name: 'unknown' })).status, 400);
    const imported = await post('/api/profiles/import', { ...args,
      csv: 'date,player,team,opponent,goals,assists\n2026-09-01,Delantero,A,B,1,0\n2026-09-02,Delantero,A,B,2,' });
    assert.equal(imported.status, 200); assert.equal(imported.data.imported, 2);
    const catalogue = await post('/api/profiles/catalog', args); assert.deepEqual(catalogue.data.players, ['Delantero']);
    const player = await post('/api/profiles/report', { ...args, kind: 'player', name: 'Delantero' });
    assert.equal(player.status, 200); assert.equal(player.data.summary.find(field => field.id === 'assists').n, 1);
    assert.equal(player.data.scenarios, undefined);
    const saved = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    assert.equal(saved.matches.length, 2); assert.equal(saved.playerLogs.length, 2);
    await new Promise(resolve => server.close(resolve)); server = await startServer(); base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual((await post('/api/profiles/catalog', args)).data.players, ['Delantero']);
    const state = await (await fetch(base + '/api/profiles/state')).json(); assert.equal(state.football[0].matchCount, 2);
    for (const file of ['football-players', 'nba-players']) assert.equal((await fetch(`${base}/templates/${file}.csv`)).status, 200);
    assert.equal((await fetch(base + '/profiles.js')).status, 200);
    assert.equal((await fetch(base + '/football-handicap.js')).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    if (oldDir === undefined) delete process.env.OBSERVATORIO_DATA_DIR; else process.env.OBSERVATORIO_DATA_DIR = oldDir;
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
