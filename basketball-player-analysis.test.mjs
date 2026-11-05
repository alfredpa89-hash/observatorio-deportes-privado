import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketballPlayerAnalysis } from './basketball-player-analysis.mjs';
import { playerValues, targetRates, shootingSummary, defaultTargets, normalizeApiShooting, normalizeLegacyShooting } from './public/basketball-player-metrics.js';
import { parsePlayerStats } from './basketball-data.mjs';

test('player combinations need complete components from the same game; missing values never become zero', () => {
  const values = playerValues({ values: { points: 12, rebounds: 3, assists: null, pra: 99, threes: 0 } });
  assert.equal(values.pr, 15); assert.equal(values.pa, null); assert.equal(values.ra, null); assert.equal(values.pra, null);
  assert.equal(values.threes, 0); assert.equal(values.fieldGoalsMade, null);
  assert.equal(playerValues({ values: { points: -1, rebounds: 3, assists: 2 } }).pr, null);
});

test('individual targets use low and high thresholds, joint denominators, DNP exclusions and confidence intervals', () => {
  const rows = [
    { minutes: 20, values: { points: 8, rebounds: 4, assists: 2 } },
    { minutes: 20, values: { points: 15, rebounds: 6, assists: null } },
    { minutes: 0, values: { points: 100, rebounds: 100, assists: 100 } },
  ];
  const single = targetRates(rows, [{ metric: 'points', minimum: 5 }]);
  assert.equal(single.n, 2); assert.equal(single.frequency, 100); assert.ok(single.interval[0] < 100);
  const combined = targetRates(rows, [{ metric: 'points', minimum: 5 }, { metric: 'assists', minimum: 2 }]);
  assert.equal(combined.n, 1); assert.equal(combined.missing, 1);
  assert.equal(targetRates(rows, [{ metric: 'freeThrowsMade', minimum: 1 }]).frequency, null);
  assert.throws(() => targetRates(rows, [{ metric: 'points', minimum: 1.5 }]));
  assert.throws(() => targetRates(rows, [{ metric: 'unknown', minimum: 1 }]));
  assert.ok(defaultTargets('rebounds').some(rules => rules[0].minimum === 2));
  assert.ok(defaultTargets('combined').some(rules => rules.length === 3));
});

test('shooting percentages aggregate attempts, exclude missing pairs, and do not invent an accuracy for zero attempts', () => {
  const rows = [
    { shooting: { fieldGoalsMade: 1, fieldGoalsAttempted: 1, freeThrowsMade: 0, freeThrowsAttempted: 0 } },
    { shooting: { fieldGoalsMade: 1, fieldGoalsAttempted: 9 } },
    { shooting: { fieldGoalsMade: null, fieldGoalsAttempted: 5 } },
  ];
  const summary = shootingSummary(rows);
  assert.equal(summary[0].percentage, 20); assert.equal(summary[0].n, 2); assert.equal(summary[0].missing, 1);
  assert.equal(summary.find(item => item.label === 'Tiros libres').percentage, null); assert.equal(summary.find(item => item.label === 'Tiros libres').made, 0);
  const invalid = playerValues({ shooting: { fieldGoalsMade: 8, fieldGoalsAttempted: 7 } });
  assert.equal(invalid.fieldGoalsMade, null); assert.equal(invalid.fieldGoalsAttempted, null);
});

test('API shooting distinguishes two-point counts from inclusive field goals and reconciles real-shaped scoring', () => {
  const raw = { points: 17, fieldGoalsMade: 2, fieldGoalsAttempted: 5, threes: 4, threesAttempted: 5, freeThrowsMade: 1, freeThrowsAttempted: 1 };
  const separate = normalizeApiShooting(raw);
  assert.equal(separate.basis, 'two-point'); assert.equal(separate.fieldGoalsMade, 6); assert.equal(separate.fieldGoalsAttempted, 10);
  assert.equal(separate.twoPointersMade, 2); assert.equal(separate.twoPointersAttempted, 5);
  const inclusive = normalizeApiShooting({ ...raw, fieldGoalsMade: 6, fieldGoalsAttempted: 10 });
  assert.equal(inclusive.basis, 'all-field-goals'); assert.equal(inclusive.twoPointersMade, 2);
  const ambiguous = normalizeApiShooting({ ...raw, points: 5, fieldGoalsMade: 2, threes: 0 });
  assert.equal(ambiguous.fieldGoalsAttempted, null);
  const zeroThrees = normalizeApiShooting({ ...raw, points: 5, fieldGoalsMade: 2, threes: 0 }, 'two-point');
  assert.equal(zeroThrees.fieldGoalsAttempted, 10);
  const conflict = normalizeApiShooting({ ...raw, points: 99 }, 'two-point');
  assert.equal(conflict.basis, 'inconsistent'); assert.equal(conflict.fieldGoalsMade, null);
  const rows = normalizeLegacyShooting([
    { league: 'endesa', matchId: 'same', values: { points: 17, threes: 4 }, shooting: { ...raw, schema: 1 } },
    { league: 'endesa', matchId: 'same', values: { points: 5, threes: 0 }, shooting: { ...raw, schema: 1, fieldGoalsMade: 2 } },
  ]);
  assert.equal(rows[1].shooting.fieldGoalsAttempted, 10);
});

test('API player ingestion retains documented shooting counts separately from the frozen five model metrics', () => {
  const game = { apiId: 1, id: 'game', league: 'endesa', season: '2024/2025', date: '2025-01-01T18:00:00Z', homeId: 10, awayId: 20, home: 'A', away: 'B' };
  const rows = parsePlayerStats({ response: [{ game: { id: 1 }, team: { id: 10 }, player: { id: 99, name: 'P' }, minutes: '25:00', points: 15, rebounds: { total: 3 }, assists: 2,
    field_goals: { total: 5, attempts: 12 }, threepoint_goals: { total: 3, attempts: 6 }, freethrows_goals: { total: 2, attempts: 2 } }] }, game);
  assert.deepEqual(rows[0].values, { points: 15, rebounds: 3, assists: 2, threes: 3, pra: 20 });
  assert.equal(rows[0].shooting.fieldGoalsAttempted, 12); assert.equal(rows[0].shooting.threesAttempted, 6);
});

function setup() {
  const rows = Array.from({ length: 35 }, (_, i) => ({ id: `row${i}`, league: 'endesa', season: '2024/2025', name: 'P', playerKey: 'api:1',
    date: new Date(Date.UTC(2025, 0, i + 1, 18)).toISOString(), minutes: 25, team: i < 5 ? 'Old' : 'A', opponent: 'B',
    venue: i % 2 ? 'home' : 'away', values: { points: i, rebounds: i === 34 ? null : 4, assists: 2, threes: 1 } }));
  const saved = { players: rows, games: [] }, before = structuredClone(saved);
  const service = createBasketballPlayerAnalysis({ read: () => saved, now: () => new Date('2026-10-15T01:00:00Z') });
  return { rows, saved, before, service };
}

test('player research respects competition, season, cutoff, club and venue with an exact window before missing-metric filtering', () => {
  const { service, saved, before, rows } = setup();
  rows.push({ ...rows[0], id: 'future', date: '2027-01-01T18:00:00Z', values: { points: 999 } });
  const body = { league: 'endesa', season: '2024/2025', playerKey: 'api:1', lookback: 5 };
  const result = service.analyze(body);
  assert.equal(result.history.length, 5); assert.equal(result.metrics.pr.n, 4); assert.equal(result.metrics.pr.missing, 1);
  assert.equal(result.quality.ageDays > 90, true); assert.equal(result.quality.teams.length, 2);
  const home = service.analyze({ ...body, venue: 'home', team: 'A' });
  assert.ok(home.history.every(row => row.team === 'A' && row.venue === 'home'));
  const early = service.analyze({ ...body, cutoff: '2025-01-04T00:00:00Z' }); assert.equal(early.history.length, 2);
  assert.equal(service.catalog({ league: 'nba', season: '2024/2025' }).players.length, 0);
  assert.equal(service.catalog({ league: 'endesa', season: '2023/2024' }).players.length, 0);
  assert.deepEqual(saved.players.slice(0, 35), before.players);
  assert.throws(() => service.analyze({ ...body, venue: 'invalid' }));
});

test('manual player research keeps repeated games without match IDs, rejects reference and unknown-location substitution', () => {
  const { service, rows } = setup();
  rows[33].venue = null; rows[34].referenceOnly = true;
  assert.equal(service.analyze({ league: 'endesa', season: '2024/2025', playerKey: 'api:1', lookback: 30 }).history.length, 30);
  const home = service.analyze({ league: 'endesa', season: '2024/2025', playerKey: 'api:1', lookback: 30, venue: 'home' });
  assert.ok(home.quality.unknownVenue > 0); assert.ok(home.history.every(row => row.venue === 'home'));
  assert.throws(() => service.analyze({ league: 'endesa', season: '2024/2025', playerKey: 'unknown' }));
});

test('NBA player research excludes preseason, playoffs and Cup final even without a linked team game', () => {
  const rows = ['2024-10-10', '2024-10-25', '2024-12-18', '2025-04-20'].map((date, i) => ({ league: 'nba', season: '2024/2025', date: `${date}T01:00:00Z`, name: 'P',
    playerKey: 'api:1', team: 'A', opponent: 'B', minutes: 20, values: { points: 20 } }));
  const service = createBasketballPlayerAnalysis({ read: () => ({ games: [], players: rows }), now: () => new Date('2026-10-15T01:00:00Z') });
  assert.equal(service.analyze({ league: 'nba', season: '2024/2025', playerKey: 'api:1' }).history.length, 1);
});

for (const league of ['euroleague', 'endesa']) test(`${league} player catalog retains historical clubs with no player logs and reports actual coverage`, () => {
  const game = { id: 'one', league, season: '2024/2025', date: '2025-01-01T18:00:00Z', home: 'A', away: 'B', finished: true };
  const log = { league, season: game.season, matchId: game.id, date: game.date, playerKey: 'api:1', name: 'P', team: 'A', opponent: 'B', minutes: 25, values: { points: 10 } };
  const saved = { games: [game, { ...game, id: 'two', date: '2025-01-03T18:00:00Z' },
    { ...game, id: 'older', season: '2023/2024', date: '2024-01-01T18:00:00Z', home: 'C', away: 'D' },
    { ...game, id: 'reference', home: 'Reference', referenceOnly: true },
    { ...game, id: 'preseason', home: 'Preseason', preseason: true },
    { ...game, id: 'other', league: 'nba', home: 'Other league' },
    { ...game, id: 'later-season', season: '2025/2026', home: 'Later season' },
    { ...game, id: 'future', date: '2027-01-01T18:00:00Z', home: 'Future' },
    { ...game, id: 'unfinished', home: 'Unfinished', finished: false }],
    players: [log, { ...log, matchId: 'two', date: '2025-01-03T18:00:00Z' },
      { ...log, playerKey: 'dnp', minutes: 0 }, { ...log, playerKey: 'unknown', minutes: null }] };
  const before = structuredClone(saved), service = createBasketballPlayerAnalysis({ read: () => saved, now: () => new Date('2026-10-16T12:00:00Z') });
  const catalog = service.catalog({ league, season: '2024/2025' });
  assert.deepEqual(catalog.teams, ['A', 'B', 'C', 'D']);
  assert.deepEqual(catalog.coverage, { players: 1, records: 2, teams: 4, teamsWithPlayers: 1, seasons: ['2024/2025'] });
  assert.deepEqual(catalog.teamCoverage.find(item => item.team === 'A'), { team: 'A', players: 1, records: 2, seasons: ['2024/2025'], gameSeasons: ['2024/2025'], seasonGames: 2 });
  const filtered = service.catalog({ league, season: '2024/2025', team: 'C' });
  assert.equal(filtered.players.length, 0); assert.deepEqual(filtered.teams, catalog.teams); assert.deepEqual(filtered.coverage, catalog.coverage);
  assert.deepEqual(filtered.teamCoverage.find(item => item.team === 'C'), { team: 'C', players: 0, records: 0, seasons: [], gameSeasons: ['2023/2024'], seasonGames: 0 });
  const current = service.catalog({ league, season: '2026/2027' });
  assert.deepEqual(current.teams, [...catalog.teams, 'Later season']); assert.equal(current.teamCoverage.find(item => item.team === 'A').seasonGames, 0);
  assert.deepEqual(current.coverage.seasons, ['2024/2025']);
  assert.equal(service.catalog({ league, season: '2024/2025', cutoff: '2023-01-01T00:00:00Z' }).coverage.teams, 0);
  assert.deepEqual(saved, before);
});
