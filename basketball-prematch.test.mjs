import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketballPrematch } from './basketball-prematch.mjs';
import { createBasketballPlayerAnalysis } from './basketball-player-analysis.mjs';

const instant = '2026-10-15T18:00:00Z';
const now = () => new Date(instant);
const game = (id, overrides = {}) => ({ id, league: 'euroleague', season: '2026/2027', date: '2026-10-13T18:00:00Z',
  home: 'A', away: 'B', homePoints: 90, awayPoints: 80, finished: true, status: 'FT',
  periods: { home: { q1: 22, q2: 24, ht: 46, q3: 20, q4: 24 }, away: { q1: 20, q2: 19, ht: 39, q3: 21, q4: 20 } }, ...overrides });
const fixture = (overrides = {}) => game('next', { finished: false, status: 'NS', date: '2026-10-16T18:00:00Z', fetchedAt: '2026-10-15T17:00:00Z', ...overrides });
const player = (overrides = {}) => ({ league: 'euroleague', season: '2026/2027', date: '2026-10-13T18:00:00Z', matchId: 'one',
  playerKey: 'p1', name: 'Player One', team: 'A', opponent: 'B', minutes: 25, values: { points: 20, rebounds: 4, assists: 5, threes: 2 }, ...overrides });
function setup(stored) {
  const read = () => stored;
  return createBasketballPrematch({ read, playerAnalysis: createBasketballPlayerAnalysis({ read, now }), now });
}
const scope = { league: 'euroleague', season: '2026/2027', fixtureId: 'next', lookback: 5 };

test('prematch compares real periods, venue, references and future context without modifying stored state', () => {
  const stored = { games: [game('one'), game('two', { date: '2026-10-14T18:00:00Z', home: 'B', away: 'A' }), fixture()], players: [player()], availability: [] };
  const before = structuredClone(stored), api = setup(stored), report = api.report(scope);
  assert.deepEqual(stored, before); assert.equal(report.meta.descriptive, true); assert.equal(report.meta.modelChanged, false);
  assert.equal(api.catalog(scope).fixtureCount, 1);
  const [a, b] = report.teams;
  assert.equal(a.n, 2); assert.equal(a.wins, 1); assert.equal(a.losses, 1);
  assert.equal(a.periods.ft.scored.average, 85); assert.equal(a.periods.q1.scored.average, 21);
  assert.equal(a.periods.q2.scored.average, 21.5); assert.equal(a.periods.ht.scored.average, 42.5);
  assert.equal(a.venueSplit.n, 1); assert.equal(b.venueSplit.n, 1);
  assert.equal(a.interval.hoursBetweenStarts, 48); assert.equal(a.recordedGamesLast7Days, 2);
  assert.equal(a.players[0].metrics.pra.average, 29); assert.equal(a.players[0].availability, 'unknown');
  assert.equal(report.h2h.length, 2); assert.ok(report.alerts.some(text => text.includes('viajes')));
});

test('missing quarters stay missing and historical references never establish current roster or rest', () => {
  const stored = { games: [game('old', { season: '2024/2025', date: '2025-03-01T18:00:00Z', periods: {},
    stats: { home: { firstQuarterPoints: 20 }, away: { firstQuarterPoints: 19 } } }), fixture()],
    players: [player({ season: '2024/2025', date: '2025-03-01T18:00:00Z', matchId: 'old' })], availability: [] };
  const report = setup(stored).report(scope), a = report.teams[0];
  assert.equal(a.periods.q1.n, 1); assert.equal(a.periods.ht.n, 0); assert.equal(a.periods.ht.scored.average, null);
  assert.equal(a.periods.q2.missing, 1); assert.equal(a.currentSeasonGames, 0); assert.equal(a.interval, null);
  assert.equal(a.players[0].currentSeasonEvidence, false); assert.ok(report.alerts.some(text => text.includes('no confirman la plantilla')));
});

test('prematch player means have individual denominators and exclude DNP, future, other league and unfinished records', () => {
  const stored = { games: [game('one'), game('two', { date: '2026-10-12T18:00:00Z' }), fixture()], players: [player(),
    player({ matchId: 'two', date: '2026-10-12T18:00:00Z', values: { points: 10, rebounds: 2, assists: null, threes: 0 } }),
    player({ playerKey: 'dnp', minutes: 0 }), player({ playerKey: 'foreign', league: 'endesa' }),
    player({ playerKey: 'future', date: '2026-10-16T18:00:00Z' }), player({ playerKey: 'not-final', matchId: 'next', date: '2026-10-14T18:00:00Z' })], availability: [] };
  const a = setup(stored).report(scope).teams[0];
  assert.equal(a.players.length, 1); const p = a.players[0];
  assert.equal(p.n, 2); assert.equal(p.metrics.points.average, 15); assert.equal(p.metrics.points.n, 2);
  assert.equal(p.metrics.assists.n, 1); assert.equal(p.metrics.assists.missing, 1); assert.equal(p.metrics.pra.n, 1);
});

test('prematch refuses past, unknown-time, preseason, wrong-season and not-yet-known fixtures', () => {
  const stored = { games: [game('one'), fixture(), fixture({ id: 'started', date: instant }), fixture({ id: 'unknown', timeKnown: false }),
    fixture({ id: 'pre', preseason: true }), fixture({ id: 'later-publication', fetchedAt: '2026-10-15T19:00:00Z' }),
    fixture({ id: 'wrong-season', season: '2025/2026' })], players: [], availability: [] };
  const api = setup(stored);
  assert.deepEqual(api.catalog(scope).fixtures.map(row => row.id), ['next']);
  for (const fixtureId of ['started', 'unknown', 'pre', 'later-publication', 'wrong-season', 'missing']) assert.throws(() => api.report({ ...scope, fixtureId }), /futuro admisible/);
  assert.throws(() => api.report({ ...scope, cutoff: '2026-10-15T16:00:00Z' }), /futuro admisible/);
  assert.throws(() => api.report({ ...scope, league: 'unknown' }));
  assert.throws(() => api.report({ ...scope, lookback: 40 }));
});

test('manual comparison does not invent an actual fixture or recovery interval, and obeys the knowledge cutoff', () => {
  const stored = { games: [game('one'), game('recent', { date: '2026-10-15T16:00:00Z' }), fixture()], players: [], availability: [] };
  const api = setup(stored), report = api.report({ ...scope, fixtureId: '', home: 'A', away: 'B', cutoff: '2026-10-14T18:00:00Z' });
  assert.equal(report.meta.fixture, null); assert.equal(report.teams[0].n, 1);
  assert.equal(report.teams[0].interval, null); assert.equal(report.teams[0].recordedGamesLast7Days, null);
  assert.ok(report.alerts[0].includes('sin encuentro futuro confirmado'));
  assert.throws(() => api.report({ ...scope, fixtureId: '', home: 'A', away: 'A' }));
});

test('availability uses only reports known at cutoff; a newer expired report never revives an older status', () => {
  const base = { league: 'euroleague', team: 'A', name: 'Player One', playerKey: 'p1', status: 'active',
    publishedAt: '2026-10-14T15:00:00Z', recordedAt: '2026-10-14T16:00:00Z', expiresAt: '2026-10-17T18:00:00Z' };
  const stored = { games: [game('one'), fixture()], players: [player()], availability: [base,
    { ...base, status: 'out', publishedAt: '2026-10-15T15:00:00Z', recordedAt: '2026-10-15T16:00:00Z', expiresAt: '2026-10-15T17:00:00Z' },
    { ...base, publishedAt: '2026-10-15T19:00:00Z' }, { ...base, recordedAt: '2026-10-15T19:00:00Z' },
    { ...base, fixtureId: 'other', publishedAt: '2026-10-15T17:00:00Z' }] };
  let a = setup(stored).report(scope).teams[0];
  assert.equal(a.availability.length, 1); assert.equal(a.availability[0].status, 'out'); assert.equal(a.availability[0].current, false);
  assert.equal(a.players[0].availability, 'unknown');
  stored.availability.push({ ...base, status: 'minutes_limit', minutesLimit: 20, publishedAt: '2026-10-15T17:00:00Z',
    recordedAt: '2026-10-15T17:30:00Z', expiresAt: '2026-10-16T15:00:00Z' });
  const report = setup(stored).report(scope); a = report.teams[0];
  assert.equal(a.availability[0].current, true); assert.equal(a.availability[0].coversStart, false);
  assert.equal(a.players[0].availability, 'minutes_limit'); assert.equal(a.availability[0].minutesLimit, 20);
  assert.ok(report.alerts.some(text => text.includes('vence antes')));
});

test('NBA only uses eligible regular-season history and Endesa stays descriptive', () => {
  const nba = { league: 'nba', season: '2025/2026', phase: 'Regular Season' };
  const stored = { games: [game('regular', { ...nba, date: '2026-03-01T18:00:00Z' }), game('pre', { ...nba, date: '2025-10-10T18:00:00Z', phase: 'Preseason' }),
    fixture({ league: 'nba', date: '2026-10-20T23:00:00Z', phase: 'Regular Season' }), game('foreign'),
    game('endesa-old', { league: 'endesa', season: '2024/2025', date: '2025-03-01T18:00:00Z' }),
    game('exhibition', { league: 'nba', season: '2024/2025', date: '2025-02-17T01:35:00Z', home: 'Chucks Global Stars', away: 'Kennys Young Stars', phase: '' })], players: [], availability: [] };
  const api = setup(stored), report = api.report({ ...scope, league: 'nba' });
  assert.equal(report.teams[0].n, 1); assert.equal(report.teams[0].interval, null); assert.equal(report.h2h.length, 1);
  assert.ok(!api.catalog({ ...scope, league: 'nba' }).teams.includes('Chucks Global Stars'));
  const acb = api.report({ league: 'endesa', season: '2024/2025', home: 'A', away: 'B', lookback: 30 });
  assert.equal(acb.meta.modelChanged, false); assert.equal(acb.meta.descriptive, true);
  assert.ok(acb.alerts.some(text => text.includes('fuera del modelo')));
});

test('second quarter can use explicit halftime minus Q1 of the same game, but never a fraction of FT', () => {
  const stored = { games: [game('one', { periods: {}, stats: { home: { firstQuarterPoints: 20, halfTimePoints: 45 }, away: { firstQuarterPoints: 19, halfTimePoints: 39 } } })], players: [], availability: [] };
  let a = setup(stored).report({ ...scope, fixtureId: '', home: 'A', away: 'B' }).teams[0];
  assert.equal(a.periods.q2.scored.average, 25); assert.equal(a.periods.q3.scored.average, null);
  stored.games[0].stats.home.halfTimePoints = null;
  a = setup(stored).report({ ...scope, fixtureId: '', home: 'A', away: 'B' }).teams[0];
  assert.equal(a.periods.q2.n, 0); assert.equal(a.periods.q2.missing, 1);
});
