import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasketballReport } from './basketball-model.mjs';
import { buildBasketballScenarios } from './basketball-scenarios.mjs';
import { selectOverviewMarkets } from './public/basketball-scenario-options.js';

const games = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, league: 'nba', season: '2026/2027', home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A',
  date: new Date(Date.UTC(2026, 8, i + 1, 1)).toISOString(), homePoints: 100 + i, awayPoints: 95 + i, finished: true,
  stats: { home: { firstQuarterPoints: i % 3 ? 25 + i : null, halfTimePoints: 55 + i }, away: { firstQuarterPoints: i % 3 ? 22 + i : null, halfTimePoints: 45 + i } } }));
const options = { matches: games, league: 'nba', season: '2026/2027', home: 'A', away: 'B', lookback: 20, cutoff: '2026-10-27T15:00:00Z', date: '2026-10-28T23:00:00Z' };

test('additional lines preserve every original market and forecast, while each half-point pair is complementary and monotonic', () => {
  const original = buildBasketballReport(options), expanded = buildBasketballScenarios(options);
  for (const market of original.markets) assert.deepEqual(expanded.markets.find(row => row.id === market.id), market);
  assert.deepEqual(expanded.meta, original.meta);
  for (const period of ['ft', 'q1', 'ht']) {
    const overs = expanded.markets.filter(row => row.spec.type === 'total' && row.spec.period === period && row.spec.direction === 'over').sort((a, b) => a.spec.line - b.spec.line);
    for (const [index, market] of overs.entries()) {
      const under = expanded.markets.find(row => row.spec.type === 'total' && row.spec.period === period && row.spec.direction === 'under' && row.spec.line === market.spec.line);
      assert.ok(Math.abs(market.probability + under.probability - 100) < .011);
      if (index) assert.ok(market.probability <= overs[index - 1].probability);
      for (const side of ['home', 'away']) assert.equal(market.observed[side].hits + under.observed[side].hits, market.observed[side].n);
    }
  }
});
test('custom line is calculated exactly, missing periods are excluded from counts, integer pushes are not silently treated as half points', () => {
  const report = buildBasketballScenarios(options, { line: 57.5, period: 'q1' });
  const custom = report.markets.find(row => row.spec.period === 'q1' && row.spec.line === 57.5 && row.spec.direction === 'over');
  assert.ok(custom.observed.home.n < 20); assert.ok(custom.observed.home.n > 0);
  assert.throws(() => buildBasketballScenarios(options, { line: 220 }), /terminada en .5/);
  assert.throws(() => buildBasketballScenarios(options, { line: 220.25 }), /terminada en .5/);
  assert.throws(() => buildBasketballScenarios(options, { line: 1000.5 }), /terminada en .5/);
});
test('selecting an under keeps that exact side and line instead of the highest probability', () => {
  const report = buildBasketballScenarios(options);
  const selected = selectOverviewMarkets(report.markets, { group: 'total', direction: 'under', line: 220.5 });
  assert.equal(selected.length, 1); assert.equal(selected[0].spec.direction, 'under'); assert.equal(selected[0].spec.line, 220.5);
  assert.equal(selectOverviewMarkets(report.markets, { group: 'total', direction: 'both', line: 220.5 }).length, 2);
  assert.equal(selectOverviewMarkets(report.markets, { group: 'total', direction: 'under', line: 221.5 }).length, 0);
});
