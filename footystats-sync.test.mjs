import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootystatsService } from './footystats.mjs';
import { FOOTYSTATS_COMPETITIONS } from './footystats-competitions.mjs';

const secret = 'fake-private-footystats-key';
const success = (data, pager = { max_page: 1 }) => Response.json({ success: true, data, pager, metadata: { request_limit: '100', request_remaining: '80' } });
const blocked = () => Response.json({ success: false, message: `League is not chosen by the user ${secret}` }, { status: 417 });
function fixture(id) {
  return { id, competition_id: 12325, date_unix: 1723834800 + id * 86400, status: 'complete', home_name: 'A', away_name: 'B', homeID: 10, awayID: 20,
    homeGoalCount: 2, awayGoalCount: 1, ht_goals_team_a: 1, ht_goals_team_b: 0, HTGoalCount: 1,
    team_a_corners: 6, team_b_corners: 4, team_a_fh_corners: 2, team_b_fh_corners: 1, corner_timings_recorded: 1,
    team_a_yellow_cards: 2, team_b_yellow_cards: 1, team_a_red_cards: 0, team_b_red_cards: 0 };
}
function setup(fetcher) {
  const store = { version: 1, leagues: {}, matches: [{ id: 'legacy', source: 'csv', leagueKey: 'csv:old' }],
    playerLogs: [{ id: 'old-player' }], basketball: { sealed: true } };
  const service = createFootystatsService({ getStore: () => store, persist: async () => {}, fetcher,
    errorFactory: (status, message) => Object.assign(new Error(message), { status }), pause: async () => {}, now: () => new Date('2026-10-13T00:00:00Z') });
  return { service, store };
}

test('FootyStats sync imports permitted history and season players, records blocked current data and keeps all other sources intact', async () => {
  const calls = [];
  const selected = { name: 'England Premier League', country: 'England', season: [{ id: 12325, year: 20242025 }] };
  const all = { name: 'Premier League', country: 'England', season: [{ id: 17146, year: 20262027 }, { id: 12325, year: 20242025 }] };
  const { service, store } = setup(async input => {
    const url = new URL(input); calls.push(url.pathname + '?' + new URLSearchParams([...url.searchParams].filter(([name]) => name !== 'key')));
    assert.equal(url.searchParams.get('key'), secret);
    if (url.pathname === '/league-list') return success(url.searchParams.get('chosen_leagues_only') === 'true' ? [selected] : [all]);
    if (url.pathname === '/league-matches') return url.searchParams.get('season_id') === '17146' ? blocked() : success(Array.from({ length: 20 }, (_, index) => fixture(index + 1)));
    const page = Number(url.searchParams.get('page'));
    return success([{ id: page, competition_id: 12325, full_name: page === 1 ? secret : 'Segundo jugador', position: 'Goalkeeper', club_team_id: 10,
      appearances_overall: 10, minutes_played_overall: 900, goals_overall: 0, assists_overall: 1,
      detailed: { saves_total_overall: 30, saves_per_game_overall: 3, shots_per_game_overall: 1 } }], { max_page: 2 });
  });
  await service.connect({ key: secret });
  const result = await service.sync({ id: 'premier', maxLeagues: 1 });
  assert.equal(result.requests, 5); assert.equal(result.updated[0].access, 'restricted');
  assert.equal(result.updated[0].currentSeason, '2026/2027');
  assert.equal(result.updated[0].imported.season, '2024/2025');
  assert.equal(result.updated[0].imported.results, 20); assert.equal(result.updated[0].imported.players, 2);
  assert.equal(result.updated[0].imported.playerFields.find(field => field.id === 'shotsAvg').n, 2);
  assert.equal(result.state.datasets[0].players[0].name, '[oculta]');
  assert.equal(result.state.datasets[0].players[0].team, 'A');
  assert.equal(result.state.datasets[0].scope, 'season-aggregates');
  assert.equal(result.state.coverage.length, 27); assert.equal(result.pending, 26);
  assert.equal(store.matches.length, 21);
  assert.deepEqual(store.playerLogs, [{ id: 'old-player' }]); assert.deepEqual(store.basketball, { sealed: true });
  assert.equal(JSON.stringify(store).includes(secret), false); assert.equal(JSON.stringify(result).includes(secret), false);
  const before = calls.length;
  await service.sync({ id: 'premier', maxLeagues: 1 });
  assert.equal(store.matches.length, 21, 'no duplicate results on explicit refresh');
  assert.equal(calls.length, before + 4);
  const after = calls.length;
  await service.sync({ id: 'premier', maxLeagues: 1, background: true });
  assert.equal(calls.length, after, 'background work cannot repeat the same catalog access denial');
});

test('all 27 restrictions are recorded in bounded batches without invented histories or requests to other providers', async () => {
  const catalog = FOOTYSTATS_COMPETITIONS.map((target, index) => ({ name: target.names[0], country: target.country, season: [{ id: 1000 + index, year: 2026 }] }));
  let calls = 0;
  const { service, store } = setup(async input => {
    const url = new URL(input); calls++;
    assert.equal(url.hostname, 'api.football-data-api.com');
    if (url.pathname === '/league-list') return success(url.searchParams.get('chosen_leagues_only') === 'true' ? [] : catalog);
    assert.equal(url.pathname, '/league-matches'); return blocked();
  });
  await service.connect({ key: secret });
  let result;
  for (let index = 0; index < 9; index++) result = await service.sync({});
  assert.equal(result.pending, 0); assert.equal(calls, 29);
  assert.equal(result.state.coverage.filter(row => row.access === 'restricted').length, 27);
  assert.equal(result.state.datasets.length, 0); assert.equal(store.matches.length, 1);
  assert.ok(Object.values(store.leagues).every(league => league.seasons.length === 0));
  const before = calls; await service.sync({}); assert.equal(calls, before, 'fresh checks are not repeated automatically');
  await assert.rejects(service.sync({ maxLeagues: 4 }), { status: 400 });
});

test('quota exhaustion stops the batch and does not erase saved data or falsely mark the remaining leagues checked', async () => {
  const { service, store } = setup(async input => {
    const url = new URL(input);
    if (url.pathname === '/league-list') return success([{ name: 'Premier League', country: 'England', season: [{ id: 1, year: 2026 }] }]);
    return Response.json({ success: false, message: 'Request limit reached', metadata: { request_remaining: '0' } }, { status: 429 });
  });
  await service.connect({ key: secret });
  const result = await service.sync({});
  assert.equal(result.stopped, true); assert.equal(result.pending, 26);
  assert.equal(result.state.coverage.filter(row => row.checkedAt).length, 1);
  assert.equal(store.matches.length, 1); assert.equal(result.state.datasets.length, 0);
});
