import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketballResearch, parseResearchGames, parseResearchPlayers } from './basketball-research.mjs';

const NOW = '2026-10-11T16:00:00.000Z';
const catalog = [{ id: 120, name: 'Euroleague', seasons: [2026, 2024].map(season => ({ season, coverage: { games: { statistics: { teams: true, players: true } } } })) },
  { id: 117, name: 'ACB', country: { name: 'Spain' }, seasons: [{ season: '2026-2027', coverage: { games: { statistics: { teams: true, players: true } } } }] }];
const rawGame = (overrides = {}) => ({ id: 7, date: '2026-10-09T18:00:00Z', league: { id: 120, season: 2026 }, status: { short: 'FT' },
  teams: { home: { id: 1, name: 'Alpha' }, away: { id: 2, name: 'Beta' } }, scores: { home: { quarter_1: 20, quarter_2: 21, quarter_3: 22, quarter_4: 23, over_time: 0, total: 86 },
    away: { quarter_1: 18, quarter_2: 19, quarter_3: 20, quarter_4: 21, over_time: 0, total: 78 } }, ...overrides });
const parse = (rows, options = {}) => parseResearchGames({ response: rows }, { league: 'euroleague', season: '2026/2027', leagueId: 120, now: NOW, ...options });
function setup(provider, paid = false) {
  let current = NOW;
  const history = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, league: 'euroleague', season: '2026/2027', date: new Date(Date.UTC(2026, 8, i + 1, 18)).toISOString(),
    home: i % 2 ? 'Alpha' : 'Beta', away: i % 2 ? 'Beta' : 'Alpha', homePoints: 88 + i % 4, awayPoints: 76 + i % 5, finished: true,
    stats: { home: { firstQuarterPoints: 22, halfTimePoints: 46 }, away: { firstQuarterPoints: 18, halfTimePoints: 38 } } }));
  const fixture = { id: 'future', league: 'euroleague', season: '2026/2027', date: '2026-10-12T18:00:00.000Z', home: 'Alpha', away: 'Beta', finished: false, stats: {} };
  const players = history.slice(-10).map((game, index) => ({ id: `p${index}`, matchId: game.id, league: 'euroleague', season: '2026/2027', date: game.date,
    apiPlayerId: 10, name: 'Player A', team: 'Alpha', opponent: 'Beta', minutes: 30, source: 'API-Basketball', values: { points: 21 + index % 3, rebounds: 5, assists: 4, pra: 30 + index % 3, threes: 2 } }));
  const store = { basketball: { datasets: { euroleague: { '2026/2027': { matches: history, fixtures: [fixture] } } }, players, catalog, trial: { protocol: { locked: true }, snapshots: [], calibration: { untouched: true } } } };
  const frozen = structuredClone(store.basketball);
  const calls = [];
  const basketball = { state: () => ({ connected: true }), requestPolicy: () => ({ paid }), withProvider: action => action({ catalog: async () => store.basketball.catalog, request: async (endpoint, params) => { calls.push({ endpoint, params }); return provider ? provider(endpoint, params) : { response: [] }; } }) };
  const service = createBasketballResearch({ getStore: () => store, persist: async () => {}, basketball, now: () => new Date(current) });
  return { service, store, calls, frozen, fixture, setTime: value => { current = value; } };
}
const matchBody = { league: 'euroleague', season: '2026/2027', fixtureId: 'future', lookback: 20, totalLine: 160.5, spreadLine: -3.5, quarterLine: 40.5, halfLine: 80.5, teamTotalLine: 80.5, teamTotalSide: 'home' };
const playerBody = { ...matchBody, playerKey: 'API-Basketball:10', team: 'Alpha', metric: 'points', line: 20.5 };

test('data-center availability reaches prematch, daily and new research seals without touching October', async () => {
  const { service, store, frozen } = setup();
  store.contextReports = [{ ...availability, sport: 'basketball', key: 'euroleague', status: 'minutes_limit', minutesLimit: 10,
    publishedAt: '2026-10-11T10:00:00Z', recordedAt: NOW, expiresAt: '2026-10-13T18:00:00Z' }];
  assert.equal(service.prematchData().availability.length, 1); assert.equal(service.dailyData().availability.length, 1);
  const result = await service.seal(playerBody);
  assert.equal(result.playerProjection.projectedMinutes, 10); assert.equal(result.availabilityCount, 1);
  assert.deepEqual(store.basketball, frozen);
});

test('a newer same-provider team appearance blocks an obsolete team individual forecast', async () => {
  const { service, store } = setup();
  store.basketball.players.push({ ...store.basketball.players[0], id: 'transfer', date: '2026-10-10T18:00:00Z', team: 'Gamma' });
  await assert.rejects(service.seal(playerBody), /otro equipo/);
});

test('Pro details only load participants of today/tomorrow, including their needed previous-season history', async () => {
  const { service, store, calls, frozen } = setup(undefined, true);
  const relevant = parse([rawGame()]).games[0], unrelated = parse([rawGame({ id: 99,
    teams: { home: { id: 3, name: 'Gamma' }, away: { id: 4, name: 'Delta' } } })]).games[0];
  const previous = { ...relevant, id: 'old-api', apiId: 8, season: '2024/2025', date: '2025-04-01T18:00:00Z' };
  store.basketball.datasets.euroleague['2026/2027'].matches = [];
  store.basketballResearch = { schema: 1, games: [relevant, unrelated, previous,
    { id: 'later', league: 'euroleague', season: '2026/2027', date: '2026-10-13T18:00:00Z', home: 'Gamma', away: 'Delta', finished: false }], players: [], details: {}, availability: [], forecasts: [], inputs: {} };
  const result = await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.equal(result.teams, 2); assert.equal(result.focus.tomorrow, '2026-10-12');
  assert.deepEqual([...new Set(calls.map(call => call.params.id))].sort(), ['7', '8']);
  assert.deepEqual(store.basketball.trial, frozen.trial);
});

test('Pro saves its quota when no focused participants are known and blocks unrelated manual backfills', async () => {
  const { service, calls, setTime } = setup(undefined, true);
  await assert.rejects(service.syncPlayers({ league: 'euroleague', season: '2026/2027', team: 'Gamma' }), /Cuota Pro enfocada/);
  setTime('2026-10-14T16:00:00Z');
  const result = await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.equal(result.calls, 0); assert.equal(calls.length, 0); assert.equal(result.teams, 0);
});

test('focused historical detail checks use the actual coverage of their own season', async () => {
  const { service, store, calls } = setup(undefined, true);
  store.basketball.catalog = structuredClone(catalog);
  store.basketball.catalog[0].seasons[0].coverage.games.statistics = { teams: false, players: false };
  store.basketball.datasets.euroleague['2026/2027'].matches = [];
  store.basketballResearch = { schema: 1, games: [{ ...parse([rawGame()]).games[0], season: '2024/2025', date: '2025-04-01T18:00:00Z' }],
    players: [], details: {}, availability: [], forecasts: [], inputs: {} };
  await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.params.id === '7'));
});

test('direct Pro synchronization cannot fetch detail statistics for unrelated teams', async () => {
  const rows = [rawGame(), rawGame({ id: 99, teams: { home: { id: 3, name: 'Gamma' }, away: { id: 4, name: 'Delta' } } })];
  const { service, calls } = setup(endpoint => ({ response: endpoint === 'games' ? rows : [] }), true);
  await service.sync({ league: 'euroleague', season: '2026/2027' });
  assert.ok(calls.some(call => call.endpoint === 'games'));
  assert.ok(calls.filter(call => call.endpoint.startsWith('games/statistics/')).every(call => call.params.id === '7'));
});

test('Pro can obtain the cached previous-season game index only as context for focused participants', async () => {
  const fixture = rawGame({ id: 8, date: '2026-10-12T18:00:00Z', status: { short: 'NS' } });
  const previous = rawGame({ id: 77, date: '2026-04-01T18:00:00Z', league: { id: 120, season: 2025 } });
  const { service, store, calls } = setup((endpoint, params) => ({ response: endpoint === 'games' ? [params.season === 2026 ? fixture : previous] : [] }), true);
  store.basketball.catalog = structuredClone(catalog);
  store.basketball.catalog[0].seasons.push({ season: 2025, coverage: { games: { statistics: { teams: true, players: true } } } });
  store.basketball.datasets.euroleague['2026/2027'].matches = [];
  const result = await service.sync({ league: 'euroleague', season: '2026/2027', details: false });
  assert.equal(result.state.counts.games, 0);
  assert.deepEqual(calls.map(call => call.params.season), [2026, 2025]);
  await service.sync({ league: 'euroleague', season: '2026/2027', details: false }); assert.equal(calls.length, 2);
  await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.deepEqual([...new Set(calls.filter(call => call.endpoint.startsWith('games/statistics/')).map(call => call.params.id))], ['77']);
});

test('balanced background batches prioritize upcoming clubs, reuse both teams and retain empty detail retries', async () => {
  const { service, store, calls, frozen } = setup((endpoint, params) => {
    if (endpoint.endsWith('/teams')) return { response: [] };
    return { response: [1, 2].map(id => ({ game: { id: Number(params.id) }, team: { id }, player: { id: id * 10, name: `Player ${id}` }, minutes: '24:00', points: 12, rebounds: { total: 3 }, assists: 2, threepoint_goals: { total: 1 } })) };
  });
  const game = parse([rawGame()]).games[0];
  store.basketballResearch = { schema: 1, games: [game], players: [], availability: [], forecasts: [], inputs: {}, details: {} };
  const first = await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.equal(first.calls, 2); assert.equal(first.completed, 1); assert.equal(first.empty, 1);
  assert.equal(calls[0].endpoint, 'games/statistics/players');
  assert.deepEqual([...new Set(store.basketballResearch.players.map(row => row.team))].sort(), ['Alpha', 'Beta']);
  const count = calls.length; await service.syncBalanced({ league: 'euroleague', season: '2026/2027' });
  assert.equal(calls.length, count, 'complete and empty-within-day details must not be downloaded again');
  assert.deepEqual(store.basketball.trial, frozen.trial);
});
const availability = { league: 'euroleague', season: '2026/2027', team: 'Alpha', playerKey: 'API-Basketball:10', name: 'Player A', status: 'minutes_limit', minutesLimit: 15,
  publishedAt: '2026-10-11T10:00:00-05:00', expiresAt: '2026-10-12T12:00:00-05:00', sourceUrl: 'https://www.euroleaguebasketball.net/euroleague/news/report/' };

test('research parser keeps actual quarters and derives the half without inventing missing periods', () => {
  const [game] = parse([rawGame()]).games;
  assert.deepEqual(game.periods.home, { q1: 20, q2: 21, q3: 22, q4: 23, ht: 41, ot: 0, ft: 86 });
  const raw = rawGame(); raw.scores.home.quarter_2 = null;
  const partial = parse([raw]).games[0]; assert.equal(partial.periods.home.q1, 20); assert.equal(partial.periods.home.ht, null);
  raw.scores.home.quarter_2 = 80;
  const invalid = parse([raw]).games[0]; assert.equal(invalid.homePoints, 86); assert.equal(invalid.periods.home.q1, null); assert.equal(invalid.issues.length, 1);
  const overtime = rawGame({ status: { short: 'AOT' } }); overtime.scores.home.total = 92; overtime.scores.away.total = 85; overtime.scores.home.over_time = null; overtime.scores.away.over_time = null;
  assert.equal(parse([overtime]).games[0].periods.home.q4, 23); assert.equal(parse([overtime]).games[0].periods.home.ot, null);
});

test('research rejects wrong league/season, unconfirmed dates, pre-season and NBA Cup final', () => {
  const result = parse([rawGame(), rawGame({ league: { id: 117, season: 2026 } }), rawGame({ league: { id: 120, season: 2025 } }), rawGame({ date: '2026-10-09' }), rawGame({ stage: 'Preseason' })]);
  assert.equal(result.games.length, 1); assert.equal(result.skipped, 4);
  const nba = date => rawGame({ date, league: { id: 12, season: '2024-2025' }, teams: { home: { id: 1, name: 'Boston Celtics' }, away: { id: 2, name: 'Miami Heat' } } });
  const parsed = parse([nba('2024-10-10T18:00:00Z'), nba('2024-10-25T18:00:00Z'), nba('2024-12-18T01:00:00Z'), nba('2025-04-20T18:00:00Z')], { league: 'nba', season: '2024/2025', leagueId: 12 });
  assert.equal(parsed.games.length, 1); assert.equal(parsed.skipped, 3);
  assert.equal(parse([rawGame({ league: { id: 117, season: '2026-2027' } })], { league: 'endesa', leagueId: 117 }).games.length, 1);
});

test('NBA exhibitions without a stage are excluded from new and legacy research without deleting originals', () => {
  const options = { league: 'nba', season: '2024/2025', leagueId: 12 };
  const regular = rawGame({ id: 30, date: '2025-02-13T00:00:00Z', league: { id: 12, season: 2024 },
    teams: { home: { id: 1, name: 'Boston Celtics' }, away: { id: 2, name: 'Miami Heat' } } });
  const exhibition = { ...regular, id: 31, date: '2025-02-17T01:00:00Z',
    teams: { home: { id: 3, name: 'Shaq’s OGs' }, away: { id: 4, name: 'Chuck’s Global Stars' } } };
  const rising = { ...exhibition, id: 32, teams: { home: { id: 5, name: 'Candace’s Rising Stars' }, away: { id: 6, name: 'Kenny’s Young Stars' } } };
  const parsed = parse([regular, exhibition, rising], options);
  assert.equal(parsed.games.length, 1); assert.equal(parsed.skipped, 2);
  const { service, store } = setup();
  const ordinary = parsed.games[0], special = { ...ordinary, id: 'legacy-special', home: 'Shaq’s OGs', away: 'Chuck’s Global Stars' };
  store.sports = { nba: { datasets: { '2024/2025': { matches: [ordinary, special], fixtures: [] } } } };
  store.playerLogs = [ordinary, special].map((game, index) => ({ sport: 'nba', id: `legacy-player-${index}`, matchId: game.id,
    season: game.season, date: game.date, name: `Player ${index}`, team: game.home, opponent: game.away, minutes: 20, values: { points: 12 } }));
  const original = structuredClone(store), result = service.state(options);
  assert.equal(result.counts.games, 1); assert.equal(result.counts.players, 1);
  assert.deepEqual(result.teams.map(row => row.team), ['Boston Celtics', 'Miami Heat']);
  assert.deepEqual(store, original, 'filtering must preserve raw history and frozen trial');
});

test('individual archive distinguishes played, DNP and unknown, preserves missing PRA', () => {
  const game = parse([rawGame()]).games[0];
  const raw = (id, minutes, assists = 4) => ({ player: { id, name: `Player ${id}` }, game: { id: 7 }, team: { id: 1 }, type: 'starters', minutes, points: 20, rebounds: { total: 5 }, assists, threepoint_goals: { total: 2 } });
  const rows = parseResearchPlayers({ response: [raw(10, '27:30'), raw(11, '0:00'), raw(12, null), raw(13, '25:00', null)] }, game, NOW);
  assert.equal(rows[0].minutes, 27.5); assert.equal(rows[0].values.pra, 29);
  assert.equal(rows[1].participation, 'did_not_play'); assert.equal(rows[1].values.points, null);
  assert.equal(rows[2].minutes, null); assert.equal(rows[2].participation, 'unknown'); assert.equal(rows[3].values.pra, null);
});

test('Free sync preserves saved data on access denial and never mutates the October trial', async () => {
  const context = setup(() => { throw new Error('Free: permitido 2022-2024.'); });
  const result = await context.service.sync({ league: 'euroleague', season: '2026/2027' });
  assert.match(result.warning, /2022-2024/); assert.equal(result.state.counts.games, 30);
  assert.deepEqual(context.store.basketball, context.frozen);
  await context.service.sync({ league: 'euroleague', season: '2026/2027' }); assert.equal(context.calls.length, 1);
});

test('sync uses the selected catalog season, caches details and retains team statistics on the next load', async () => {
  const old = rawGame({ date: '2025-03-09T18:00:00Z', league: { id: 120, season: 2024 } });
  const context = setup((endpoint, params) => {
    if (endpoint === 'games') { assert.equal(params.season, 2024); return { response: [old] }; }
    if (endpoint.endsWith('/teams')) return { response: [1, 2].map(id => ({ game: { id: 7 }, team: { id }, field_goals: { attempts: 60 }, turnovers: 8 })) };
    return { response: [{ game: { id: 7 }, team: { id: 1 }, player: { id: 10, name: 'Player A' }, minutes: '25:00', points: 20, rebounds: { total: 5 }, assists: 4 }] };
  });
  const body = { league: 'euroleague', season: '2024/2025' };
  const result = await context.service.sync(body); assert.equal(result.details, 2); assert.equal(result.state.counts.players, 1);
  assert.equal(context.store.basketballResearch.games[0].stats.home.fieldGoalsAttempted, 60);
  context.setTime('2026-10-11T16:20:00.000Z'); await context.service.sync(body);
  assert.equal(context.calls.length, 4); assert.equal(context.store.basketballResearch.games[0].stats.home.fieldGoalsAttempted, 60);
  assert.deepEqual(context.store.basketball, context.frozen);
});

test('status redacts account details and does not infer a paid plan from key connection', async () => {
  const { service, store } = setup(() => ({ response: { account: { email: 'private@example.com', firstname: 'Private' }, subscription: { plan: 'Free', active: true, end: '2027-01-01T00:00:00Z' }, requests: { limit_day: 100 } } }));
  assert.equal(service.state().access, null); assert.equal((await service.verify()).dailyLimit, 100);
  assert.equal(store.basketballResearch.access.plan, 'Free'); assert.ok(!JSON.stringify(service.exportData()).includes('private@example.com'));
});

test('manual player-history enrichment is limited to four selected-team games, caches its schema and leaves October unchanged', async () => {
  const context = setup((endpoint, params) => {
    assert.equal(endpoint, 'games/statistics/players');
    return { response: [{ game: { id: Number(params.id) }, team: { id: 1 }, player: { id: 10, name: 'Player A' }, minutes: '24:00', points: 12,
      rebounds: { total: 3 }, assists: 2, field_goals: { total: 4, attempts: 10 }, threepoint_goals: { total: 2, attempts: 5 }, freethrows_goals: { total: 2, attempts: 3 } }] };
  });
  context.store.basketball.datasets.euroleague['2026/2027'].matches.forEach((game, index) => {
    game.apiId = 100 + index; game.homeId = game.home === 'Alpha' ? 1 : 2; game.awayId = game.away === 'Alpha' ? 1 : 2;
  });
  const before = structuredClone(context.store.basketball), body = { league: 'euroleague', season: '2026/2027', team: 'Alpha', lookback: 5 };
  const first = await context.service.syncPlayers(body);
  assert.equal(first.calls, 4); assert.equal(first.windowGames, 5); assert.equal(first.pending, 1);
  assert.equal(context.service.playerData().players.find(row => row.shooting)?.shooting.fieldGoalsAttempted, 10);
  assert.deepEqual(context.store.basketball, before);
  const again = await context.service.syncPlayers(body); assert.equal(again.cached, true); assert.equal(context.calls.length, 4);
  context.setTime('2026-10-11T16:20:00Z');
  const next = await context.service.syncPlayers(body); assert.equal(next.calls, 1); assert.equal(next.pending, 0);
  assert.deepEqual(context.store.basketball, before);
  await assert.rejects(context.service.syncPlayers({ ...body, team: 'Unknown' }));
  await assert.rejects(context.service.syncPlayers({ ...body, cutoff: '2026-09-01T00:00:00Z' }));
});

test('single-game enrichment resumes from the next missing game without changing the requested window', async () => {
  const context=setup((endpoint,params)=>({response:[{game:{id:Number(params.id)},team:{id:1},player:{id:10,name:'Player A'},minutes:'24:00',points:12,rebounds:{total:3},assists:2,threepoint_goals:{total:1}}]}));
  context.store.basketball.datasets.euroleague['2026/2027'].matches.forEach((game,index)=>{game.apiId=100+index;game.homeId=game.home==='Alpha'?1:2;game.awayId=game.away==='Alpha'?1:2;});
  const before=structuredClone(context.store.basketball);
  const body={league:'euroleague',season:'2026/2027',team:'Alpha',lookback:5,maxGames:1,resume:true};
  const first=await context.service.syncPlayers(body),next=await context.service.syncPlayers(body);
  assert.equal(first.calls,1);assert.equal(first.windowGames,5);assert.equal(first.pending,4);assert.equal(next.calls,1);assert.equal(next.pending,3);
  assert.notEqual(context.calls[0].params.id,context.calls[1].params.id);assert.deepEqual(context.store.basketball,before);
  await assert.rejects(context.service.syncPlayers({...body,maxGames:0}),/uno a cuatro/);
});

test('calendar-only load never requests statistics or overwrites saved player records', async()=>{
  const context=setup(endpoint=>{assert.equal(endpoint,'games');return {response:[rawGame()]};});
  const previous=structuredClone(context.store.basketball.players),result=await context.service.sync({league:'euroleague',season:'2026/2027',details:false});
  assert.equal(result.imported,1);assert.equal(result.details,0);assert.equal(context.calls.length,1);assert.deepEqual(context.store.basketball.players,previous);
});

test('individual enrichment stops after an access or quota error and does not replace saved player data', async () => {
  const context = setup(() => { throw new Error('Free: temporada bloqueada.'); });
  context.store.basketball.datasets.euroleague['2026/2027'].matches.forEach((game, index) => { game.apiId = 100 + index; });
  const before = structuredClone(context.store.basketball.players);
  const result = await context.service.syncPlayers({ league: 'euroleague', season: '2026/2027', team: 'Alpha' });
  assert.equal(result.calls, 1); assert.match(result.warning, /bloqueada/); assert.deepEqual(context.store.basketball.players, before);
  assert.equal(context.store.basketballResearch.players.length, 0);
});

test('manual reports require public HTTPS, nonfuture publication and bounded expiry', async () => {
  const { service } = setup();
  for (const change of [{ sourceUrl: 'http://example.com' }, { sourceUrl: 'https://user:secret@example.com' }, { sourceUrl: 'https://127.0.0.1/report' }, { publishedAt: '2026-10-12T10:00:00-05:00' }, { expiresAt: '2026-10-21T12:00:00-05:00' }, { minutesLimit: -1 }, { fixtureId: 'unknown' }]) await assert.rejects(service.saveAvailability({ ...availability, ...change }));
  const report = await service.saveAvailability(availability);
  assert.equal(report.recordedAt, NOW); assert.equal(report.verification, 'manual'); assert.equal(service.state().availability[0].stale, false);
});

test('player forecast uses the latest available report, seals inputs, and cannot rewrite the past', async () => {
  const { service, store, frozen, setTime } = setup();
  await service.saveAvailability(availability);
  const snapshot = await service.seal(playerBody); assert.equal(snapshot.playerProjection.projectedMinutes, 15); assert.equal(snapshot.playerProjection.conditionalOnPlaying, true);
  assert.equal(service.state().forecasts[0].valid, true);
  await service.saveAvailability({ ...availability, status: 'out' });
  assert.deepEqual(store.basketballResearch.forecasts[0], snapshot); assert.deepEqual(store.basketball, frozen);
  await assert.rejects(service.seal({ ...playerBody, line: 21.5 }), /baja/);
  setTime('2026-10-12T18:00:00.000Z'); await assert.rejects(service.seal(matchBody), /futuro/);
});

test('match forecasts exclude old seasons, separate Endesa, reject duplicate and missing input hashes', async () => {
  const { service, store, frozen } = setup();
  const snapshot = await service.seal(matchBody);
  assert.ok(snapshot.markets.find(item => item.id === 'team-total-over').probability >= 0);
  assert.equal(service.state().forecasts[0].valid, true);
  await assert.rejects(service.seal(matchBody), /Ya existe/);
  await assert.rejects(service.seal({ ...matchBody, league: 'endesa' }), /independiente/);
  delete store.basketballResearch.inputs[snapshot.inputHash]; assert.equal(service.state().evaluation.invalid, 1);
  assert.deepEqual(store.basketball, frozen);
});

test('future player outcome evaluates only actual participation, keeps metric-specific errors and no duplicate baseline', async () => {
  const { service, store, fixture, setTime } = setup();
  await service.seal(matchBody); await service.seal(playerBody);
  const finished = { ...fixture, finished: true, homePoints: 90, awayPoints: 82, stats: { home: { firstQuarterPoints: 24, halfTimePoints: 45 }, away: { firstQuarterPoints: 20, halfTimePoints: 42 } } };
  store.basketball.datasets.euroleague['2026/2027'].matches.push(finished);
  store.basketball.players.push({ id: 'actual', matchId: fixture.id, league: 'euroleague', season: fixture.season, date: fixture.date, apiPlayerId: 10, name: 'Player A', team: 'Alpha', minutes: 28, source: 'API-Basketball', values: { points: 25 } });
  setTime('2026-10-13T16:00:00.000Z');
  const result = service.evaluation('euroleague'); assert.equal(result.completed, 2); assert.equal(result.summary['player-points'].n, 1);
  assert.equal(result.minutesMae.value, 2); assert.equal(result.individualMae.points.n, 1); assert.equal(result.baseline.n, 1);
  assert.equal(result.summary['team-total-home'].n, 1); assert.ok(result.summary.total.brier >= 0);
  store.basketball.players.at(-1).minutes = 0;
  assert.equal(service.evaluation('euroleague').summary['player-points'].n, 0); assert.equal(service.evaluation('euroleague').summary['player-points'].missing, 1);
});

test('profiles honor 5/15 games, historical evaluation is isolated and requires enough data', async () => {
  const { service, store, frozen } = setup();
  assert.equal(service.state({ lookback: 5 }).players[0].games, 5); assert.equal(service.state({ lookback: 15 }).players[0].games, 10);
  assert.equal(service.state({ lookback: 5 }).teams[0].n, 5);
  await assert.rejects(service.backtest({ league: 'euroleague', season: '2026/2027' }), /100/);
  await assert.rejects(service.backtest({ league: 'endesa', season: '2026/2027' }), /independiente/);
  assert.deepEqual(store.basketball, frozen); assert.ok(service.exportData().archive.games.length >= 30);
});

test('expired newest availability cannot resurrect an older report', async () => {
  const { service, setTime } = setup();
  await service.saveAvailability({ ...availability, status: 'out', expiresAt: '2026-10-14T12:00:00-05:00' });
  await service.saveAvailability({ ...availability, status: 'active', publishedAt: '2026-10-11T10:30:00-05:00', expiresAt: '2026-10-11T12:00:00-05:00' });
  setTime('2026-10-11T18:00:00.000Z');
  const snapshot = await service.seal(playerBody); assert.equal(snapshot.playerProjection.status, 'unknown');
});
