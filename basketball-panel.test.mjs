import assert from 'node:assert/strict';
import test from 'node:test';
import { createBasketballPanel } from './basketball-panel.mjs';

const NOW = new Date('2026-10-14T18:00:00Z');
const games = Array.from({ length: 40 }, (_, i) => ({ id: `acb-${i}`, league: 'endesa', season: '2024/2025',
  date: new Date(Date.UTC(2025, 0, i + 1, 18)).toISOString(), home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A',
  homePoints: 90, awayPoints: 80, seasonType: 2, finished: true, status: 'Final',
  stats: { home: { firstQuarterPoints: 25, halfTimePoints: 45 }, away: { firstQuarterPoints: 20, halfTimePoints: 40 } } }));
const fixture = { id: 'future-acb', league: 'endesa', season: '2026/2027', date: '2026-10-15T18:00:00Z', home: 'A', away: 'B', status: 'NS', finished: false };
const players = games.map(game => ({ id: 'p-' + game.id, league: 'endesa', season: game.season, matchId: game.id, date: game.date,
  name: 'Player A', team: 'A', minutes: 30, values: { points: 20, rebounds: 5, assists: 4, pra: 29, threes: null } }));
function context() {
  const calls = [], saved = { games: [...games, fixture], players };
  const basketball = { state: () => ({ connected: false, leagues: [{ key: 'nba' }, { key: 'euroleague' }], trial: { protocol: { lookback: 20 } } }) };
  for (const method of ['report', 'player', 'week', 'list', 'evaluation', 'backtest']) basketball[method] = body => { calls.push({ method, body }); return { delegated: true }; };
  basketball.refresh = async body => { calls.push({ method: 'refresh', body }); return { state: basketball.state() }; };
  const research = { dailyData: () => saved, sync: async body => { calls.push({ method: 'sync', body }); return { imported: 1 }; } };
  return { panel: createBasketballPanel({ basketball, research, now: () => NOW }), calls, saved };
}
test('Endesa appears beside NBA/Euro without entering their frozen model or changing saved records', () => {
  const { panel, saved } = context(), before = structuredClone(saved);
  const state = panel.state(), endesa = state.leagues.find(row => row.key === 'endesa');
  assert.equal(state.leagues.length, 3); assert.equal(endesa.predictionSupported, false);
  assert.equal(endesa.datasets.find(row => row.season === '2024/2025').matches, 40);
  assert.equal(endesa.datasets.find(row => row.season === '2026/2027').matches, 0);
  assert.equal(endesa.datasets.find(row => row.season === '2026/2027').fixtures, 1);
  assert.equal(state.trial.protocol.lookback, 20); assert.deepEqual(saved, before);
});
test('Endesa comparisons, players, calendar and evaluation stay descriptive with exact 25/30 windows', () => {
  const { panel, calls, saved } = context();
  for (const lookback of [25, 30]) {
    const body = { league: 'endesa', season: '2024/2025', home: 'A', away: 'B', player: 'Player A', lookback };
    const result = panel.report(body); assert.equal(result.history.home.length, lookback);
    assert.equal(result.meta.periods.ft.homeN, lookback); assert.deepEqual(result.markets, []); assert.equal(result.meta.descriptive, true);
    const player = panel.player(body); assert.equal(player.n, lookback); assert.equal(player.over, null); assert.equal(player.expected, null);
    assert.equal(panel.player({ ...body, metric: 'threes' }).n, 0);
  }
  const list = panel.list({ league: 'endesa', season: '2026/2027' });
  assert.equal(list.fixtures.length, 1); assert.equal(list.fixtures[0].report, null);
  assert.equal(panel.evaluation('endesa').unavailable, true); assert.throws(() => panel.backtest({ league: 'endesa' }), /pendiente/);
  const week = panel.week({ league: 'endesa', season: '2024/2025', startDate: '2025-01-01', endDate: '2025-01-10' });
  assert.equal(week.completed.length, 10); assert.match(week.coverage.notice, /Endesa/);
  const result = panel.report({ league: 'endesa', season: '2024/2025', home: 'A', away: 'B', lookback: 30, cutoff: '2025-01-06T00:00:00Z' });
  assert.equal(result.history.home.length, 4);
  assert.equal(calls.length, 0); assert.equal(saved.games.length, 41);
});
test('Endesa refresh uses its existing research connector, while NBA/Euro delegate unchanged', async () => {
  const { panel, calls } = context();
  const result = await panel.refresh({ league: 'endesa', season: '2024/2025', lookback: 30 });
  assert.equal(calls[0].method, 'sync'); assert.equal(calls[0].body.league, 'endesa');
  assert.ok(result.state.leagues.some(row => row.key === 'endesa'));
  for (const league of ['nba', 'euroleague']) assert.equal(panel.report({ league }).delegated, true);
  await panel.refresh({}); assert.equal(calls.at(-1).method, 'refresh');
});
