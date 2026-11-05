import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('combined football HTTP selection preserves native archives, cutoffs, manual calendars and player seasons', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'football-combined-'));
  const nativeFetch = globalThis.fetch;
  const oldDataDir = process.env.OBSERVATORIO_DATA_DIR, oldPort = process.env.PORT;
  process.env.OBSERVATORIO_DATA_DIR = dataDir; process.env.PORT = '0';
  const competition = 'competition:england:premier-league';
  const store = { version: 1, cache: {}, leagues: {
    'api:39': { key: 'api:39', name: 'Premier League', country: 'England', seasons: [2024], source: 'api-football', teamsBySeason: { 2024: ['Manchester United', 'Arsenal'] } },
    'football-data:E0': { key: 'football-data:E0', name: 'Premier League', country: 'England', seasons: ['2025/2026'], source: 'football-data.co.uk', teamsBySeason: { '2025/2026': ['Man United', 'Arsenal'] } },
  }, matches: [
    { id: '100', leagueKey: 'api:39', season: 2024, date: '2024-10-01T19:00:00Z', home: 'Manchester United', away: 'Arsenal', status: 'FT', homeGoals: 2, awayGoals: 1, statsChecked: true },
    { id: 'csv1', leagueKey: 'football-data:E0', season: '2025/2026', date: '2025-10-01T19:00:00Z', home: 'Man United', away: 'Arsenal', status: 'FT', homeGoals: 1, awayGoals: 1 },
  ], playerLogs: [{ id: 'log1', sport: 'football', leagueKey: 'api:39', season: 2024, fixtureId: '100', playerId: 1, playerKey: 'api:1',
    name: 'Jugador', team: 'Manchester United', opponent: 'Arsenal', date: '2024-10-01T19:00:00Z', minutes: 90, values: { goals: 1 } }] };
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(store));
  globalThis.fetch = (url, options) => {
    if (new URL(url).hostname !== '127.0.0.1') throw new Error('This read-only test must not contact a provider');
    return nativeFetch(url, options);
  };
  let server;
  try {
    const { startServer } = await import('./server.mjs'); server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async endpoint => (await fetch(base + endpoint)).json();
    const post = async (endpoint, body) => {
      const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
    };
    const state = await get('/api/state'); assert.equal(state.catalog.length, 2); assert.equal(state.competitions.length, 1);
    assert.equal((await get('/api/profiles/state')).football.length, 1);
    const playerState = await get('/api/football/players/state'); assert.equal(playerState.catalog.length, 1);
    const players = await post('/api/football/players', { leagueKey: competition, season: '2024/2025', cutoff: '2026-10-01T00:00:00Z' });
    assert.equal(players.records, 1); assert.equal(players.players[0].team, 'Man United');
    const query = { sport: 'football', kind: 'team', leagueKey: competition, season: '2025/2026', name: 'Man United', lookback: 5, cutoff: '2025-09-30T23:59:59Z' };
    const profile = await post('/api/profiles/report', query); assert.equal(profile.history.length, 1);
    const report = await post('/api/report', { ...query, home: 'Man United', away: 'Arsenal' }); assert.equal(report.history.home.length, 1);
    const calendar = { leagueKey: competition, season: '2025/2026', home: 'Man United', away: 'Arsenal', date: '2025-10-15', time: '17:00', cutoff: '2025-10-13T00:00:00Z' };
    await post('/api/fixtures/manual', calendar);
    const list = await post('/api/list', calendar); assert.equal(list.fixtures.length, 1); assert.equal(list.fixtures[0].manual, true);
    await post('/api/fixtures/manual/remove', { ...calendar, id: list.fixtures[0].id });
    assert.equal((await post('/api/list', calendar)).fixtures.length, 0);
    const persisted = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.deepEqual(Object.keys(persisted.leagues).sort(), ['api:39', 'football-data:E0']);
    assert.equal(persisted.matches[0].leagueKey, 'api:39'); assert.equal(persisted.matches[0].home, 'Manchester United');
    assert.equal(persisted.playerLogs[0].season, 2024);
    const audit = await get('/api/basketball/audit');
    assert.equal(audit.valid, true); assert.equal(audit.version, 'basketball-2026-10-v2'); assert.equal(audit.snapshots, 0);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    globalThis.fetch = nativeFetch;
    if (oldDataDir === undefined) delete process.env.OBSERVATORIO_DATA_DIR; else process.env.OBSERVATORIO_DATA_DIR = oldDataDir;
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    await rm(dataDir, { recursive: true, force: true });
  }
});
