import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyOverview } from './daily-overview.mjs';

const now = () => new Date('2026-10-27T15:00:00Z');
function setup() {
  const games = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, league: 'nba', season: i < 17 ? '2025/2026' : '2026/2027',
    date: i < 17 ? `2026-03-${String(i + 1).padStart(2, '0')}T22:00:00Z` : `2026-10-${i + 4}T22:00:00Z`,
    home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A', homePoints: 110 + i, awayPoints: 100 + i,
    finished: true, source: 'Synthetic', preseason: false, stats: {} }));
  games.push({ id: 'future', league: 'nba', season: '2026/2027', date: '2026-10-28T23:00:00Z', home: 'A', away: 'B', finished: false, status: 'NS', source: 'Synthetic' });
  const store = { leagues: {}, matches: [], sports: {}, tennisLab: { fixtures: [] } };
  const overview = createDailyOverview({ getStore: () => store, now,
    basketballResearch: { prematchData: () => ({ games, players: [] }) }, basketballDaily: { state: () => ({ rows: [] }) }, tennisLab: {} });
  return { games, store, overview };
}
test('daily preview uses existing models, states actual season depth and never writes the archive', () => {
  const { store, overview } = setup(), original = structuredClone(store);
  const result = overview.state({ day: '2026-10-28' });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].mode, 'preview');
  assert.deepEqual(result.rows[0].scope.names, ['A', 'B']); assert.equal(result.rows[0].scope.fixtureId, 'future');
  const winner = result.rows[0].markets.find(row => row.id === 'home-win');
  assert.ok(Number.isFinite(winner.probability)); assert.equal(winner.evidence.samples[0].currentSeasonN, 3);
  assert.equal(winner.evidence.level, 2); assert.ok(winner.observed.home.n > 0);
  assert.deepEqual(store, original);
});
test('started, postponed, unknown-time and preseason games cannot enter current previews', () => {
  const { games, overview } = setup();
  games.push(...[{ id: 'started', date: '2026-10-27T14:00:00Z' }, { id: 'postponed', status: 'PST' }, { id: 'unknown', timeKnown: false }, { id: 'preseason', preseason: true }]
    .map(patch => ({ ...games.at(-1), ...patch })));
  assert.equal(overview.state({ day: '2026-10-28' }).rows.length, 1);
});
test('Endesa and empty football/tennis calendars remain pending instead of receiving invented estimates', () => {
  const { games, overview } = setup(); games.push({ ...games.at(-1), league: 'endesa', id: 'acb' });
  const result = overview.state({ day: '2026-10-28', sport: 'all' });
  assert.equal(result.rows.length, 1); assert.equal(result.coverage.find(row => row.key === 'endesa').fixtures, 1);
  assert.match(result.coverage.find(row => row.key === 'endesa').note, /pendiente/);
  assert.equal(result.coverage.find(row => row.key === 'atp').fixtures, 0);
});
test('only today and tomorrow can be calculated; invalidation releases stale cached previews', () => {
  const { games, overview } = setup();
  assert.throws(() => overview.state({ day: '2026-10-26' }), /hoy o manana/);
  assert.throws(() => overview.state({ day: '2026-10-29' }), /hoy o manana/);
  assert.equal(overview.state({ day: '2026-10-28' }).rows.length, 1);
  games.pop(); overview.invalidate();
  assert.equal(overview.state({ day: '2026-10-28' }).rows.length, 0);
});

test('custom daily lines have a distinct cache and do not alter the stored fixture or archive', () => {
  const { store, overview } = setup(), original = structuredClone(store);
  const first = overview.state({ day: '2026-10-28', line: '221.5', period: 'ft' });
  const second = overview.state({ day: '2026-10-28', line: '222.5', period: 'ft' });
  assert.notEqual(first, second);
  assert.ok(first.rows[0].markets.some(row => row.spec.line === 221.5));
  assert.ok(second.rows[0].markets.some(row => row.spec.line === 222.5));
  assert.ok(!second.rows[0].markets.some(row => row.spec.line === 221.5));
  assert.deepEqual(store, original);
});
