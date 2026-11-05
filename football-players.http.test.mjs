import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

async function isolated(callback, suffix) {
  const directory = await mkdtemp(path.join(tmpdir(), 'football-players-http-'));
  const oldPort = process.env.PORT, oldDir = process.env.OBSERVATORIO_DATA_DIR, oldKey = process.env.API_FOOTBALL_KEY;
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = directory; delete process.env.API_FOOTBALL_KEY;
  let server;
  try {
    const { startServer } = await import(`./server.mjs?football-players-http-${suffix}`); server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    await callback({ post, base, directory, restart: async () => { await new Promise(resolve => server.close(resolve)); server = await startServer(); return `http://127.0.0.1:${server.address().port}`; } });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [name, value] of [['PORT', oldPort], ['OBSERVATORIO_DATA_DIR', oldDir], ['API_FOOTBALL_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
}

test('football player HTTP ranking and profiles persist CSV data without altering matches', async () => {
  await isolated(async ({ post, base, directory, restart }) => {
    const league = await post('/api/import', { season: 2024, leagueName: 'Prueba HTTP', csv: 'date,home,away,home_goals,away_goals\n2024-09-01,A,B,2,0' });
    const args = { leagueKey: league.data.league.key, season: 2024, cutoff: '2026-10-01', window: '10' };
    const empty = await post('/api/football/players', args); assert.equal(empty.status, 200); assert.equal(empty.data.count, 0);
    const imported = await post('/api/profiles/import', { ...args, sport: 'football', csv: ['date,player,team,opponent,minutes,goals,assists,shots,shots_on_target,fouls,fouls_drawn',
      '2024-09-01,Jugador,A,B,30,1,0,3,2,1,2', '2024-09-02,Jugador,A,B,,0,,,1,,',
      '2024-09-03,Jugador,A,B,0,0,0,0,0,0,0', '2024-09-04,Jugador,A,B,90,0,0,1,3,0,0',
      '2024-09-05,Jugador,A,B,200,0,0,1,1,0,0'].join('\n') });
    assert.equal(imported.data.imported, 2); assert.equal(imported.data.skipped, 3);
    const ranking = await post('/api/football/players', args);
    assert.equal(ranking.status, 200); assert.equal(ranking.data.players[0].appearances, 2);
    assert.equal(ranking.data.players[0].summary.find(field => field.id === 'goals').per90, 3);
    assert.equal(ranking.data.players[0].summary.find(field => field.id === 'saves').n, 0);
    assert.equal((await post('/api/football/players/assist-leaders', args)).status, 400);
    const initialState = await (await fetch(base + '/api/football/players/state')).json();
    assert.ok(initialState.pending.some(league => league.key === 'api-preset:ecu2'));
    assert.ok(initialState.pending.some(league => league.key === 'api-preset:col2'));
    assert.ok(initialState.pending.some(league => league.key === 'api-preset:ucl'));
    const player = await post('/api/football/players/profile', { ...args, playerKey: ranking.data.players[0].playerKey, team: 'A' });
    assert.equal(player.status, 200); assert.equal(player.data.history[0].minutes, null);
    assert.equal((await post('/api/football/players/load', { ...args, team: 'A' })).status, 401);
    assert.equal((await post('/api/football/players', { ...args, season: 2025 })).status, 400);
    assert.equal((await post('/api/football/players', { ...args, leagueKey: 'unknown' })).status, 404);
    const saved = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    assert.equal(saved.matches.length, 1); assert.equal(saved.playerLogs.length, 2);
    for (const file of ['/football-players.js', '/football-players.css', '/templates/football-players.csv']) assert.equal((await fetch(base + file)).status, 200);
    const freshBase = await restart();
    const state = await (await fetch(freshBase + '/api/football/players/state')).json();
    assert.equal(state.connected, false); assert.equal(state.catalog[0].seasonsInfo['2024'].records, 2);
  }, 'csv');
});

test('API-Football HTTP connector imports game logs on demand, caches and does not persist credentials', async () => {
  const original = globalThis.fetch; let remoteCalls = 0;
  const game = { fixture: { id: 100, date: '2024-09-01T18:00:00Z', status: { short: 'FT' } }, league: { id: 39, season: 2024 },
    teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } }, goals: { home: 1, away: 0 }, score: { halftime: { home: 0, away: 0 } },
    players: [{ team: { id: 1 }, players: [{ player: { id: 11, name: 'Jugador' }, statistics: [{ games: { minutes: 90, position: 'G' }, goals: { total: 1, assists: 0, saves: 0 }, shots: { total: 3, on: 1 } }] }] }] };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== 'v3.football.api-sports.io') return original(input, options);
    remoteCalls++;
    let response;
    if (url.pathname === '/status') response = { subscription: { plan: 'Free', active: true }, requests: { current: 10, limit: 100 } };
    else if (url.pathname === '/leagues') response = [{ league: { id: 39, name: 'Liga HTTP API' }, country: { name: 'England' }, seasons: [{ year: 2024, coverage: { fixtures: { statistics_players: true } } }] }];
    else if (url.pathname === '/players/topassists') {
      assert.equal(url.searchParams.get('league'), '39'); assert.equal(url.searchParams.get('season'), '2024');
      response = [{ player: { id: 11, name: 'Jugador' }, statistics: [{ league: { id: 39, season: 2024 }, team: { id: 1, name: 'A' }, goals: { assists: 12 }, games: { appearences: 35, minutes: 2800 } }] }];
    }
    else if (url.searchParams.has('id')) response = [game];
    else { const summary = structuredClone(game); delete summary.players; response = [summary]; }
    return new Response(JSON.stringify({ errors: [], response }), { headers: { 'content-type': 'application/json', 'x-ratelimit-requests-remaining': '90' } });
  };
  try {
    await isolated(async ({ post, directory, restart }) => {
      const secret = 'test-key-not-a-real-credential'; await post('/api/key', { key: secret });
      assert.equal((await post('/api/load', { id: 39, season: 2024 })).status, 200);
      const args = { leagueKey: 'api:39', season: 2024, cutoff: '2026-10-01', team: 'A', lookback: 10 };
      const loaded = await post('/api/football/players/load', args);
      assert.equal(loaded.status, 200); assert.equal(loaded.data.imported, 1); assert.equal(loaded.data.requests, 1);
      assert.equal((await post('/api/football/players', args)).data.players[0].name, 'Jugador');
      await post('/api/football/players/load', args); assert.equal(remoteCalls, 4);
      const leagueBatch = await post('/api/football/players/load', { ...args, team: '', scope: 'league', maxGames: 1 });
      assert.equal(leagueBatch.status, 200); assert.equal(leagueBatch.data.scope, 'league');
      assert.equal(leagueBatch.data.requests, 0); assert.equal(leagueBatch.data.teamsCovered, 1);
      assert.equal(leagueBatch.data.state.catalog[0].seasonsInfo['2024'].teamCoverage.A.games, 1);
      const leaders = await post('/api/football/players/assist-leaders', { ...args, refresh: true });
      assert.equal(leaders.status, 200); assert.equal(leaders.data.report.rows[0].assists, 12);
      assert.equal(leaders.data.requests, 1); assert.equal(remoteCalls, 5);
      assert.equal((await post('/api/football/players/assist-leaders', { ...args, refresh: true })).data.requests, 0);
      assert.equal(remoteCalls, 5);
      const data = await readFile(path.join(directory, 'state.json'), 'utf8');
      assert.equal(data.includes(secret), false); assert.equal(JSON.parse(data).playerLogs[0].values.fouls, null);
      const saved = JSON.parse(data); assert.equal(saved.playerLogs.length, 1); assert.equal(saved.playerLogs[0].values.saves, 0);
      delete saved.playerLogs[0].values.saves;
      await writeFile(path.join(directory, 'state.json'), JSON.stringify(saved));
      const freshBase = await restart();
      const result = await fetch(freshBase + '/api/football/players', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...args, position: 'G', metric: 'saves' }) });
      assert.equal((await result.json()).players[0].summary.find(field => field.id === 'saves').total, 0);
      const retained = await fetch(freshBase + '/api/football/players/assist-leaders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
      assert.equal((await retained.json()).report.rows[0].assists, 12); assert.equal(remoteCalls, 5);
    }, 'api');
  } finally { globalThis.fetch = original; }
});

test('football connection verifies keys, redacts account data and explains restricted seasons without losing history', async () => {
  const original = globalThis.fetch; let calls = 0, plan = 'Free', mode = 'normal';
  const credential = 'protected-test-credential', accountEmail = 'private-account@example.invalid';
  const league = { league: { id: 39, name: 'Premier League' }, country: { name: 'England' }, seasons: [{ year: 2026 }, { year: 2024 }] };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== 'v3.football.api-sports.io') return original(input, options);
    calls++;
    if (mode === 'network') throw new Error('Network unavailable');
    const key = options.headers['x-apisports-key'];
    if (key !== credential) return Response.json({ errors: { token: `Invalid API key ${key}` }, response: [] });
    if (mode === 'quota') return Response.json({ errors: { requests: 'request limit reached' } }, { status: 429, headers: { 'x-ratelimit-requests-remaining': '0' } });
    if (mode === 'malformed') return Response.json({ response: [] });
    if (url.pathname === '/status') return Response.json({ errors: [], response: { account: { email: accountEmail }, subscription: { plan, active: mode !== 'inactive' }, requests: { current: 7, limit: 100 } } });
    if (url.pathname === '/leagues') return Response.json({ errors: [], response: [league] });
    if (plan === 'Free' && url.searchParams.get('season') === '2026') return Response.json({ errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' }, response: [] });
    return Response.json({ errors: [], response: [] });
  };
  try {
    await isolated(async ({ post, base, directory }) => {
      await post('/api/import', { season: 2024, leagueName: 'Guardada', csv: 'date,home,away,home_goals,away_goals\n2024-09-01,A,B,2,0' });
      const invalid = await post('/api/key', { key: 'wrong-credential' });
      assert.equal(invalid.status, 401); assert.equal(invalid.data.code, 'invalid_key');
      assert.equal(JSON.stringify(invalid.data).includes('wrong-credential'), false);
      let state = await (await fetch(base + '/api/state')).json(); assert.equal(state.connected, false);
      const connected = await post('/api/key', { key: credential });
      assert.equal(connected.status, 200); assert.equal(connected.data.connection.verified, true);
      assert.equal(connected.data.connection.plan, 'Free'); assert.equal(connected.data.quota.remaining, 93);
      assert.equal(JSON.stringify(connected.data).includes(accountEmail), false);
      assert.equal(JSON.stringify(connected.data).includes(credential), false);
      const limited = await post('/api/load', { id: 39, season: 2026 });
      assert.equal(limited.status, 403); assert.equal(limited.data.code, 'season_restricted');
      assert.deepEqual(limited.data.allowedSeasons, [2022, 2023, 2024]);
      const count = calls; await post('/api/load', { id: 39, season: 2026 }); assert.equal(calls, count);
      state = await (await fetch(base + '/api/state')).json();
      assert.equal(state.connection.verified, true); assert.equal(state.catalog[0].matchCount, 1);
      const search = await (await fetch(base + '/api/search?q=Premier')).json(); assert.equal(search.results.some(item => item.sourceType === 'api'), true);
      const cachedCalls = calls; await fetch(base + '/api/search?q=Premier'); assert.equal(calls, cachedCalls);
      await post('/api/key', { key: 'another-wrong-key' });
      state = await (await fetch(base + '/api/state')).json(); assert.equal(state.connection.verified, true);
      plan = 'Pro'; await post('/api/football/connection', {});
      state = await (await fetch(base + '/api/state')).json(); assert.equal(state.connection.plan, 'Pro'); assert.equal(state.connection.allowedSeasons, null);
      await fetch(base + '/api/search?q=Premier'); assert.equal(calls, cachedCalls + 3, 'a new plan does not reuse unverified cached access');
      mode = 'network'; assert.equal((await post('/api/football/connection', {})).data.code, 'network_error');
      mode = 'malformed'; assert.equal((await post('/api/football/connection', {})).status, 502);
      mode = 'inactive'; assert.equal((await post('/api/football/connection', {})).status, 403);
      mode = 'quota'; const quota = await post('/api/football/connection', {}); assert.equal(quota.status, 429); assert.equal(quota.data.code, 'quota_exceeded');
      const callsAtLimit = calls;
      mode = 'network'; const cooldown = await post('/api/football/connection', {});
      assert.equal(cooldown.status, 429); assert.equal(cooldown.data.code, 'provider_cooldown'); assert.equal(calls, callsAtLimit);
      const saved = await readFile(path.join(directory, 'state.json'), 'utf8');
      for (const secret of [credential, accountEmail, 'another-wrong-key', 'wrong-credential']) assert.equal(saved.includes(secret), false);
      assert.equal(Object.keys(JSON.parse(saved).cache).includes('/status'), false);
      const disconnected = await post('/api/key', { key: '' }); assert.equal(disconnected.data.connected, false);
      assert.equal(disconnected.data.catalog[0].matchCount, 1);
    }, 'connection');
  } finally { globalThis.fetch = original; }
});
