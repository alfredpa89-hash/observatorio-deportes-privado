import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootballContext, footballDiscipline, parseFootballAbsences } from './football-context.mjs';

const time = '2026-10-26T15:00:00.000Z';
const target = { id: '100', leagueId: '39', season: '2026', home: 'Arsenal', away: 'Chelsea', homeId: 42, awayId: 49 };
const injury = (id = 7, other = {}) => ({ fixture: { id: 100 }, league: { id: 39, season: 2026 }, team: { id: 42, name: 'Arsenal' },
  player: { id, name: `Player ${id}`, type: 'Missing Fixture', reason: 'Knee Injury' }, ...other });
function setup({ request = async () => [], connected = true, allowedSeasons = null, coverage = true } = {}) {
  let current = new Date(time), writes = 0, calls = [];
  const scope = { sport: 'football', key: 'competition:england:premier-league', season: '2026/2027', country: 'England', cutoff: time,
    lookback: 5, historicalCutoff: false, sourceScopes: [{ key: 'api:39', season: '2026' }],
    entities: [{ id: 'team:Arsenal', kind: 'team', team: 'Arsenal', name: 'Arsenal' }] };
  const store = { leagues: { 'api:39': { key: 'api:39', coverageBySeason: coverage === null ? {} : { 2026: { injuries: coverage } }, fixturesBySeason: { 2026: [
    { id: '100', home: 'Arsenal', away: 'Chelsea', homeId: 42, awayId: 49, status: 'NS', date: '2026-10-27T19:00:00Z' },
    { id: '101', home: 'Tottenham', away: 'Liverpool', status: 'NS', date: '2026-10-27T20:00:00Z' },
  ] } } }, playerLogs: [] };
  const service = createFootballContext({ getStore: () => store, persist: async () => { writes++; }, connected: () => connected,
    getConnection: () => ({ allowedSeasons }), now: () => current, request: async (...args) => { calls.push(args); return request(...args); } });
  return { store, scope, service, calls, writes: () => writes, advance: ms => { current = new Date(current.getTime() + ms); scope.cutoff = current.toISOString(); } };
}
test('reports validate fixture, season, league and team IDs; missing and uncertain remain different', () => {
  const rows = parseFootballAbsences([injury(), injury(), injury(8, { player: { id: 8, name: 'Doubt', type: 'Questionable', reason: 'Suspended' } }),
    injury(9, { player: { id: 9, name: 'Banned', type: 'Missing Fixture', reason: 'Suspended' } }),
    injury(10, { league: { id: 140, season: 2026 } }), injury(11, { fixture: { id: 200 } }), injury(12, { team: { id: 999 } }),
    injury(13, { league: { id: 39, season: 2024 } }), injury(14, { player: { id: 14, name: 'Unknown', type: 'Unknown' } })], target, time);
  assert.deepEqual(rows.map(row => row.status), ['out', 'questionable', 'suspended']);
  assert.equal(rows[0].publishedAt, null); assert.equal(rows[0].checkedAt, time);
  assert.equal(rows[0].sourceUrl.startsWith('https://www.api-football.com/'), true);
});
test('cards keep missing denominators, reject duplicates and future/other-season rows, and never manufacture a ban', () => {
  const { store, scope } = setup();
  const log = (date, values, extra = {}) => ({ sport: 'football', leagueKey: 'api:39', season: 2026, playerKey: 'api:7', name: 'Player', team: 'Arsenal', opponent: 'Chelsea', date, values, source: 'API-Football', ...extra });
  store.playerLogs = [log('2026-10-25T10:00:00Z', { yellow: 1, red: 0 }), log('2026-10-24T10:00:00Z', { yellow: null, red: null }),
    log('2026-10-23T10:00:00Z', { yellow: 0, red: 1 }), log('2026-10-25T10:00:00Z', { yellow: 1, red: 0 }),
    log('2026-10-26T20:00:00Z', { yellow: 8 }), log('2026-10-22T10:00:00Z', { yellow: 8 }, { season: 2024 }),
    log('2026-10-22T10:00:00Z', { yellow: 8 }, { availableAfter: '2026-10-27T00:00:00Z' }),
    log('2026-10-21T10:00:00Z', { yellow: 8 }, { team: 'Chelsea' })];
  const before = JSON.stringify(store), rows = footballDiscipline(store, scope);
  assert.equal(rows.length, 1); assert.equal(rows[0].appearances, 3);
  assert.deepEqual(rows[0].yellow, { total: 1, games: 1, n: 2 });
  assert.deepEqual(rows[0].red, { total: 1, games: 1, n: 2 });
  assert.equal(rows[0].status, undefined); assert.equal(JSON.stringify(store), before);
});
test('refresh is bounded to a saved upcoming fixture and a four-hour cache; historic contexts cannot fetch', async () => {
  const { service, scope, calls, store, advance } = setup({ request: async () => [injury()] });
  const before = JSON.stringify(store.leagues);
  assert.equal(service.summary(scope).selectedFixtureId, '100'); assert.equal(calls.length, 0);
  await assert.rejects(service.refresh(scope, '101'), /encuentro futuro/);
  const result = await service.refresh(scope, '100');
  assert.equal(result.absences.length, 1); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['/injuries', { fixture: '100', season: '2026' }]);
  await service.refresh(scope, '100'); assert.equal(calls.length, 1);
  assert.equal(service.summary({ ...scope, cutoff: '2026-10-26T14:00:00Z' }).absences.length, 0, 'no retrospectively available reports');
  await assert.rejects(service.refresh({ ...scope, historicalCutoff: true }), /historico/);
  advance(4 * 3600000); assert.equal(service.summary(scope).stale, true);
  await service.refresh(scope); assert.equal(calls.length, 2); assert.equal(JSON.stringify(store.leagues), before);
});
test('missing key, denied season, missing coverage, unrelated comparison and already started games do not query injuries', async () => {
  for (const config of [{ connected: false }, { allowedSeasons: [2024] }, { coverage: false }]) {
    const { service, scope, calls } = setup(config);
    assert.equal(service.summary(scope).canRefresh, false); await assert.rejects(service.refresh(scope), /conectar|plan|cobertura/); assert.equal(calls.length, 0);
  }
  const { service, scope, calls, advance } = setup();
  assert.equal(service.summary({ ...scope, entities: [...scope.entities, { team: 'Liverpool', kind: 'team' }] }).fixtures.length, 0);
  advance(2 * 86400000); assert.equal(service.summary(scope).fixtures.length, 0); assert.equal(calls.length, 0);
});
test('provider failures keep previous timestamp and records, sanitize errors, and honor a shared pause', async () => {
  let failing = false;
  const { service, scope, calls, store, advance } = setup({ request: async () => {
    if (failing) throw Object.assign(new Error('secret account key=do-not-store'), { status: 429 });
    return [injury()];
  } });
  const initial = await service.refresh(scope); advance(4 * 3600000); failing = true;
  const result = await service.refresh(scope);
  assert.equal(result.checkedAt, initial.checkedAt); assert.equal(result.absences.length, 1); assert.equal(result.stale, true);
  assert.match(result.warning, /Cuota/); assert.equal(result.canRefresh, false);
  await assert.rejects(service.refresh(scope), /pausa/); assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(store).includes('do-not-store'));
});
test('unknown coverage is checked once first; empty reports are a timestamped sample, not a healthy squad', async () => {
  const { service, scope, calls, store } = setup({ coverage: null, request: async endpoint => endpoint === '/leagues' ? [{ league: { id: 39 }, seasons: [{ year: 2026, coverage: { injuries: true } }] }] : [] });
  const result = await service.refresh(scope);
  assert.equal(calls.length, 2); assert.equal(store.leagues['api:39'].coverageBySeason[2026].injuries, true);
  assert.equal(result.absences.length, 0); assert.equal(result.checkedAt, time); assert.match(result.notice, /no confirma/);
});
