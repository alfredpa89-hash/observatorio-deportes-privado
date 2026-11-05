import test from 'node:test';
import assert from 'node:assert/strict';
import { basketballFocus, focusedTeams, focusedHistory } from './basketball-focus.mjs';
import { planDataJobs } from './data-control.mjs';
import { createBasketballService } from './basketball-service.mjs';

test('focus uses today and tomorrow in Guayaquil, not UTC dates or a rolling 48 hours', () => {
  const now = new Date('2026-10-17T03:00:00Z'), window = basketballFocus(now);
  assert.equal(window.today, '2026-10-16'); assert.equal(window.tomorrow, '2026-10-17');
  assert.equal(window.from, '2026-10-16T05:00:00.000Z'); assert.equal(window.until, '2026-10-18T05:00:00.000Z');
  const game = (id, date) => ({ id, date, league: 'euroleague', home: id, away: 'Opponent' });
  const teams = focusedTeams([game('yesterday', '2026-10-16T04:59:59Z'), game('today', window.from),
    game('tomorrowLate', '2026-10-18T04:59:59Z'), game('dayAfter', window.until)], now);
  assert.deepEqual([...teams].sort(), ['Opponent', 'today', 'tomorrowLate'].sort());
  assert.equal(basketballFocus(new Date(window.until)).today, '2026-10-18');
});

test('focus excludes cancelled, unknown-time and preseason games, and NBA outside its regular season', () => {
  const now = new Date('2026-10-16T18:00:00Z'), base = { date: '2026-10-17T18:00:00Z', league: 'euroleague', away: 'Other' };
  const teams = focusedTeams([{ ...base, home: 'Valid' }, { ...base, home: 'Cancelled', status: 'Cancelled' },
    { ...base, home: 'Unknown time', timeKnown: false }, { ...base, home: 'Preseason', preseason: true },
    { ...base, home: 'NBA preseason', league: 'nba', season: '2026/2027' }], now);
  assert.deepEqual([...teams].sort(), ['Other', 'Valid']);
});

test('only focused teams get their prior window, without widening gaps or removing saved archives', () => {
  const now = new Date('2026-10-16T18:00:00Z'), games = Array.from({ length: 35 }, (_, index) => ({ id: `a${index}`, home: 'A', away: 'B',
    finished: true, date: new Date(Date.UTC(2026, 8, index + 1, 18)).toISOString(), ...(index < 30 ? { apiId: index } : {}) }));
  games.push({ id: 'unrelated', home: 'C', away: 'D', finished: true, date: '2026-10-15T18:00:00Z', apiId: 999 });
  const before = structuredClone(games), selected = focusedHistory(games, new Set(['A']), now);
  assert.equal(selected.length, 30); assert.equal(selected.filter(game => game.apiId != null).length, 25);
  assert.equal(selected.some(game => game.id === 'unrelated'), false); assert.deepEqual(games, before);
});

test('paid automatic queue drops general archive backfills and changes its focus at local midnight', () => {
  const now = new Date('2026-10-17T03:00:00Z'), store = { basketball: { datasets: { euroleague: { '2024/2025': {} } } } };
  const free = planDataJobs(store, { basketballConnected: true }, now);
  assert.ok(free.some(job => job.params.season === '2024/2025'));
  const paid = planDataJobs(store, { basketballConnected: true, paid: true }, now);
  assert.equal(paid.some(job => job.params.season === '2024/2025'), false);
  assert.equal(paid.filter(job => job.kind === 'basketball-details').length, 3);
  assert.ok(paid.filter(job => job.kind === 'basketball-details').every(job => job.params.focusDay === '2026-10-16'));
  const next = planDataJobs(store, { basketballConnected: true, paid: true }, new Date('2026-10-17T05:00:00Z'));
  assert.notEqual(next.find(job => job.kind === 'basketball-details').id, paid.find(job => job.kind === 'basketball-details').id);
});

test('the legacy Pro refresh also limits details to focused teams and refuses general old-season refreshes', async () => {
  const now = new Date('2026-10-11T16:00:00Z'), calls = [], nativeFetch = globalThis.fetch;
  const store = { basketball: { quota: { day: now.toISOString().slice(0, 10), used: 24, detailUsed: 24 }, trial: { active: false, protocol: { lookback: 20 }, snapshots: [] },
    catalogAt: now.toISOString(), catalog: [{ id: 120, name: 'Euroleague', seasons: [{ season: 2026, coverage: { games: { statistics: { players: true, teams: true } } } }] }] } };
  const frozen = structuredClone(store.basketball.trial), game = (id, date, home, away, status = 'FT') => ({ id, date, stage: 'Regular Season', league: { id: 120, season: 2026 }, status: { short: status },
    teams: { home: { id: id * 2, name: home }, away: { id: id * 2 + 1, name: away } },
    scores: { home: { total: 80, quarter_1: 20, quarter_2: 20, quarter_3: 20, quarter_4: 20 }, away: { total: 76, quarter_1: 19, quarter_2: 19, quarter_3: 19, quarter_4: 19 } } });
  const service = createBasketballService({ getStore: () => store, persist: async () => {}, getApiKey: () => 'test-only-private-key', now: () => now });
  globalThis.fetch = async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname === '/status') return Response.json({ response: { subscription: { plan: 'Pro', active: true }, requests: { limit_day: 7500, current: 1 } } });
    return Response.json({ response: url.pathname === '/games' ? [game(1, '2026-10-09T18:00:00Z', 'A', 'B'), game(2, '2026-10-09T18:00:00Z', 'C', 'D'),
      game(3, '2026-10-12T18:00:00Z', 'A', 'B', 'NS'), game(4, '2026-10-13T18:00:00Z', 'C', 'D', 'NS')] : [] });
  };
  try {
    await service.withProvider(({ request }) => request('status'));
    assert.equal(service.requestPolicy().usable, 6750);
    await service.refresh({ league: 'euroleague' });
    const details = calls.filter(url => url.pathname.startsWith('/games/statistics/'));
    assert.equal(details.length, 2); assert.ok(details.every(url => url.searchParams.get('id') === '1'));
    const count = calls.length; await service.refresh({ league: 'euroleague', season: '2025/2026' }); assert.equal(calls.length, count);
    const { lastRun, warning, ...preserved } = store.basketball.trial;
    assert.deepEqual(preserved, frozen);
  } finally { globalThis.fetch = nativeFetch; }
});
