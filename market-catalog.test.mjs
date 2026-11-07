import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOTBALL_LINES, FOOTBALL_METRICS, FOOTBALL_GROUPS, selectConditionMarkets } from './public/market-catalog.js';
import { sampleTrace } from './public/sample-trace.js';
test('catalog retains all original model lines and defines labels for every generated total group', () => {
  assert.deepEqual(FOOTBALL_LINES.corners, [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]);
  assert.deepEqual(FOOTBALL_LINES.halfTimeGoals, [.5, 1.5, 2.5]);
  assert.equal(FOOTBALL_METRICS.red.overOnly, true);
  for (const metric of Object.keys(FOOTBALL_LINES)) assert.ok(FOOTBALL_GROUPS[FOOTBALL_METRICS[metric].group]);
});
test('selection keeps all matching lines and both directions without silently dropping conditions', () => {
  const markets = [1.5, 2.5, 3.5].flatMap(line => ['over', 'under'].map(direction => ({ group: 'goles', line, direction })));
  assert.equal(selectConditionMarkets(markets, { group: 'goles' }).length, 6);
  assert.deepEqual(selectConditionMarkets(markets, { group: 'goles', line: '2.5', direction: 'under' }), [markets[3]]);
  const nba = [{ group: 'total', spec: { line: 220.5, direction: 'under' } }];
  assert.equal(selectConditionMarkets(nba, { group: 'total', line: '220.5', direction: 'under' }).length, 1);
});
test('trace distinguishes actual rows, incomplete requested windows, old results and approximate tennis dates', () => {
  const result = sampleTrace({ history: [{ date: '2025-01-01', source: 'A' }, { date: null, source: ['A', 'B'] }], requested: 20, cutoff: '2026-11-06', approximate: true });
  assert.equal(result.unfilled, 18); assert.equal(result.stale, true); assert.deepEqual(result.sources, ['A', 'B']);
  assert.match(result.text, /fecha de fuente/); assert.match(result.text, /sin fecha verificable/);
  assert.match(sampleTrace({}).text, /sin fecha verificable/);
});
