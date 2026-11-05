import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBasketballPrematch } from './basketball-prematch.mjs';
import { historyRates } from './public/player-markets.js';

const now = () => new Date('2026-10-15T18:00:00Z');
const game = (i, overrides = {}) => ({ id: `g${i}`, league: 'euroleague', season: '2026/2027', date: new Date(Date.UTC(2026, 7, i + 1, 18)).toISOString(),
  home: i % 2 ? 'B' : 'A', away: i % 2 ? 'A' : 'B', homePoints: 90, awayPoints: 80, finished: true, phase: 'Regular Season',
  periods: { home: { q1: 22, q2: 23, ht: 45, q3: 20, q4: 25 }, away: { q1: 20, q2: 20, ht: 40, q3: 20, q4: 20 } }, ...overrides });
function setup(games) {
  const stored = { games, players: [], availability: [], trial: { protocol: { lookback: 20 }, snapshots: [] } };
  const api = createBasketballPrematch({ read: () => stored, now });
  return { api, stored };
}
const scope = { league: 'euroleague', season: '2026/2027', team: 'A' };

test('one-team analysis needs no opponent, isolates a season and keeps the frozen trial untouched', () => {
  const { api, stored } = setup([game(0), game(1), game(2, { season: '2025/2026', date: '2025-11-01T18:00:00Z' }), game(3, { league: 'endesa' })]);
  const before = structuredClone(stored), result = api.teamReport(scope);
  assert.equal(result.summary.n, 2); assert.equal(result.summary.wins, 1); assert.equal(result.summary.losses, 1);
  assert.equal(result.summary.winFrequency, 50); assert.equal(result.meta.lookback, 'season');
  assert.equal(result.periods.ft.scored.average, 85); assert.equal(result.periods.ft.conceded.average, 85); assert.equal(result.periods.ft.total.average, 170);
  assert.equal(result.periods.q1.scored.average, 21); assert.equal(result.periods.ht.scored.average, 42.5);
  assert.equal(result.periods.q3.draws, 2); assert.equal(result.meta.descriptive, true); assert.equal(result.meta.modelChanged, false);
  assert.equal(result.history[0].venue, 'away'); assert.equal(result.history[0].periods.ft.scored, 80);
  assert.deepEqual(stored, before);
});

test('all manual windows are exact, and venue filtering precedes window selection without filling missing quarters', () => {
  const { api } = setup(Array.from({ length: 65 }, (_, i) => game(i, i === 64 ? { periods: {} } : {})));
  for (const lookback of [5, 10, 15, 20, 25, 30]) {
    const result = api.teamReport({ ...scope, venue: 'home', lookback });
    assert.equal(result.summary.n, lookback); assert.equal(result.summary.wins, lookback); assert.equal(result.meta.available, 33);
    assert.ok(result.history.every(row => row.venue === 'home'));
    assert.equal(result.periods.q1.n, lookback - 1); assert.equal(result.periods.q1.missing, 1);
    assert.equal(result.venueSplits.find(row => row.venue === 'away').n, 0);
  }
  assert.equal(api.teamReport(scope).summary.n, 65);
});

test('unknown periods retain null and metric-specific denominators; team over/under uses the same sample', () => {
  const { api } = setup([game(0), game(1, { periods: { home: { q1: 20 }, away: { q1: null } } })]);
  const result = api.teamReport(scope), q1 = result.periods.q1;
  assert.equal(q1.scored.n, 1); assert.equal(q1.conceded.n, 2); assert.equal(q1.n, 1); assert.equal(q1.missing, 1);
  const rows = result.history.map(game => ({ values: { points: game.periods.q1.scored } }));
  const rates = historyRates(rows, 'points', [21.5], []);
  assert.equal(rates.n, 1); assert.equal(rates.missing, 1); assert.equal(rates.lines[0].over.frequency, 100);
  assert.equal(result.history[0].periods.ht.scored, null); assert.equal(result.history[0].periods.q2.scored, null);
});

test('an empty current season never falls back to old results and shows no fabricated zero win probability', () => {
  const { api } = setup([game(0, { league: 'endesa', season: '2024/2025', date: '2025-03-01T18:00:00Z' })]);
  const body = { ...scope, league: 'endesa' }, catalog = api.teamCatalog(body), result = api.teamReport(body);
  assert.equal(catalog.teams.find(row => row.name === 'A').seasonGames, 0);
  assert.equal(catalog.seasons.find(row => row.value === '2024/2025').results, 1);
  assert.equal(result.summary.n, 0); assert.equal(result.summary.winFrequency, null); assert.equal(result.periods.ft.scored.average, null);
  assert.ok(result.warnings.some(text => text.includes('No se sustituyen')));
  assert.equal(api.teamReport({ ...body, season: '2024/2025' }).summary.n, 1);
});

test('NBA, Endesa and Euro scopes exclude future, unavailable, reference and exhibition results', () => {
  for (const league of ['nba', 'euroleague', 'endesa']) {
    const season = '2025/2026', common = { league, season, date: '2026-03-01T18:00:00Z' };
    const { api } = setup([game(0, common), game(1, { ...common, preseason: true }), game(2, { ...common, referenceOnly: true }),
      game(3, { ...common, date: '2026-10-16T18:00:00Z' }), game(4, { ...common, date: '2026-03-02T18:00:00Z', availableAfter: '2026-10-16T18:00:00Z' }),
      game(5, { ...common, date: '2026-03-02T18:00:00Z', finished: false }),
      ...(league === 'nba' ? [game(6, { ...common, season: '2024/2025', date: '2025-02-17T01:35:00Z', home: 'Global Stars', away: 'Young Stars', phase: '' })] : [])]);
    const result = api.teamReport({ ...scope, league, season });
    assert.equal(result.summary.n, 1); assert.equal(result.meta.modelChanged, false);
    assert.equal(api.teamCatalog({ ...scope, league, season }).teams.length, 2);
  }
});

test('team cutoff, venue, team and history validation do not silently broaden the query', () => {
  const { api } = setup([game(0), game(1, { date: '2026-10-15T16:00:00Z' })]);
  assert.equal(api.teamReport(scope).summary.n, 1);
  assert.throws(() => api.teamReport({ ...scope, cutoff: '2026-07-01T18:00:00Z' }), /equipo del archivo/);
  assert.equal(api.teamReport({ ...scope, cutoff: '2026-08-02T01:00:00Z' }).summary.n, 1);
  assert.equal(api.teamReport({ ...scope, cutoff: '2026-12-01T18:00:00Z' }).summary.n, 1);
  for (const update of [{ venue: 'neutral' }, { league: 'other' }, { lookback: 8 }, { team: 'Unknown' }, { cutoff: 'bad' }]) assert.throws(() => api.teamReport({ ...scope, ...update }));
});

test('team upcoming calendar also respects venue and excludes unconfirmed times', () => {
  const future = { finished: false, status: 'NS', date: '2026-10-16T18:00:00Z', fetchedAt: '2026-10-15T17:00:00Z' };
  const { api } = setup([game(0), game(2, future), game(3, future), game(4, { ...future, timeKnown: false })]);
  assert.equal(api.teamReport(scope).upcoming.length, 2);
  const result = api.teamReport({ ...scope, venue: 'away' });
  assert.equal(result.upcoming.length, 1); assert.equal(result.upcoming[0].away, 'A');
});

test('removed Week controls have no dangling listeners and Individual has its own accessible panel', async () => {
  const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('./public/basketball.js', import.meta.url), 'utf8');
  assert.ok(!html.includes('data-basket-view="week"')); assert.ok(!html.includes('id="bb-week-'));
  assert.ok(!script.includes('renderWeek')); assert.ok(!script.includes('bb-week-'));
  assert.ok(html.includes('data-basket-view="individual"')); assert.ok(html.includes('id="bb-individual-view"'));
  assert.ok(script.includes('mountBasketballTeams'));
});

test('main basketball status shows saved history and hides the retired trial action', async () => {
  const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('./public/basketball.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html.match(/<p id="bb-trial-status">([^<]*)<\/p>/)[1], /31 de octubre/i);
  assert.doesNotMatch(script, /hasta el 31 de octubre/i);
  assert.match(script, /trial\.active \? 'Seguimiento manual activo · Guayaquil' : 'Datos e historiales · Guayaquil'/);
  assert.match(html, /<button[^>]*id="bb-start"[^>]*hidden/);
});
