import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_WINDOWS, lineSequence, makeRanges, historyRates, probabilityRange, wilson, historicalCountLabel } from './public/player-markets.js';

test('all player metrics have expanded complementary half-point lines', () => {
  for (const config of Object.values(PLAYER_WINDOWS)) {
    const lines = lineSequence(config.from, config.to, config.step, [config.from]);
    assert.ok(lines.length >= 10);
    assert.equal(new Set(lines).size, lines.length);
    assert.ok(lines.every(line => line % 1 === .5));
  }
  assert.deepEqual(lineSequence(.5, 3.5, 1, [2.5, 7.5]), [.5, 1.5, 2.5, 3.5, 7.5]);
});
test('line windows reject integers, blank-like values, reversed bounds and oversized grids', () => {
  for (const args of [[1, 9.5, 1], [null, 9.5, 1], [9.5, .5, 1], [.5, 9.5, .5], [.5, 199.5, 1], [.5, 9.5, 1, [200.5], 199.5]]) assert.throws(() => lineSequence(...args));
});
test('integer ranges partition all nonnegative outcomes with an open final bucket', () => {
  const ranges = makeRanges(14, 5);
  assert.deepEqual(ranges, [{ from: 0, to: 4 }, { from: 5, to: 9 }, { from: 10, to: 14 }, { from: 15, to: Infinity }]);
  for (let value = 0; value < 100; value++) assert.equal(ranges.filter(range => value >= range.from && value <= range.to).length, 1);
  assert.throws(() => makeRanges(15, 0));
  assert.throws(() => makeRanges(15, 1.5));
});
test('frequencies exclude missing, DNP and unknown minutes without treating absences as zeros', () => {
  const logs = [0, 4, 5, 14, 15, null, undefined].map(points => ({ minutes: 20, values: { points } }));
  logs.push({ minutes: 0, values: { points: 0 } }, { minutes: null, values: { points: 40 } });
  const stats = historyRates(logs, 'points', [4.5, 14.5], makeRanges(14, 5));
  assert.equal(stats.n, 5); assert.equal(stats.missing, 2);
  assert.equal(stats.lines[0].over.frequency, 60); assert.equal(stats.lines[0].under.frequency, 40);
  assert.equal(stats.ranges.reduce((sum, item) => sum + item.hits, 0), 5);
  assert.ok(stats.lines[0].over.interval[0] < 60 && stats.lines[0].over.interval[1] > 60);
  assert.equal(historyRates([{ values: { pra: null } }], 'pra', [19.5], makeRanges(19, 5)).lines[0].over.frequency, null);
});
test('empty histories and tiny samples keep uncertainty explicit', () => {
  assert.equal(wilson(0, 0), null);
  const stats = historyRates([], 'threes', [.5], makeRanges(2, 1));
  assert.ok(stats.ranges.every(range => range.frequency === null));
  assert.ok(wilson(1, 1)[0] < 25); assert.equal(wilson(1, 1)[1], 100);
});
test('estimated ranges are differences of existing model tails, never synthetic predictions', () => {
  const overs = new Map([[4.5, 80], [9.5, 50], [14.5, 20]]);
  const ranges = makeRanges(14, 5);
  assert.deepEqual(ranges.map(range => probabilityRange(range, overs)), [20, 30, 30, 20]);
  assert.equal(probabilityRange({ from: 5, to: 14 }, overs), 60);
  assert.equal(probabilityRange({ from: 5, to: 14 }, new Map([[4.5, null], [14.5, 20]])), null);
  assert.equal(probabilityRange({ from: 5, to: 14 }, new Map([[4.5, 20], [14.5, 80]])), null);
  assert.equal(probabilityRange({ from: 0, to: Infinity }, new Map()), null);
});

test('every over and under retains its actual hit count alongside the percentage', () => {
  const logs = Array.from({ length: 20 }, (_, i) => ({ minutes: 25, values: { points: i < 17 ? 5 : 4 } }));
  const stats = historyRates(logs, 'points', [4.5, 5.5], []);
  assert.equal(historicalCountLabel(stats.lines[0].over), '17 de 20 partidos');
  assert.equal(stats.lines[0].over.frequency, 85);
  assert.equal(historicalCountLabel(stats.lines[0].under), '3 de 20 partidos');
  assert.equal(historicalCountLabel(stats.lines[1].over), '0 de 20 partidos');
  assert.equal(historicalCountLabel(stats.lines[1].under), '20 de 20 partidos');
});

test('hit-count labels use valid observations, not the requested window or absent participations', () => {
  const logs = Array.from({ length: 15 }, (_, i) => ({ minutes: 20, values: { rebounds: i < 10 ? 6 : i < 12 ? 3 : null } }));
  logs.push({ minutes: 0, values: { rebounds: 20 } }, { minutes: null, values: { rebounds: 20 } });
  const stats = historyRates(logs, 'rebounds', [4.5], []);
  assert.equal(stats.missing, 3); assert.equal(stats.n, 12);
  assert.equal(historicalCountLabel(stats.lines[0].over), '10 de 12 partidos');
  assert.equal(historicalCountLabel(stats.lines[0].under), '2 de 12 partidos');
  assert.equal(stats.lines[0].over.hits + stats.lines[0].under.hits, stats.n);
});

test('empty or invalid counts are not presented as an observed zero-percent event', () => {
  const stats = historyRates([], 'pra', [4.5], []);
  assert.equal(historicalCountLabel(stats.lines[0].over), 'Sin partidos con dato');
  assert.equal(stats.lines[0].over.frequency, null);
  assert.equal(historicalCountLabel({ hits: 1, n: 1 }), '1 de 1 partido');
  assert.equal(historicalCountLabel({ hits: 2, n: 1 }), 's/d');
});
