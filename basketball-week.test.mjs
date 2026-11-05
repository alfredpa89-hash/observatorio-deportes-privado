import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekReport, weekRange } from './basketball-week.mjs';
import { createBasketballService } from './basketball-service.mjs';
import references from './research/euroleague-2026-10-11.json' with { type: 'json' };

const options = { league: 'euroleague', season: '2026/2027', now: '2026-10-11T16:00:00.000Z', references };

test('weekly range uses inclusive Guayaquil dates, Monday start and exclusive next midnight', () => {
  const range = weekRange(undefined, undefined, options.now);
  assert.equal(range.startDate, '2026-10-05'); assert.equal(range.endDate, '2026-10-11');
  assert.equal(new Date(range.start).toISOString(), '2026-10-05T05:00:00.000Z');
  assert.equal(new Date(range.end).toISOString(), '2026-10-12T05:00:00.000Z');
  assert.equal(weekRange(undefined, undefined, '2026-10-12T04:00:00Z').startDate, '2026-10-05');
  assert.equal(weekRange(undefined, undefined, '2026-10-12T05:00:00Z').startDate, '2026-10-12');
});

test('weekly range rejects impossible, reversed and unbounded ranges', () => {
  for (const [start, end] of [['2026-02-30', '2026-03-02'], ['bad', '2026-10-11'], ['2026-10-12', '2026-10-11'], ['2026-10-01', '2026-11-01']]) {
    assert.throws(() => weekRange(start, end, options.now));
  }
  assert.doesNotThrow(() => weekRange('2026-10-01', '2026-10-31', options.now));
});

test('official weekly references have correct period sums, separate player fields and explicit partial coverage', () => {
  const before = JSON.stringify(references), report = buildWeekReport(options);
  assert.equal(report.completed.length, 3); assert.equal(report.upcoming.length, 0);
  assert.deepEqual(report.totals.ft, { average: 162, n: 3, missing: 0 });
  assert.deepEqual(report.totals.q1, { average: 43, n: 3, missing: 0 });
  assert.equal(report.totals.ht.average, 236 / 3);
  const madrid = report.teams.find(team => team.team === 'Real Madrid');
  assert.equal(madrid.periods.ft.scored, 86); assert.equal(madrid.periods.ft.conceded, 76);
  assert.equal(madrid.periods.q1.scored, 27); assert.equal(madrid.periods.ht.scored, 53);
  assert.equal(madrid.wins, 1); assert.equal(madrid.games, 1);
  assert.equal(report.players.length, 6); assert.equal(report.coverage.complete, false);
  const montero = report.players.find(row => row.name === 'Jean Montero');
  assert.deepEqual(montero.values, { points: 16, rebounds: 4, assists: 2, threes: null, pra: 22 });
  assert.equal(montero.minutes, null);
  const robinson = report.players.find(row => row.name === 'Justin Robinson');
  assert.equal(robinson.values.points, 20); assert.equal(robinson.values.pra, null);
  assert.equal(robinson.values.assists, null); assert.equal(robinson.values.threes, null);
  assert.ok(report.completed.every(row => row.sourceUrl.startsWith('https://')));
  assert.equal(JSON.stringify(references), before);
});

test('today, future, league and season filters do not imply full coverage or create forecasts', () => {
  assert.equal(buildWeekReport({ ...options, startDate: '2026-10-11', endDate: '2026-10-11' }).completed.length, 0);
  const next = buildWeekReport({ ...options, startDate: '2026-10-11', endDate: '2026-10-17' });
  assert.equal(next.upcoming.length, 2); assert.equal(next.completed.length, 0);
  assert.equal(next.upcoming[0].date, '2026-10-13T18:30:00.000Z');
  assert.ok(next.upcoming.every(game => !game.report && !game.markets));
  for (const change of [{ league: 'nba' }, { season: '2025/2026' }]) {
    const result = buildWeekReport({ ...options, ...change });
    assert.equal(result.completed.length, 0); assert.equal(result.upcoming.length, 0); assert.equal(result.players.length, 0);
    assert.equal(result.totals.ft.average, null);
  }
});

test('stored game takes precedence over a club reference without duplicate counting', () => {
  const reference = references.games[1];
  const game = { ...reference, id: 'api-basketball:42', referenceOnly: false, home: 'Barcelona', timeKnown: true, date: '2026-10-09T18:30:00.000Z', source: 'API-Basketball' };
  const result = buildWeekReport({ ...options, matches: [game], fixtures: [{ ...game, finished: false }] });
  assert.equal(result.completed.length, 3); assert.equal(result.coverage.referenceGames, 2);
  assert.equal(result.coverage.storedGames, 1); assert.equal(result.upcoming.length, 0);
  assert.ok(result.completed.some(row => row.id === game.id));
  assert.equal(result.players.find(row => row.name === 'Justin Robinson').team, 'Barcelona');
});

test('missing periods do not become zeros or contribute to their average', () => {
  const game = { ...references.games[0], id: 'partial', date: '2026-10-07T18:00:00Z', home: 'Equipo A', away: 'Equipo B', referenceOnly: false,
    stats: { home: { firstQuarterPoints: null, halfTimePoints: 44 }, away: { firstQuarterPoints: 20, halfTimePoints: null } } };
  const result = buildWeekReport({ ...options, matches: [game] });
  assert.equal(result.completed.length, 4); assert.equal(result.totals.q1.n, 3); assert.equal(result.totals.q1.missing, 1);
  assert.equal(result.totals.ht.n, 3); assert.equal(result.totals.ht.missing, 1);
  assert.equal(result.teams.find(team => team.team === 'Equipo A').periods.q1.scored, null);
});

test('a connected player batch replaces partial club selections, avoiding abbreviated-name duplicates', () => {
  const game = { ...references.games[1], id: 'api-basketball:42', referenceOnly: false, source: 'API-Basketball' };
  const player = { matchId: game.id, league: options.league, season: options.season, name: 'Kevin Punter', team: game.home, minutes: 25,
    values: { points: 9, rebounds: 3, assists: 2, threes: 1 } };
  const result = buildWeekReport({ ...options, matches: [game], players: [player] });
  assert.equal(result.players.length, 2); assert.equal(result.coverage.referencePlayers, 1);
  assert.equal(result.players.find(row => row.name === player.name).values.pra, 14);
  assert.ok(!result.players.some(row => row.name === 'Punter'));
});

test('finished records cannot come from the future, and NBA pre-season never enters the weekly report', () => {
  const future = { ...references.games[0], date: '2026-10-12T18:00:00Z' };
  assert.equal(buildWeekReport({ ...options, references: {}, matches: [future], endDate: '2026-10-13' }).completed.length, 0);
  const nba = { ...references.games[0], league: 'nba', date: '2026-10-10T18:00:00Z' };
  assert.equal(buildWeekReport({ ...options, league: 'nba', references: {}, matches: [nba] }).completed.length, 0);
  const regular = { ...nba, date: '2026-10-21T18:00:00Z' };
  const result = buildWeekReport({ ...options, league: 'nba', references: {}, now: '2026-10-23T16:00:00Z', matches: [regular, { ...regular, id: 'pre', home: 'Other', preseason: true }] });
  assert.equal(result.completed.length, 1);
});

test('weekly service is read-only and references never become model history or trial evidence', () => {
  const store = { basketball: { datasets: {}, players: [], evaluations: {}, inputs: {}, detailCache: {}, quota: {}, trial: {
    startedAt: '2026-10-11T05:00:00Z', end: '2026-11-01T05:00:00Z', snapshots: [], calibration: {}, inputs: {} } } };
  const before = JSON.stringify(store);
  const service = createBasketballService({ getStore: () => store, persist: () => assert.fail('week must not persist'), now: () => new Date(options.now), references });
  assert.equal(service.week({}).completed.length, 3);
  assert.equal(JSON.stringify(store), before);
  assert.throws(() => service.report({ league: 'euroleague', home: 'Real Madrid', away: 'Partizan' }), /historial/);
  assert.throws(() => service.week({ league: 'other' }), /NBA o Euroliga/);
});
