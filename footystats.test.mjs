import assert from 'node:assert/strict';
import test from 'node:test';
import { auditFootystatsMatches, auditFootystatsPlayers, createFootystatsService } from './footystats.mjs';

const credential = 'fake-footystats-credential';
const league = { name: 'England Premier League', country: 'England', season: [{ id: 12325, year: 20242025 }] };
const match = { id: 100, date_unix: 1723834800, competition_id: 12325, status: 'complete', home_name: 'A', away_name: 'B',
  homeGoalCount: 2, awayGoalCount: 1, ht_goals_team_a: 0, ht_goals_team_b: 1, team_a_corners: 6, team_b_corners: 4,
  team_a_fh_corners: 0, team_b_fh_corners: 2, corner_timings_recorded: 2, team_a_red_cards: 0, team_b_red_cards: 0,
  team_a_shots: -1, team_b_shots: -1, team_a_fouls: null, team_b_fouls: 10 };
const player = { id: 11, competition_id: 12325, known_as: 'Portero', position: 'Goalkeeper', appearances_overall: 10,
  minutes_played_overall: 900, goals_overall: 0, assists_overall: 0, detailed: { saves_per_game_overall: 3, saves_total_overall: 30 } };
const metric = (rows, id) => rows.find(row => row.id === id);
const success = (data, remaining = 100, pager = { max_page: 19 }) => Response.json({ success: true, data, pager,
  metadata: { request_limit: '180', request_remaining: String(remaining), request_limit_refresh_next: 9999999999 } });

function setup(fetcher) {
  const store = { version: 1, leagues: { saved: { name: 'Guardada' } }, matches: [{ id: 'old' }], basketball: { frozen: true }, playerLogs: [{ id: 'old-player' }] };
  let saves = 0;
  const service = createFootystatsService({ getStore: () => store, persist: async () => { saves++; }, fetcher,
    errorFactory: (status, message) => Object.assign(new Error(message), { status }), now: () => new Date('2026-10-13T20:00:00Z') });
  return { service, store, saves: () => saves };
}

test('coverage excludes absent, negative, empty and future values without fabricating first-half corners', () => {
  const rows = [match, { ...match, id: 2, corner_timings_recorded: 0 }, { ...match, id: 3, homeGoalCount: '', awayGoalCount: false },
    { ...match, id: 4, status: 'incomplete', homeGoalCount: 0, awayGoalCount: 0 }, null];
  const report = auditFootystatsMatches(rows);
  assert.equal(metric(report, 'goals').n, 2);
  assert.equal(metric(report, 'goals').total, 3);
  assert.equal(metric(report, 'cornersHt').n, 2);
  assert.equal(metric(report, 'shots').n, 0);
  assert.equal(metric(report, 'fouls').n, 0);
  assert.equal(metric(report, 'red').status, 'zeros-only');
  const players = auditFootystatsPlayers([player, { ...player, id: 12, position: 'Forward', detailed: {} }]);
  assert.equal(metric(players, 'saves').n, 1);
  assert.equal(metric(players, 'saves').total, 1);
  assert.equal(metric(players, 'shotsAvg').status, 'missing');
});

test('key validation and bounded audit redact secrets, separate season aggregates and preserve existing data', async () => {
  const calls = [];
  const { service, store, saves } = setup(async (input, options) => {
    const url = new URL(input); calls.push({ endpoint: url.pathname, params: Object.fromEntries(url.searchParams) });
    assert.equal(url.hostname, 'api.football-data-api.com');
    assert.equal(options.redirect, 'error');
    assert.equal(url.searchParams.get('key'), credential);
    if (url.pathname === '/league-list') return success([league], 99);
    if (url.pathname === '/league-matches') {
      assert.equal(url.searchParams.get('max_per_page'), '20');
      return success([match, { ...match, id: 101, status: 'incomplete' }], 98);
    }
    if (url.pathname === '/match') return success({ ...match, lineups: {}, team_a_corner_timings: [10], team_b_corner_timings: [20] }, 97);
    if (url.pathname === '/league-players') return success([player, { ...player, id: 12, competition_id: 999 }], 96);
    if (url.pathname === '/player-stats') return success([{ ...player, known_as: credential }, { ...player, competition_id: 999 }], 95);
    throw new Error('Unexpected endpoint');
  });
  assert.equal(service.state().connected, false);
  const connected = await service.connect({ key: credential });
  assert.equal(connected.connected, true); assert.equal(connected.busy, false);
  assert.equal(connected.catalog[0].seasons[0].id, 12325);
  assert.equal(calls.length, 1); assert.equal(saves(), 2, 'request accounting survives a server restart');
  const { report, state } = await service.audit({ seasonId: 12325, page: 1 });
  assert.equal(calls.length, 5); assert.equal(report.requests, 4);
  assert.equal(report.matches.completed, 1); assert.equal(report.matches.totalPages, 19);
  assert.equal(report.players.scope, 'season-aggregates'); assert.equal(report.players.returned, 1);
  assert.equal(report.individual.scope, 'season-aggregates');
  assert.equal(report.matchDetail.individualGameLogs, 'not-verified');
  assert.equal(report.individual.sample[0].name, '[oculta]');
  assert.equal(report.individual.sample[0].saves, 30);
  assert.equal(JSON.stringify(report).includes(credential), false);
  assert.equal(JSON.stringify(state).includes(credential), false);
  assert.equal(JSON.stringify(store).includes(credential), false);
  assert.deepEqual(store.matches, [{ id: 'old' }]);
  assert.deepEqual(store.playerLogs, [{ id: 'old-player' }]);
  assert.deepEqual(store.basketball, { frozen: true }); assert.equal(saves(), 11);
  const before = calls.length;
  await assert.rejects(service.audit({ seasonId: 999 }), { status: 400 });
  await assert.rejects(service.audit({ seasonId: 12325, page: 0 }), { status: 400 });
  assert.equal(calls.length, before);
  await service.connect({ key: '' });
  assert.equal(service.state().connected, false); assert.equal(service.state().audits.length, 1);
  const fresh = createFootystatsService({ getStore: () => store, persist: async () => {}, errorFactory: (status, message) => Object.assign(new Error(message), { status }) });
  assert.equal(fresh.state().connected, false); assert.equal(fresh.state().audits.length, 1);
});

test('rejected keys and provider messages never leak a credential or replace a working connection', async () => {
  let mode = 'ok';
  const { service } = setup(async input => {
    const url = new URL(input);
    if (mode === 'invalid') return Response.json({ success: false, message: `Invalid API key ${url.searchParams.get('key')}` }, { status: 401 });
    if (mode === 'network') throw new Error(`Network error ${url}`);
    if (mode === 'malformed') return new Response('not-json');
    return success([league]);
  });
  await service.connect({ key: credential });
  mode = 'invalid';
  await assert.rejects(service.connect({ key: 'wrong-footystats-key' }), error => error.status === 401 && !error.message.includes('wrong-footystats-key'));
  assert.equal(service.state().connected, true);
  assert.equal(service.state().catalog.length, 1);
  assert.equal(JSON.stringify(service.state()).includes('wrong-footystats-key'), false);
  mode = 'network'; await assert.rejects(service.loadCatalog(), error => error.code === 'network_error' && !error.message.includes(credential));
  mode = 'malformed'; await assert.rejects(service.loadCatalog(), { code: 'invalid_response' });
});

test('restricted endpoints yield an honest partial report; quota exhaustion stops additional requests', async () => {
  let mode = 'restricted', calls = 0;
  const { service, store } = setup(async input => {
    const url = new URL(input); calls++;
    if (url.pathname === '/league-list') return success([league], 99);
    if (mode === 'quota') return Response.json({ success: false, message: `Request limit reached ${credential}`, metadata: { request_remaining: '0' } }, { status: 429 });
    if (url.pathname === '/league-matches') return Response.json({ success: false, message: `Upgrade subscription ${credential}` }, { status: 403 });
    if (url.pathname === '/league-players') return success([player], 97);
    return Response.json({ success: false, message: 'Parameter invalid' }, { status: 422 });
  });
  await service.connect({ key: credential });
  let result = await service.audit({ seasonId: 12325 });
  assert.equal(result.report.matches.completed, 0);
  assert.equal(result.report.players.returned, 1);
  assert.equal(result.report.notes[0].code, 'access_restricted');
  assert.equal(result.report.requests, 3);
  mode = 'quota'; const before = calls;
  result = await service.audit({ seasonId: 12325 });
  assert.equal(calls, before + 1); assert.equal(result.report.requests, 1);
  assert.equal(result.report.notes[0].code, 'quota_exceeded');
  await service.audit({ seasonId: 12325 }); assert.equal(calls, before + 1);
  assert.equal(JSON.stringify(store).includes(credential), false);
});

test('concurrent operations are rejected without sending the second credential upstream', async () => {
  let release;
  const { service } = setup(() => new Promise(resolve => { release = () => resolve(success([league])); }));
  const first = service.connect({ key: credential });
  await assert.rejects(service.connect({ key: 'second-credential' }), { status: 409 });
  release(); await first;
  assert.equal(service.state().busy, false);
});

test('FootyStats persists period quota and daily attempts across restarts without assuming its period is one day', async () => {
  const store = { leagues: {}, matches: [] }; let date = new Date('2026-10-18T12:00:00Z'), calls = 0;
  const options = { getStore: () => store, persist: async () => {}, now: () => date,
    errorFactory: (status, message) => Object.assign(new Error(message), { status }), fetcher: async () => {
      calls++; return Response.json({ success: true, data: [league], metadata: { request_limit: 1800, request_remaining: 0, request_limit_refresh_next: date.getTime() / 1000 + 3600 } });
    } };
  const first = createFootystatsService(options); await first.connect({ key: credential });
  const second = createFootystatsService(options); second.restoreKey(credential);
  assert.equal(second.state().dailyUsed, 1); assert.equal(second.state().quota.remaining, 0);
  await assert.rejects(second.loadCatalog(), { code: 'quota_exceeded' }); assert.equal(calls, 1);
  date = new Date('2026-10-18T13:00:01Z'); await second.loadCatalog();
  assert.equal(calls, 2); assert.equal(second.state().dailyUsed, 2);
  assert.ok(!JSON.stringify(store).includes(credential));
});
