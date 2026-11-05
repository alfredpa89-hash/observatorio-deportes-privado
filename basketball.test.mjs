import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBasketballReport, priorGames, forecastPlayer, MODEL_VERSION, marketOutcome } from './basketball-model.mjs';
import { evaluate, fitCalibration, historicalEvaluation, prospectiveEvaluation } from './basketball-evaluation.mjs';
import { parseBasketballGames, parsePlayerStats, attachTeamStats, regularNba, basketballSeason } from './basketball-data.mjs';
import { createBasketballService } from './basketball-service.mjs';

const games = (n = 60, league = 'euroleague') => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, league, season: '2026/2027',
  date: new Date(Date.UTC(2026, 6, i + 1, 18)).toISOString(), home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A',
  homePoints: 90 + i % 9, awayPoints: 75 + i % 7, finished: true, status: 'Final', seasonType: 2,
  stats: { home: { firstQuarterPoints: 25, halfTimePoints: 46, fieldGoalsAttempted: 65, freeThrowsAttempted: 20, offensiveRebounds: 8, turnovers: 12 },
    away: { firstQuarterPoints: 18, halfTimePoints: 37, fieldGoalsAttempted: 60, freeThrowsAttempted: 18, offensiveRebounds: 7, turnovers: 11 } } }));
const options = { league: 'euroleague', season: '2026/2027', home: 'A', away: 'B', cutoff: '2026-10-10T12:00:00Z', lookback: 20 };
const playerRows = (n = 20) => games(n).map((game, i) => ({ id: `p${i}`, league: 'euroleague', matchId: game.id, date: game.date,
  season: game.season, name: 'Jugador', team: 'A', minutes: 30, values: { points: 20 + i % 5, rebounds: 5, assists: 4, pra: 29 + i % 5, threes: 2 } }));

test('basketball uses separate real period models, bounded complementary markets and possessions', () => {
  const report = buildBasketballReport({ ...options, matches: games() });
  assert.equal(report.markets.length, 16);
  for (const prefix of ['', 'q1-', 'ht-']) assert.equal(report.markets.find(m => m.id === prefix + 'total-over').probability + report.markets.find(m => m.id === prefix + 'total-under').probability, 100);
  assert.equal(report.markets[0].probability + report.markets[1].probability, 100);
  assert.ok(Math.abs(report.markets.filter(m => m.group === 'q1-winner').reduce((sum, m) => sum + m.probability, 0) - 100) < 0.02);
  assert.ok(report.meta.periods.ft.pace > 50);
  assert.ok(report.meta.periods.q1.total < report.meta.periods.ht.total);
  assert.notEqual(report.meta.periods.q1.total, report.meta.periods.ft.total / 4);
});
test('missing quarter/half/pace data remains unavailable, not a final-score fraction', () => {
  const report = buildBasketballReport({ ...options, matches: games().map(game => ({ ...game, stats: {} })) });
  assert.equal(report.meta.periods.q1, null); assert.equal(report.meta.periods.ht, null); assert.equal(report.meta.periods.ft.pace, null);
  assert.equal(report.markets.find(m => m.id === 'q1-total-over').probability, null);
});
test('availability excludes overlapping, future, other-league and preseason results', () => {
  const history = games(), r = buildBasketballReport({ ...options, matches: history });
  const additions = [
    { ...history[0], id: 'overlap', date: '2026-10-10T11:00Z', homePoints: 180 },
    { ...history[0], id: 'future', date: '2026-10-11T11:00Z' },
    { ...history[0], id: 'pre', preseason: true },
    { ...history[0], id: 'other', league: 'nba' },
    { ...history[0], id: 'late', availableAfter: '2026-10-11T11:00Z' },
    { ...history[0], id: 'bad-end', date: '2026-10-10T11:00Z', availableAfter: '2026-10-09T11:00Z' },
  ];
  assert.deepEqual(buildBasketballReport({ ...options, matches: [...history, ...additions] }).markets, r.markets);
  assert.equal(priorGames([...history, ...additions], options.cutoff, 'euroleague').length, 60);
  assert.deepEqual(buildBasketballReport({ ...options, matches: [...history, { ...history[0], id: 'next-season', season: '2027/2028' }] }).markets, r.markets);
});
test('5/10/15/20/25/30 windows are exact for full games and periods', () => {
  for (const lookback of [5, 10, 15, 20, 25, 30]) {
    const result = buildBasketballReport({ ...options, matches: games(), lookback });
    assert.equal(result.meta.periods.ft.homeN, lookback); assert.equal(result.history.home.length, lookback);
    assert.equal(result.meta.periods.q1.homeN, lookback); assert.equal(result.meta.periods.ht.awayN, lookback);
  }
  assert.throws(() => buildBasketballReport({ ...options, matches: games(), totalLine: 160 }), /terminar/);
  assert.throws(() => buildBasketballReport({ ...options, matches: games(), lookback: 9 }), /Selecciona/);
});
test('calibration never uses a future date, another model/window or non-reference total', () => {
  const fit = { winner: { temperature: 0.5, n: 200, trainedThrough: '2026-10-01T00:00Z', version: MODEL_VERSION, lookback: 20 },
    total: { temperature: 0.5, n: 200, trainedThrough: '2026-10-01T00:00Z', version: MODEL_VERSION, lookback: 20 } };
  assert.equal(buildBasketballReport({ ...options, matches: games(), calibration: fit }).markets[0].calibrated, true);
  assert.equal(buildBasketballReport({ ...options, matches: games(), calibration: fit, lookback: 10 }).markets[0].calibrated, false);
  assert.equal(buildBasketballReport({ ...options, matches: games(), calibration: fit, lookback: 30 }).markets[0].calibrated, false);
  assert.equal(buildBasketballReport({ ...options, matches: games(), calibration: fit, totalLine: 180.5 }).markets.find(m => m.id === 'total-over').calibrated, false);
  fit.winner.trainedThrough = '2026-10-12T00:00Z';
  assert.equal(buildBasketballReport({ ...options, matches: games(), calibration: fit }).markets[0].calibrated, false);
});
test('player forecasts account for minutes, exact windows and DNP without fabricating PRA', () => {
  const records = [...playerRows(), { ...playerRows()[0], id: 'dnp', date: '2026-10-01T18:00Z', minutes: 0, values: { points: 0 } }];
  const full = forecastPlayer({ records, ...options, player: 'Jugador', metric: 'points', line: 20.5, projectedMinutes: 30 });
  const half = forecastPlayer({ records, ...options, player: 'Jugador', metric: 'points', line: 20.5, projectedMinutes: 15 });
  assert.equal(full.n, 20); assert.equal(full.history.length, 20); assert.ok(half.expected < full.expected);
  assert.equal(full.over + full.under, 100); assert.equal(full.conditionalOnPlaying, true);
  assert.equal(forecastPlayer({ records, ...options, player: 'Jugador', status: 'out' }).over, null);
  const missing = records.map(row => ({ ...row, values: { ...row.values, pra: null } }));
  assert.equal(forecastPlayer({ records: missing, ...options, player: 'Jugador', metric: 'pra' }).n, 0);
  assert.throws(() => forecastPlayer({ records, ...options, player: '' }), /Selecciona/);
  assert.throws(() => forecastPlayer({ records, ...options, player: 'Jugador', cutoff: 'invalid' }), /Fecha/);
  assert.equal(forecastPlayer({ records: records.map(row => ({ ...row, season: '2027/2028' })), ...options, player: 'Jugador' }).n, 0);
  for (const lookback of [25, 30]) {
    const extended = forecastPlayer({ records: playerRows(40), ...options, lookback, player: 'Jugador' });
    assert.equal(extended.n, lookback); assert.equal(extended.history.length, lookback);
  }
});
test('evaluation scores probabilities and excludes missing/push records; empty bins are null', () => {
  const result = evaluate([{ probability: .8, outcome: 1 }, { probability: .2, outcome: 0 }, { probability: .6, outcome: null }, { probability: .5, outcome: 'push' }]);
  assert.equal(result.n, 2); assert.equal(result.accuracy, 100); assert.equal(result.brier, .04); assert.equal(result.missing, 1); assert.equal(result.pushes, 1);
  assert.equal(result.bins[0].predicted, null); assert.ok(result.bins[8].high > result.bins[8].low);
  assert.deepEqual(fitCalibration([{ group: 'winner', probability: .8, outcome: 1 }], options.cutoff), {});
});
test('historical evaluation has an independent chronological tail and explicit research lines', () => {
  const result = historicalEvaluation({ matches: games(200), league: 'euroleague', lookback: 20, season: '2026/2027' });
  assert.ok(result.n <= 60 && result.n > 0); assert.ok(result.first > result.calibration.winner.trainedThrough);
  assert.equal(result.summary.winner.n, result.n); assert.equal(result.summary.total.n, result.n);
  assert.match(result.note, /no cuotas/); assert.ok(result.mae.q1 !== null);
});
test('settlement respects actual quarters, handicap refunds and absent player records', () => {
  const game = games()[0];
  assert.equal(marketOutcome({ spec: { type: 'total', period: 'q1', line: 42.5, direction: 'over' } }, game), 1);
  assert.equal(marketOutcome({ spec: { type: 'spread', period: 'ft', line: -15, side: 'home' } }, game), 'push');
  assert.equal(marketOutcome({ spec: { type: 'player', player: 'Jugador', team: 'A', metric: 'points', line: 15.5, direction: 'over' } }, game, []), null);
});

const apiGame = (id, status = 'FT', date = '2026-10-08T18:00:00Z') => ({ id, date, status: { short: status }, league: { id: 50, season: '2026-2027' }, teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } },
  scores: { home: { total: 90, quarter_1: 25, quarter_2: 22 }, away: { total: 80, quarter_1: 20, quarter_2: 18 } } });
test('provider seasons normalize integer Euroleague years and NBA pairs without mixing years', () => {
  for (const value of [2026, '2026', '2026-2027', '2026/2027']) assert.equal(basketballSeason(value), '2026/2027');
  for (const value of [null, undefined, true, '2026-2026', '2026-2028', '2026.5', '']) assert.equal(basketballSeason(value), null);
  const parsed = parseBasketballGames({ response: [
    { ...apiGame(1), league: { id: 50, season: 2026 } },
    { ...apiGame(2), league: { id: 50, season: 2025 } },
    { ...apiGame(3), league: { id: 50, season: '2026-2028' } },
  ] }, { league: 'euroleague', season: '2026/2027', leagueId: 50, now: options.cutoff });
  assert.equal(parsed.matches.length, 1); assert.equal(parsed.skipped, 2);
  assert.equal(parsed.matches[0].season, '2026/2027');
});
test('provider parser excludes live scores, placeholders, unknown leagues, preseason and invalid dates', () => {
  const parsed = parseBasketballGames({ response: [apiGame(1), apiGame(2, 'Q2'), apiGame(3, 'NS', '2026-10-12T18:00:00Z'), { ...apiGame(4), date: 'invalidZ' }] }, { league: 'euroleague', season: '2026/2027', leagueId: 50, now: '2026-10-10T18:00:00Z' });
  assert.equal(parsed.matches.length, 1); assert.equal(parsed.fixtures.length, 1); assert.equal(parsed.matches[0].stats.home.halfTimePoints, 47);
  assert.equal(parsed.fixtures[0].homePoints, undefined);
  const nba = parseBasketballGames({ response: [apiGame(1), apiGame(3, 'NS', '2026-10-21T18:00:00Z')] }, { league: 'nba', season: '2026/2027', leagueId: 50, now: '2026-10-10T18:00:00Z' });
  assert.equal(nba.matches.length, 0); assert.equal(nba.fixtures.length, 1);
  assert.equal(regularNba('2025-12-17T01:00:00Z', '2025/2026'), false);
  assert.equal(regularNba('2026-12-12T01:00:00Z', '2026/2027'), false);
  assert.equal(regularNba('2026-02-16T01:00:00Z', '2025/2026', 'All-Star'), false);
  assert.equal(regularNba('2026-04-13T18:00:00Z', '2025/2026'), false);
});
test('provider stats use made threes, correct game/team and complete PRA, not DNP zeros', () => {
  const game = parseBasketballGames({ response: [apiGame(1)] }, { league: 'euroleague', season: '2026/2027', leagueId: 50, now: options.cutoff }).matches[0];
  const p = { game: { id: 1 }, team: { id: 1 }, player: { id: 8, name: 'Jugador' }, minutes: '27:30', points: 20, rebounds: { total: 5 }, assists: 4, threepoint_goals: { total: 3, attempts: 9 } };
  const rows = parsePlayerStats({ response: [p, { ...p, minutes: '0:00' }, { ...p, game: { id: 999 } }] }, game);
  assert.equal(rows.length, 1); assert.equal(rows[0].minutes, 27.5); assert.equal(rows[0].values.pra, 29); assert.equal(rows[0].values.threes, 3);
  assert.equal(parsePlayerStats({ response: [{ ...p, assists: null }] }, game)[0].values.pra, null);
  assert.equal(attachTeamStats({ response: [{ game: { id: 1 }, team: { id: 1 }, field_goals: { attempts: 66 }, rebounds: { total: 38, offence: 10 }, turnovers: 11 }] }, game), 1);
  assert.equal(game.stats.home.fieldGoalsAttempted, 66); assert.equal(game.stats.home.freeThrowsAttempted, null);
});
function serviceFixture() {
  const store = { basketball: { datasets: { euroleague: { '2026/2027': { matches: games(), fixtures: [
    { id: 'next', league: 'euroleague', season: '2026/2027', date: '2026-10-10T18:00:00Z', home: 'A', away: 'B', status: 'NS' },
    { id: 'started', league: 'euroleague', season: '2026/2027', date: '2026-10-10T11:00:00Z', home: 'A', away: 'B', status: 'NS' },
  ] } } } } };
  let time = new Date(options.cutoff), saves = 0;
  const service = createBasketballService({ getStore: () => store, persist: async () => { saves++; }, getApiKey: () => null, now: () => time, sports: { load: async () => {} } });
  return { store, service, setTime: value => { time = new Date(value); }, saves: () => saves };
}
test('trial seals only before start, is immutable/idempotent, survives source corrections and audits hashes', async () => {
  const { service, store, setTime } = serviceFixture();
  await service.startTrial(); const original = structuredClone(store.basketball.trial.snapshots);
  assert.equal(original.length, 1); assert.equal(service.audit().valid, true);
  store.basketball.datasets.euroleague['2026/2027'].matches[0].homePoints = 160;
  store.basketball.datasets.euroleague['2026/2027'].matches[0].stats.home.firstQuarterPoints = 30;
  store.basketball.datasets.euroleague['2026/2027'].fixtures[0].status = 'Q1';
  await service.startTrial(); assert.deepEqual(store.basketball.trial.snapshots, original);
  assert.equal(service.audit().valid, true);
  const final = { ...games()[0], id: 'next', date: '2026-10-10T18:00:00Z' }; store.basketball.datasets.euroleague['2026/2027'].matches.push(final);
  setTime('2026-10-11T12:00:00Z');
  const summary = service.trialSummary(); assert.equal(summary.perLeague.euroleague.completed, 1); assert.equal(summary.perLeague.euroleague.summary.winner.n, 1);
  assert.equal(service.audit().valid, true);
  store.basketball.trial.snapshots[0].markets[0].probability = 99;
  assert.equal(service.audit().valid, false);
  assert.equal(service.trialSummary().perLeague.euroleague.invalid, 1);
  assert.equal(service.trialSummary().perLeague.euroleague.completed, 0);
});
test('trial has no made-up Euroleague history, blocks incompatible model changes and ends in Guayaquil', async () => {
  const { service, store, setTime } = serviceFixture(); await service.startTrial();
  store.basketball.trial.version = 'different';
  await assert.rejects(service.refresh({ league: 'euroleague' }), /version/);
  setTime('2026-11-01T05:00:00Z'); assert.equal(service.trialSummary().active, false);
  await assert.rejects(service.startTrial(), /terminado/);
});
test('prospective evaluation counts complement pairs once and keeps absent period results missing', () => {
  const game = games()[0], report = buildBasketballReport({ ...options, matches: games() });
  const snapshot = { id: 's', createdAt: '2026-06-01T00:00:00Z', fixture: game, markets: report.markets, predictions: report.meta.periods };
  const result = prospectiveEvaluation([snapshot], [game]);
  assert.equal(result.summary.winner.n, 1); assert.equal(result.summary.total.n, 1);
  const incomplete = { ...game, stats: {} };
  assert.equal(prospectiveEvaluation([snapshot], [incomplete]).summary['q1-total'].n, 0);
});

test('prospective evaluation excludes postponed games and compares a frozen past-only baseline', () => {
  const game = games()[0], report = buildBasketballReport({ ...options, matches: games() });
  const snapshot = { id: 's', createdAt: '2026-06-01T00:00:00Z', fixture: game, markets: report.markets,
    predictions: report.meta.periods, baseline: { probability: .6, total: 160 } };
  const result = prospectiveEvaluation([snapshot], [{ ...game, id: 'different-provider' }]);
  assert.equal(result.completed, 1); assert.equal(result.baseline.n, 1); assert.equal(result.baseline.brier, .16);
  assert.equal(result.baseline.totalMae, 5);
  const changed = prospectiveEvaluation([snapshot], [{ ...game, date: '2026-07-03T18:00:00Z' }]);
  assert.equal(changed.rescheduled, 1); assert.equal(changed.completed, 0);
});

test('free detail quota preserves requests for fixture and result refreshes', async () => {
  const { store } = serviceFixture();
  Object.assign(store.basketball, { catalogAt: options.cutoff, catalog: [{ id: 50, name: 'Euroleague', seasons: [{ season: '2026-2027' }] }],
    quota: { day: '2026-10-10', used: 30, detailUsed: 24, remaining: 70 } });
  const dataset = store.basketball.datasets.euroleague['2026/2027'];
  Object.assign(dataset, { loadedAt: options.cutoff, source: 'API-Basketball', coverage: { games: { statistics: { players: true, teams: true } } } });
  dataset.matches.forEach((game, index) => { game.apiId = index + 1; });
  const service = createBasketballService({ getStore: () => store, persist: async () => {}, getApiKey: () => 'a'.repeat(32), now: () => new Date(options.cutoff) });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No more detail requests expected'); };
  try { const result = await service.refresh({ league: 'euroleague' }); assert.equal(result.state.quota.used, 30); assert.equal(result.state.quota.detailUsed, 24); }
  finally { globalThis.fetch = nativeFetch; }
});
