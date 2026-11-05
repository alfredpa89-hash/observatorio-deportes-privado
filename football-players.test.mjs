import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFootballPlayerDirectory, buildFootballPlayerProfile, parseFootballFixturePlayers, createFootballPlayersService, restoreFootballPlayerSaves, parseFootballAssistLeaders } from './football-players.mjs';

const match = { id: '100', leagueKey: 'api:39', season: 2024, date: '2024-09-01T18:00:00Z', home: 'A', away: 'B', homeGoals: 1, awayGoals: 0, status: 'FT' };
const stats = { games: { minutes: 75, position: 'F', rating: '7.4', substitute: false }, goals: { total: 1, assists: null }, shots: { total: 3, on: 2 }, fouls: { committed: 2, drawn: 1 }, cards: { yellow: 0, red: 0 }, offsides: null };
const fixture = { fixture: { id: 100, date: match.date, status: { short: 'FT' } }, league: { id: 39, season: 2024 },
  teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } }, players: [{ team: { id: 1 }, players: [
    { player: { id: 11, name: 'Jugador Uno', photo: 'https://media.api-sports.io/football/players/11.png' }, statistics: [stats] },
    { player: { id: 12, name: 'Suplente' }, statistics: [{ ...stats, games: { minutes: 0 } }] },
  ] }, { team: { id: 2 }, players: [{ player: { id: 21, name: 'Rival' }, statistics: [{ ...stats, games: { minutes: 90 }, goals: { total: 0, assists: 0 } }] }] }] };
const args = { leagueKey: 'api:39', season: 2024, cutoff: '2026-10-01', window: '10' };
const log = (patch = {}) => ({ sport: 'football', leagueKey: 'api:39', season: 2024, date: '2024-09-01T18:00:00Z', name: 'Jugador Uno', team: 'A', opponent: 'B', minutes: 90,
  values: { goals: 1, assists: 0, shots: 3, shots_on_target: 2, fouls: 2 }, source: 'CSV personal', ...patch });

test('football fixture players preserve documented fields, missing values and DNP exclusions', () => {
  const rows = parseFootballFixturePlayers(fixture, match);
  assert.equal(rows.length, 2); assert.equal(rows[0].values.assists, null); assert.equal(rows[0].values.yellow, 0);
  assert.equal(rows[0].values.fouls_drawn, 1); assert.equal(rows[0].values.offsides, null);
  assert.equal(rows[0].minutes, 75); assert.equal(rows[0].starter, true); assert.equal(rows[0].rating, 7.4);
  assert.equal(rows[1].venue, 'away'); assert.equal(rows[1].opponent, 'A');
  assert.equal(rows[0].availableAfter, '2024-09-01T21:00:00.000Z');
  const bad = structuredClone(fixture); bad.players[0].players[0].statistics[0].shots.on = 8;
  assert.equal(parseFootballFixturePlayers(bad, match)[0].values.shots_on_target, null);
  bad.players[0].players[0].statistics[0].games.minutes = null;
  assert.equal(parseFootballFixturePlayers(bad, match).length, 1);
});

test('fixture identity, FT status, season and safe photos are required', () => {
  for (const patch of [{ fixture: { ...fixture.fixture, id: 200 } }, { fixture: { ...fixture.fixture, status: { short: 'AET' } } },
    { fixture: { ...fixture.fixture, date: '2024-09-02' } }, { league: { season: 2025 } }, { teams: { ...fixture.teams, home: { id: 1, name: 'Otro' } } }]) {
    assert.deepEqual(parseFootballFixturePlayers({ ...fixture, ...patch }, match), []);
  }
  const unsafe = structuredClone(fixture); unsafe.players[0].players[0].player.photo = 'javascript:alert(1)';
  assert.equal(parseFootballFixturePlayers(unsafe, match)[0].photo, null);
});

test('individual saves preserve real zeros and missing values, never team totals', () => {
  const detail = structuredClone(fixture);
  detail.players[0].players[0].statistics[0].games.position = 'G';
  detail.players[0].players[0].statistics[0].goals.saves = 0;
  detail.statistics = [{ team: { id: 2 }, statistics: [{ type: 'Goalkeeper Saves', value: 7 }] }];
  let rows = parseFootballFixturePlayers(detail, match);
  assert.equal(rows[0].values.saves, 0); assert.equal(rows[1].values.saves, null);
  detail.players[0].players[0].statistics[0].goals.saves = '4';
  rows = parseFootballFixturePlayers(detail, match);
  assert.equal(rows[0].values.saves, 4);
  for (const invalid of [-1, 1.5, true, '', null]) {
    detail.players[0].players[0].statistics[0].goals.saves = invalid;
    assert.equal(parseFootballFixturePlayers(detail, match)[0].values.saves, null);
  }
});

test('cached saves recovery is identity-checked, idempotent and preserves all existing data', () => {
  const detail = structuredClone(fixture);
  detail.players[0].players[0].statistics[0].goals.saves = 0;
  detail.players[1].players[0].statistics[0].goals.saves = 4;
  const rows = parseFootballFixturePlayers(detail, match);
  rows[0].values.saves = null; delete rows[1].values.saves;
  const personal = { ...structuredClone(rows[0]), id: 'personal', source: 'CSV personal' };
  const store = { matches: [match], playerLogs: [...rows, personal], cache: { '/fixtures?id=100': { data: [detail] } } };
  const before = structuredClone(store);
  assert.equal(restoreFootballPlayerSaves(store), 2);
  assert.equal(rows[0].values.saves, 0); assert.equal(rows[1].values.saves, 4); assert.equal(personal.values.saves, null);
  assert.deepEqual(store.matches, before.matches); assert.deepEqual(store.cache, before.cache);
  assert.deepEqual(rows.map(row => ({ ...row, values: { ...row.values, saves: null } })), before.playerLogs.slice(0, 2).map(row => ({ ...row, values: { ...row.values, saves: null } })));
  assert.equal(restoreFootballPlayerSaves(store), 0);
  rows[1].values.saves = 9; assert.equal(restoreFootballPlayerSaves(store), 0); assert.equal(rows[1].values.saves, 9);
  const wrong = structuredClone(before); wrong.cache['/fixtures?id=100'].data[0].league.season = 2025;
  assert.equal(restoreFootballPlayerSaves(wrong), 0);
  const badKey = { ...structuredClone(before), cache: { '/fixtures?id=200': { data: [detail] } } };
  assert.equal(restoreFootballPlayerSaves(badKey), 0);
});

test('goalkeeper filter and saves ranking use only recorded player positions and paired minutes', () => {
  const rows = [log({ name: 'Portero', position: 'G', values: { saves: 4 }, minutes: 90 }),
    log({ name: 'Portero', position: 'G', date: '2024-09-02', values: { saves: 0 }, minutes: 45 }),
    log({ name: 'Portero', position: 'G', date: '2024-09-03', values: { saves: null } }),
    log({ name: 'Otro portero', position: 'G', values: { saves: 2 } }),
    log({ name: 'Sin posicion', values: { saves: 8 } }), log({ position: 'F' })];
  const result = buildFootballPlayerDirectory(rows, { ...args, position: 'G', metric: 'saves', basis: 'average' });
  assert.equal(result.count, 2); assert.equal(result.records, 4); assert.equal(result.savedPlayers, 2);
  const saves = result.players.find(player => player.name === 'Portero').summary.find(field => field.id === 'saves');
  assert.equal(saves.total, 4); assert.equal(saves.n, 2); assert.equal(saves.missing, 1); assert.equal(saves.average, 2);
  assert.equal(saves.per90, 2.67); assert.equal(saves.per90Minutes, 135);
  assert.equal(result.coverage.find(field => field.id === 'saves').n, 3);
  assert.throws(() => buildFootballPlayerDirectory(rows, { ...args, position: 'keeper' }), /Posicion/);
});

test('directory enforces exact season, cutoff, availability and paired-minute denominators', () => {
  const rows = [log({ values: { goals: 2, assists: null, shots: 3 }, minutes: 30 }),
    log({ date: '2024-09-02', minutes: 90, values: { goals: null, assists: 1 } }),
    log({ date: '2024-09-03', minutes: null, values: { goals: 1, assists: 0 } }),
    log({ date: '2024-09-04', minutes: 0 }), log({ season: 2023 }), log({ season: 2025 }),
    log({ date: '2026-11-01' }), log({ availableAfter: '2026-11-01', date: '2024-09-05' }), log({ leagueKey: 'other' })];
  const result = buildFootballPlayerDirectory(rows, args), player = result.players[0];
  assert.equal(result.records, 3); assert.equal(player.appearances, 3); assert.equal(player.minutes, 120); assert.equal(player.minutesN, 2);
  const goals = player.summary.find(field => field.id === 'goals');
  assert.equal(goals.total, 3); assert.equal(goals.average, 1.5); assert.equal(goals.per90, 6);
  assert.equal(goals.n, 2); assert.equal(goals.per90N, 1); assert.equal(goals.per90Minutes, 30);
  assert.equal(player.summary.find(field => field.id === 'fouls').total, null);
  assert.equal(buildFootballPlayerDirectory(rows, { ...args, season: 2026 }).count, 0);
});

test('windows, sorting, transfer separation, missing values and CSV/API deduplication are stable', () => {
  const rows = Array.from({ length: 20 }, (_, i) => log({ date: `2024-09-${String(i + 1).padStart(2, '0')}`, values: { goals: i % 2, shots: i } }));
  rows.push(log({ name: 'Segundo', values: { goals: 15 }, playerKey: 'api:15', team: 'C' }));
  const copy = structuredClone(rows);
  for (const window of ['5', '10', '15', '20']) {
    const result = buildFootballPlayerDirectory(rows, { ...args, window });
    assert.equal(result.players.find(player => player.name === 'Jugador Uno').appearances, Number(window));
    assert.equal(result.players[0].name, 'Segundo');
  }
  const duplicate = log({ ...rows[0], playerKey: 'api:11', playerId: 11 });
  const result = buildFootballPlayerDirectory([rows[0], duplicate], args);
  assert.equal(result.records, 1); assert.equal(result.players[0].playerKey, 'api:11');
  assert.equal(buildFootballPlayerDirectory(rows, { ...args, minGames: 5 }).players[0].name, 'Jugador Uno');
  assert.equal(buildFootballPlayerDirectory(rows, { ...args, query: 'segúndo' }).players[0].name, 'Segundo');
  assert.equal(buildFootballPlayerDirectory(rows, { ...args, team: 'C' }).players.length, 1);
  assert.deepEqual(rows, copy);
  assert.equal(buildFootballPlayerDirectory([log({ playerKey: 'api:11', playerId: 11 }), log({ playerKey: 'api:12', playerId: 12 })], args).count, 2);
  assert.equal(buildFootballPlayerDirectory([log({ playerKey: 'api:11' }), log({ date: '2024-09-02', team: 'C', playerKey: 'api:11' })], args).count, 2);
});

test('football player directories and profiles accept 25 and 30 actual participations', () => {
  const rows = Array.from({ length: 40 }, (_, i) => log({ date: new Date(Date.UTC(2024, 7, i + 1, 18)).toISOString() }));
  for (const window of ['25', '30']) {
    const directory = buildFootballPlayerDirectory(rows, { ...args, window });
    assert.equal(directory.players[0].appearances, Number(window));
    const profile = buildFootballPlayerProfile(rows, { ...args, window, playerKey: directory.players[0].playerKey, team: 'A' });
    assert.equal(profile.history.length, Number(window));
    assert.equal(buildFootballPlayerDirectory(rows.slice(0, 12), { ...args, window }).players[0].appearances, 12);
  }
});

test('individual profile needs no opponent and never labels historical rates as predictions', () => {
  const result = buildFootballPlayerProfile([log()], { ...args, playerKey: 'name:jugador uno', team: 'A' });
  assert.equal(result.appearances, 1); assert.equal(result.history[0].values.assists, 0); assert.match(result.note, /no probabilidades/);
  assert.throws(() => buildFootballPlayerProfile([log()], { ...args, playerKey: 'name:jugador uno', team: 'C' }), /Sin participaciones/);
  for (const patch of [{ cutoff: 'bad' }, { cutoff: '2099-01-01' }, { window: '1' }, { minGames: 0 }, { basis: 'bad' }, { metric: 'pra' }]) {
    assert.throws(() => buildFootballPlayerDirectory([log()], { ...args, ...patch }));
  }
});

function serviceContext({ covered = true, withKey = true, quota = null, getPolicy, respond = async () => [fixture] } = {}) {
  const store = { leagues: { 'api:39': { key: 'api:39', name: 'Liga', source: 'api-football', seasons: [2024], teamsBySeason: { 2024: ['A', 'B'] }, coverageBySeason: { 2024: { fixtures: { statistics_players: covered } } } } }, matches: [match], playerLogs: [], cache: {} };
  let calls = 0, saved = 0;
  const service = createFootballPlayersService({ getStore: () => store, connected: () => withKey, getQuota: () => quota, getPolicy,
    persist: async () => { saved++; }, pause: async () => {}, request: async (...params) => { calls++; return respond(...params); } });
  return { store, service, calls: () => calls, saved: () => saved };
}
const loadArgs = { ...args, team: 'A', lookback: 10 };
test('provider load caches completion, imports both teams and preserves personal data', async () => {
  const ctx = serviceContext(); ctx.store.playerLogs.push(log({ id: 'personal' }));
  const first = await ctx.service.load(loadArgs);
  assert.equal(first.imported, 2); assert.equal(first.available, 1); assert.equal(first.remainingGames, 0);
  assert.equal(ctx.store.playerLogs.length, 3); assert.equal(ctx.store.matches.length, 1); assert.equal(ctx.service.directory(args).records, 2);
  assert.equal((await ctx.service.load(loadArgs)).requests, 0); assert.equal(ctx.calls(), 1);
  assert.equal(ctx.service.state().catalog[0].seasonsInfo['2024'].apiCoverage, true);
});

test('load checks connection, source, coverage, quota reserves and mismatched detail', async () => {
  for (const options of [{ covered: false }, { withKey: false }]) {
    const ctx = serviceContext(options); await assert.rejects(ctx.service.load(loadArgs)); assert.equal(ctx.calls(), 0);
  }
  const quota = serviceContext({ quota: { remaining: 5, checkedAt: new Date().toISOString() } });
  assert.match((await quota.service.load(loadArgs)).warning, /Presupuesto/); assert.equal(quota.calls(), 0);
  const wrong = serviceContext({ respond: async () => [{ ...fixture, league: { id: 39, season: 2025 } }] });
  assert.match((await wrong.service.load(loadArgs)).warning, /no coincide/);
  assert.equal(wrong.store.playerLogs.length, 0); assert.equal(Object.keys(wrong.store.footballPlayerLoads).length, 0);
  const file = serviceContext(); file.store.leagues['api:39'].source = 'csv';
  await assert.rejects(file.service.load(loadArgs), /archivos de equipos/);
});

test('expanded football loading can use the last five requests but never requests with zero remaining', async () => {
  const available = serviceContext({ quota: { remaining: 2, checkedAt: new Date().toISOString() }, getPolicy: () => ({ reserve: 0 }) });
  assert.equal((await available.service.load(loadArgs)).imported, 2); assert.equal(available.calls(), 1);
  const exhausted = serviceContext({ quota: { remaining: 0, checkedAt: new Date().toISOString() }, getPolicy: () => ({ reserve: 0 }) });
  assert.match((await exhausted.service.load(loadArgs)).warning, /Presupuesto/); assert.equal(exhausted.calls(), 0);
});

test('loading is bounded to five games per click and continues beyond completed games', async () => {
  const ctx = serviceContext({ respond: async (_endpoint, params) => {
    const target = ctx.store.matches.find(match => match.id === String(params.id));
    return [{ ...fixture, fixture: { ...fixture.fixture, id: params.id, date: target.date } }];
  } });
  ctx.store.matches = Array.from({ length: 12 }, (_, i) => ({ ...match, id: String(100 + i), date: `2024-09-${String(i + 1).padStart(2, '0')}T18:00:00Z` }));
  const first = await ctx.service.load({ ...loadArgs, lookback: 15 });
  assert.equal(first.processed, 5); assert.equal(first.remainingGames, 7); assert.equal(first.requests, 5);
  const next = await ctx.service.load({ ...loadArgs, lookback: 15 });
  assert.equal(next.processed, 5); assert.equal(next.remainingGames, 2); assert.equal(ctx.calls(), 10);
});

test('25 and 30 player loading windows retain the five-request batch limit', async () => {
  for (const lookback of [25, 30]) {
    const ctx = serviceContext({ respond: async (_endpoint, params) => {
      const target = ctx.store.matches.find(row => row.id === String(params.id));
      return [{ ...fixture, fixture: { ...fixture.fixture, id: params.id, date: target.date } }];
    } });
    ctx.store.matches = Array.from({ length: 40 }, (_, i) => ({ ...match, id: String(100 + i),
      date: new Date(Date.UTC(2024, 7, i + 1, 18)).toISOString() }));
    const result = await ctx.service.load({ ...loadArgs, lookback });
    assert.equal(result.processed, 5); assert.equal(result.requests, 5);
    assert.equal(result.remainingGames, lookback - 5);
  }
});

test('partial provider failure retains imports and leaves failed games pending', async () => {
  let attempt = 0;
  const ctx = serviceContext({ respond: async (_endpoint, params) => {
    if (++attempt > 1) throw new Error('Plan gratuito sin esta temporada');
    const target = ctx.store.matches.find(match => match.id === String(params.id));
    return [{ ...fixture, fixture: { ...fixture.fixture, id: params.id, date: target.date } }];
  } });
  ctx.store.matches.push({ ...match, id: '101', date: '2024-09-02T18:00:00Z' });
  const result = await ctx.service.load(loadArgs);
  assert.equal(result.imported, 2); assert.equal(result.available, 1); assert.equal(result.remainingGames, 1);
  assert.match(result.warning, /Plan gratuito/); assert.equal(ctx.saved(), 1);
});

test('empty-game retries expire after a day, including the cached response, and exclude unfinished-time cutoffs', async () => {
  let ttl;
  const ctx = serviceContext({ respond: async (_endpoint, _params, duration) => { ttl = duration; return [fixture]; } });
  const old = Date.now() - 25 * 3600000;
  ctx.store.cache['/fixtures?id=100'] = { savedAt: old, data: [{ ...fixture, players: [] }] };
  ctx.store.footballPlayerLoads = { 'api:39:2024:100': { checkedAt: new Date(old).toISOString(), records: 0 } };
  const loaded = await ctx.service.load(loadArgs);
  assert.equal(loaded.requests, 1); assert.equal(ttl, 86400000); assert.equal(loaded.imported, 2);
  await assert.rejects(ctx.service.load({ ...loadArgs, cutoff: '2024-09-01T20:00:00Z' }), /Sin partidos/);
});

test('league batches prioritize uncovered teams, advance without duplicate requests and stay within per-team windows', async () => {
  const ctx = serviceContext({ respond: async (_endpoint, params) => {
    const target = ctx.store.matches.find(item => String(item.id) === String(params.id));
    return [{ ...fixture, fixture: { ...fixture.fixture, id: params.id, date: target.date },
      teams: { home: { id: 1, name: target.home }, away: { id: 2, name: target.away } } }];
  } });
  ctx.store.matches = [['100', 'A', 'B', 10], ['101', 'A', 'C', 9], ['102', 'C', 'D', 8], ['103', 'A', 'B', 7], ['104', 'E', 'F', 6]]
    .map(([id, home, away, day]) => ({ ...match, id, home, away, date: `2024-09-${String(day).padStart(2, '0')}T18:00:00Z` }));
  await ctx.service.load({ ...loadArgs, maxGames: 1 });
  const batch = { ...args, team: '', scope: 'league', lookback: 5, maxGames: 1 };
  const first = await ctx.service.load(batch); assert.equal(first.processed, 1); assert.equal(first.teamsCovered, 4);
  assert.ok(ctx.store.footballPlayerLoads['api:39:2024:102'], 'C and D precede games of already represented teams');
  const second = await ctx.service.load(batch); assert.equal(second.teamsCovered, 6); assert.equal(second.teamsTotal, 6);
  assert.ok(ctx.store.footballPlayerLoads['api:39:2024:104']);
  const coverage = ctx.service.state().catalog[0].seasonsInfo['2024'].teamCoverage;
  assert.equal(coverage.A.games, 1); assert.equal(coverage.E.players, 1); assert.equal(coverage.E.games, 1);
  await ctx.service.load({ ...batch, maxGames: 5 }); const count = ctx.calls();
  const completed = await ctx.service.load(batch); assert.equal(completed.remainingGames, 0); assert.equal(ctx.calls(), count);
  for (const patch of [{ scope: 'bad' }, { maxGames: 6 }, { maxGames: 0 }, { lookback: 1 }]) await assert.rejects(ctx.service.load({ ...batch, ...patch }));
});

test('league team coverage requires actual individual logs, not just another team in the same fixture', async () => {
  const ctx = serviceContext({ respond: async () => [{ ...fixture, players: [fixture.players[0]] }] });
  const result = await ctx.service.load({ ...args, scope: 'league', lookback: 5 });
  assert.equal(result.teamsTotal, 2); assert.equal(result.teamsCovered, 1);
  const coverage = ctx.service.state().catalog[0].seasonsInfo['2024'].teamCoverage;
  assert.equal(coverage.A.games, 1); assert.equal(coverage.B.games, 0);
});

const assistEntry = (patch = {}) => ({ player: { id: 11, name: 'Asistente' }, statistics: [{
  league: { id: 39, season: 2024 }, team: { id: 1, name: 'A' }, games: { appearences: 35, minutes: 2800 }, goals: { assists: 12 }, ...patch }] });

test('tournament assist leaders validate competition and season and never invent per-game logs', () => {
  const records = [assistEntry(), assistEntry({ league: { id: 39, season: 2023 } }), assistEntry({ goals: { assists: null } }),
    assistEntry({ league: { id: 140, season: 2024 } }), assistEntry({ goals: { assists: 0 } }), { statistics: {} }, null];
  const result = parseFootballAssistLeaders(records, 39, 2024);
  assert.equal(result.length, 2); assert.equal(result[0].assists, 12); assert.equal(result[0].minutes, 2800);
  assert.equal(result[0].appearances, 35); assert.equal(result[1].providerRank, 5); assert.equal(result[1].assists, 0);
  assert.equal(result[0].date, undefined); assert.equal(result[0].values, undefined);
  assert.deepEqual(parseFootballAssistLeaders([{ ...assistEntry(), statistics: [...assistEntry().statistics, ...assistEntry().statistics] }], 39, 2024), []);
  assert.equal(parseFootballAssistLeaders(Array(25).fill(assistEntry()), 39, 2024).length, 20);
});

test('assist leaderboard requires an explicit refresh, bounds quota and keeps aggregates separate', async () => {
  const ctx = serviceContext({ respond: async (endpoint, params, ttl) => {
    assert.equal(endpoint, '/players/topassists'); assert.deepEqual(params, { league: 39, season: 2024 });
    assert.equal(ttl, 6 * 3600000); return [assistEntry()];
  } });
  assert.equal((await ctx.service.assistLeaders(args)).report, null); assert.equal(ctx.calls(), 0);
  const oldMatches = structuredClone(ctx.store.matches);
  const report = await ctx.service.assistLeaders({ ...args, refresh: true });
  assert.equal(report.requests, 1); assert.equal(report.report.rows[0].assists, 12); assert.equal(ctx.calls(), 1);
  assert.equal(ctx.store.playerLogs.length, 0); assert.deepEqual(ctx.store.matches, oldMatches);
  assert.match(report.report.note, /no aplican.*fecha de corte/); assert.equal(ctx.saved(), 1);
  const cached = await ctx.service.assistLeaders({ ...args, cutoff: '2024-01-01' });
  assert.deepEqual(cached.report, report.report); assert.equal(ctx.calls(), 1);
  const noKey = serviceContext({ withKey: false }); noKey.store.footballAssistLeaders = structuredClone(ctx.store.footballAssistLeaders);
  assert.equal((await noKey.service.assistLeaders(args)).report.rows.length, 1);
  await assert.rejects(noKey.service.assistLeaders({ ...args, refresh: true }), /Conecta/); assert.equal(noKey.calls(), 0);
  const reserved = serviceContext({ quota: { remaining: 5, checkedAt: new Date().toISOString() } });
  await assert.rejects(reserved.service.assistLeaders({ ...args, refresh: true }), /Presupuesto/); assert.equal(reserved.calls(), 0);
  const empty = serviceContext({ respond: async () => [] }); empty.store.footballAssistLeaders = structuredClone(ctx.store.footballAssistLeaders);
  await assert.rejects(empty.service.assistLeaders({ ...args, refresh: true }), /guardado se conserva/);
  assert.deepEqual(empty.store.footballAssistLeaders, ctx.store.footballAssistLeaders);
  const unavailable = serviceContext(); unavailable.store.leagues['api:39'].coverageBySeason[2024].top_assists = false;
  await assert.rejects(unavailable.service.assistLeaders({ ...args, refresh: true }), /no declara/); assert.equal(unavailable.calls(), 0);
});

test('assist report records the original provider cache timestamp, not the later read time', async () => {
  const ctx = serviceContext({ respond: async () => [assistEntry()] });
  const savedAt = Date.now() - 2 * 3600000;
  ctx.store.cache['/players/topassists?league=39&season=2024'] = { savedAt, data: [assistEntry()] };
  const result = await ctx.service.assistLeaders({ ...args, refresh: true });
  assert.equal(result.requests, 0); assert.equal(result.report.fetchedAt, new Date(savedAt).toISOString());
});

test('unloaded competition presets are visible without fake teams or individual records', () => {
  const ctx = serviceContext();
  const service = createFootballPlayersService({ getStore: () => ctx.store, connected: () => false, getQuota: () => null,
    getPresets: () => [{ key: 'preset:chile', name: 'Chile', loadedKeys: [] }, { key: 'preset:loaded', loadedKeys: ['api:39'] }] });
  assert.equal(service.state().pending.length, 1); assert.equal(service.state().catalog.length, 1);
  assert.equal(service.state().pending[0].key, 'preset:chile'); assert.equal(ctx.store.playerLogs.length, 0);
});
