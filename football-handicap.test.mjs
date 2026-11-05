import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport } from './model.mjs';
import { buildIndividualProfile } from './profiles.mjs';
import { handicapDefinitions, settleHandicap, splitHandicap, validHandicap, roundedShares, settlementSummary, HANDICAP_GROUPS } from './public/football-handicap.js';

const leagueKey = 'handicap:test', cutoff = '2026-05-01T00:00:00Z';
function history() {
  const results = { A: [[2, 0], [1, 1], [0, 1], [1, 0], [0, 0]], B: [[0, 0], [0, 1], [1, 1], [0, 2], [3, 1]] };
  const halves = { A: [[1, 0], [0, 0], [0, 1], [1, 0], [0, 0]], B: [[0, 0], [0, 1], [1, 0], [0, 1], [1, 0]] };
  return Array.from({ length: 40 }, (_, i) => ['A', 'B'].map(team => {
    const [gf, ga] = results[team][i % 5], [hf, ha] = halves[team][i % 5], local = i % 2 === 0;
    return { id: `${team}-${i}`, leagueKey, season: 2026, date: new Date(Date.UTC(2026, 0, i + 1, 18)).toISOString(),
      home: local ? team : 'Rival', away: local ? 'Rival' : team,
      homeGoals: local ? gf : ga, awayGoals: local ? ga : gf,
      halfTime: { homeGoals: local ? hf : ha, awayGoals: local ? ha : hf } };
  })).flat();
}
function report(matches = history(), options = {}) {
  return buildReport({ matches, leagueKey, season: 2026, home: 'A', away: 'B', lookback: 20, cutoff, ...options });
}
const find = (result, id) => {
  const item = (result.markets || result.scenarios).find(row => row.id === id);
  assert.ok(item, id); return item;
};
const asian = (period, line, side = 'home') => `handicap-asian-${period}-${line}-${side}`;
const euro = (period, line, side) => `handicap-european-${period}-${line}-${side}`;
const profile = (matches = history(), options = {}) => buildIndividualProfile({ sport: 'football', name: 'A', matches, leagueKey, season: 2026, cutoff, lookback: 20, ...options });
const sum100 = values => assert.ok(Math.abs(values.reduce((sum, n) => sum + n, 0) - 100) < 1e-9);

test('Asian lines settle integers, halves and signed quarters without counting pushes as wins', () => {
  for (const [gf, ga, line, outcome] of [
    [1, 1, 0, 'push'], [1, 1, .5, 'fullWin'], [1, 1, -.5, 'loss'],
    [2, 1, -1, 'push'], [2, 1, -.75, 'halfWin'], [2, 1, -1.25, 'halfLoss'],
    [1, 1, .25, 'halfWin'], [1, 1, -.25, 'halfLoss'],
    [0, 1, 1.25, 'halfWin'], [0, 1, .75, 'halfLoss'], [3, 0, -2, 'fullWin'], [0, 3, 2, 'loss'],
  ]) assert.equal(settleHandicap(gf, ga, line), outcome);
  assert.deepEqual(splitHandicap(-.75), [-1, -.5]); assert.deepEqual(splitHandicap(.25), [0, .5]);
  assert.deepEqual(splitHandicap(-1.25), [-1.5, -1]); assert.deepEqual(splitHandicap(0), [0]);
  assert.equal(settleHandicap(1, 0, -1, 'european'), 'draw');
  assert.equal(settleHandicap(1, 0, -1), 'push');
});

test('every Asian line has complementary settlement for the opposite team and opposite line', () => {
  const opposite = { fullWin: 'loss', halfWin: 'halfLoss', push: 'push', halfLoss: 'halfWin', loss: 'fullWin' };
  for (let gf = 0; gf <= 6; gf++) for (let ga = 0; ga <= 6; ga++) for (let q = -16; q <= 16; q++) {
    assert.equal(settleHandicap(ga, gf, -q / 4), opposite[settleHandicap(gf, ga, q / 4)]);
  }
});

test('handicap validation accepts only bounded numeric integer or quarter lines and at most 20 custom lines', () => {
  for (const line of [NaN, Infinity, '1', null, 10.25, -10.25, .1]) {
    assert.equal(validHandicap(line, 'asian'), false);
    assert.throws(() => handicapDefinitions({ handicapAsian: [line] }), RangeError);
  }
  assert.equal(validHandicap(.5, 'european'), false); assert.equal(validHandicap(0, 'unknown'), false);
  assert.throws(() => settleHandicap(0, 0, 0, 'unknown'), RangeError);
  for (const value of [null, [], { handicapAsian: '1' }, { halfTimeHandicapEuropean: [.5] }, { handicapAsian: Array(21).fill(0) }]) assert.throws(() => handicapDefinitions(value));
  for (const goals of [null, undefined, '', -1, .5]) assert.equal(settleHandicap(goals, 0, 0), null);
  assert.equal(settleHandicap(0, 0, 0), 'push');
});

test('rounded five-way distributions sum to 100 and missing rows keep their own denominator', () => {
  sum100(roundedShares([1, 2, 3, 4, 7]));
  assert.deepEqual(roundedShares([0, 0, 0]), [null, null, null]);
  const summary = settlementSummary(['fullWin', 'halfWin', 'push', 'halfLoss', 'loss', null]);
  assert.equal(summary.n, 5); assert.equal(summary.missing, 1); sum100(Object.values(summary.percentages));
  assert.deepEqual(settlementSummary([null]).percentages, { fullWin: null, halfWin: null, push: null, halfLoss: null, loss: null });
});

test('match markets partition probabilities and retain proper home/away historical orientation', () => {
  const result = report();
  for (const period of ['ft', 'ht']) {
    for (const line of [-2, -1, 0, 1, 2]) sum100(['home', 'draw', 'away'].map(side => find(result, euro(period, line, side)).probability));
    for (let q = -8; q <= 8; q++) for (const side of ['home', 'away']) {
      const item = find(result, asian(period, q / 4, side));
      sum100(Object.values(item.settlement)); assert.equal(item.probability, item.settlement.fullWin);
      assert.equal(item.probabilityMeaning, 'Victoria completa');
      for (const sample of Object.values(item.historicalSettlement)) assert.equal(Object.values(sample.counts).reduce((a, b) => a + b, 0), 20);
    }
  }
  const local = find(result, asian('ft', -.25));
  assert.deepEqual(local.historicalSettlement.home.counts, { fullWin: 8, halfWin: 0, push: 0, halfLoss: 8, loss: 4 });
  assert.deepEqual(local.historicalSettlement.away.counts, { fullWin: 8, halfWin: 0, push: 0, halfLoss: 8, loss: 4 });
  const away = find(result, asian('ft', -.25, 'away'));
  assert.deepEqual(away.historicalSettlement.home.counts, { fullWin: 4, halfWin: 0, push: 0, halfLoss: 8, loss: 8 });
  assert.deepEqual(away.historicalSettlement.away.counts, { fullWin: 4, halfWin: 0, push: 0, halfLoss: 8, loss: 8 });
  assert.equal(find(result, euro('ft', -1, 'home')).observed.home.hits, 4);
  assert.equal(find(result, euro('ft', -1, 'draw')).observed.home.hits, 4);
  assert.equal(find(result, euro('ft', -1, 'home')).observed.away.hits, 4);
  assert.equal(find(result, euro('ft', -1, 'draw')).observed.away.hits, 4);
});

test('first-half handicap uses only valid halftime scores and leaves FT probabilities untouched', () => {
  const base = report(), zero = report(history().map(row => ({ ...row, halfTime: { homeGoals: 0, awayGoals: 0 } })));
  assert.deepEqual(base.markets.filter(item => item.period === 'ft'), zero.markets.filter(item => item.period === 'ft'));
  assert.equal(find(zero, asian('ht', 0)).settlement.push, 100);
  assert.equal(find(zero, asian('ht', 0)).probability, 0);
  assert.equal(find(zero, euro('ht', 0, 'draw')).probability, 100);
  const missing = report(history().map(row => ({ ...row, halfTime: undefined })));
  assert.ok(missing.markets.filter(item => item.period === 'ht').every(item => item.probability === null && item.observed.home.n === 0));
  assert.equal(find(missing, asian('ht', 0)).settlement, null);
  const bad = report(history().map(row => ({ ...row, halfTime: { homeGoals: row.homeGoals + 1, awayGoals: 0 } })));
  assert.equal(find(bad, asian('ht', 0)).probability, null);
});

test('small league or team samples suppress all modeled handicap probabilities, not raw counts', () => {
  for (const rows of [history().slice(0, 8), history().filter(row => row.home !== 'B' && row.away !== 'B')]) {
    const result = report(rows);
    assert.ok(result.markets.filter(item => item.handicapKind).every(item => item.probability === null));
    assert.equal(find(result, asian('ft', 0)).settlement, null);
  }
});

test('individual handicap counts are relative to selected team, including away appearances and partial outcomes', () => {
  const result = profile(), item = find(result, asian('ft', -.25));
  assert.equal(item.n, 20); assert.equal(item.hits, 8); assert.equal(item.probability, 40);
  assert.deepEqual(item.historicalSettlement.counts, { fullWin: 8, halfWin: 0, push: 0, halfLoss: 8, loss: 4 });
  assert.equal(find(result, euro('ft', -1, 'draw')).hits, 4);
  sum100(Object.values(item.settlement));
  const away = profile(history(), { venue: 'away' });
  assert.ok(away.history.every(row => row.venue === 'away'));
  assert.deepEqual(find(away, asian('ft', -.25)).historicalSettlement.counts, item.historicalSettlement.counts);
  const short = profile(history().slice(0, 4));
  assert.equal(find(short, asian('ft', 0)).n, 2); assert.equal(find(short, asian('ft', 0)).probability, null);
  assert.equal(find(short, asian('ft', 0)).settlement, null);
  const absent = profile(history().map(row => ({ ...row, halfTime: undefined })));
  assert.equal(find(absent, asian('ht', 0)).n, 0); assert.equal(find(absent, asian('ht', 0)).missing, 20);
});

test('signed custom lines deduplicate consistently across match and individual without changing count lines', () => {
  const thresholds = { handicapEuropean: [-5, -5], handicapAsian: [5.25], halfTimeHandicapEuropean: [5], halfTimeHandicapAsian: [-5.25] };
  const result = report(history(), { thresholds }), single = profile(history(), { thresholds });
  for (const id of [euro('ft', -5, 'home'), asian('ft', 5.25), euro('ht', 5, 'draw'), asian('ht', -5.25)]) {
    assert.ok(find(result, id)); assert.ok(find(single, id));
    assert.equal(result.markets.filter(item => item.id === id).length, 1);
  }
  assert.deepEqual(result.markets.filter(item => !item.handicapKind), report().markets.filter(item => !item.handicapKind));
  assert.equal(new Set(single.scenarios.map(item => item.id)).size, single.scenarios.length);
  for (const config of Object.values(HANDICAP_GROUPS)) assert.throws(() => profile(history(), { thresholds: { [config.key]: [.1] } }));
});

test('all six windows and cutoff isolation apply to handicap counts without other-league or future leakage', () => {
  const rows = history(), unrelated = { ...rows[0], id: 'wrong-league', leagueKey: 'other', homeGoals: 99 };
  const future = { ...rows[0], id: 'future', date: cutoff, homeGoals: 99 };
  const pending = { ...rows[0], id: 'pending', date: '2026-04-01', status: 'NS', homeGoals: 99 };
  for (const lookback of [5, 10, 15, 20, 25, 30]) {
    const a = report(rows, { lookback }), b = report([...rows, unrelated, future, pending], { lookback });
    assert.deepEqual(a.markets.filter(item => item.handicapKind), b.markets.filter(item => item.handicapKind));
    assert.equal(find(b, asian('ft', 0)).observed.home.n, lookback);
    const p = profile([...rows, unrelated, future, pending], { lookback });
    assert.equal(find(p, asian('ft', 0)).n, lookback);
  }
});
