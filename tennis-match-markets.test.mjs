import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTennisMatchMarkets, TENNIS_GAME_HANDICAPS } from './tennis-match-markets.mjs';

function fixture(bestOf = 3) {
  const target = (bestOf + 1) / 2;
  const matches = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, bestOf, completed: true, winner: i % 2 ? 2 : 1,
    player1: 'Alpha', player2: 'Beta', player1Id: '1', player2Id: '2', score: Array(target).fill(i % 2 ? '4-6' : '6-4').join(' ') }));
  return { a: { player: { key: 'atp:1', name: 'Alpha' }, history: matches }, b: { player: { key: 'atp:2', name: 'Beta' }, history: matches }, matches, bestOf, winnerProbability: 65.37 };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const sum = values => values.reduce((a, b) => a + b, 0);

test('set scores partition best-of-three and best-of-five matches and preserve both Elo winner totals', () => {
  for (const bestOf of [3, 5]) {
    const input = fixture(bestOf), { setScores } = buildTennisMatchMarkets(input), target = (bestOf + 1) / 2;
    assert.equal(setScores.rows.length, target * 2); assert.equal(setScores.status, 'experimental');
    close(sum(setScores.rows.map(row => row.probability)), 100);
    close(sum(setScores.rows.filter(row => row.playerKey === 'atp:1').map(row => row.probability)), 65.37);
    close(sum(setScores.rows.filter(row => row.playerKey === 'atp:2').map(row => row.probability)), 34.63);
    assert.ok(setScores.rows.every(row => row.setsWon === target && row.setsLost < target && row.probability >= 0));
    assert.deepEqual(setScores.samples, { home: 20, away: 20, context: 20 });
  }
});

test('equal players give the exact symmetric set-path distribution; endpoint probabilities stay finite', () => {
  const three = buildTennisMatchMarkets({ ...fixture(3), winnerProbability: 50 });
  assert.deepEqual(three.setScores.rows.map(row => row.probability), [25, 25, 25, 25]);
  const five = buildTennisMatchMarkets({ ...fixture(5), winnerProbability: 50 });
  assert.deepEqual(five.setScores.rows.map(row => row.probability), [12.5, 18.75, 18.75, 12.5, 18.75, 18.75]);
  for (const p of [0, .01, 99.99, 100]) {
    const rows = buildTennisMatchMarkets({ ...fixture(5), winnerProbability: p }).setScores.rows;
    assert.ok(rows.every(row => Number.isFinite(row.probability))); close(sum(rows.map(row => row.probability)), 100);
  }
});

test('reversing the selected players reverses scores and handicap orientation without changing evidence', () => {
  const input = fixture(), forward = buildTennisMatchMarkets(input), reverse = buildTennisMatchMarkets({ ...input, a: input.b, b: input.a, winnerProbability: 34.63, handicapLine: 2.5 });
  for (const row of forward.setScores.rows) {
    const reversed = reverse.setScores.rows.find(other => other.playerKey === row.playerKey && other.setsLost === row.setsLost);
    close(row.probability, reversed.probability); assert.deepEqual(row.historical, reversed.historical);
  }
  assert.deepEqual(forward.handicaps.filter(row => row.selected).map(row => [row.playerKey, row.line]), [['atp:1', -2.5], ['atp:2', 2.5]]);
  assert.deepEqual(reverse.handicaps.filter(row => row.selected).map(row => [row.playerKey, row.line]), [['atp:2', 2.5], ['atp:1', -2.5]]);
});

test('game handicaps use actual games, not match victory; custom opposite lines and counts remain explicit', () => {
  const input = fixture(); input.matches.forEach(row => { row.score = '0-6 7-6 7-6'; row.winner = 1; });
  const report = buildTennisMatchMarkets({ ...input, handicapLine: -12.5 });
  const a = line => report.handicaps.find(row => row.playerKey === 'atp:1' && row.line === line);
  assert.equal(a(3.5).hits, 0); assert.equal(a(4.5).hits, 20); assert.equal(a(4.5).frequency, 100);
  assert.equal(a(-12.5).n, 20); assert.ok(report.handicaps.some(row => row.playerKey === 'atp:2' && row.line === 12.5 && row.selected));
  assert.equal(report.setScores.rows.find(row => row.playerKey === 'atp:1' && row.setsLost === 1).historical.winner.hits, 20);
  assert.equal(TENNIS_GAME_HANDICAPS.length, 22);
  for (const bad of [null, '', '2.5', 0, 2, 31.5, -31.5, NaN, Infinity]) assert.throws(() => buildTennisMatchMarkets({ ...input, handicapLine: bad }), /handicap/);
});

test('incomplete, retired, contradictory, match-tiebreak and incompatible scores stay missing', () => {
  const input = fixture();
  input.matches.forEach((row, i) => Object.assign(row, [
    { score: '6-4' }, { retired: true }, { score: '6-4 6-4', winner: 2 }, { score: '6-4 4-6 [10-8]' },
    { player1Games: 99 }, { totalSets: 7 }, { completed: false }, { bestOf: 5 }, { score: '' }, { totalGames: 0 },
  ][i % 10]));
  const report = buildTennisMatchMarkets(input);
  assert.equal(report.setScores.status, 'unavailable'); assert.ok(report.setScores.rows.every(row => row.probability === null));
  assert.ok(report.handicaps.every(row => row.n === 0 && row.missing === 20 && row.frequency === null));
  assert.equal(report.setScores.samples.context, 0);
});

test('small complete samples and unavailable winner estimates do not produce invented score probabilities or mutate inputs', () => {
  const input = fixture(), before = structuredClone(input);
  input.a.history = input.a.history.slice(0, 4);
  assert.ok(buildTennisMatchMarkets(input).setScores.rows.every(row => row.probability === null));
  assert.ok(buildTennisMatchMarkets({ ...before, winnerProbability: null }).setScores.rows.every(row => row.probability === null));
  buildTennisMatchMarkets(before); assert.deepEqual(before, fixture());
});
