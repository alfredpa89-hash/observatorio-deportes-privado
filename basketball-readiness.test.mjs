import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasketballReadiness } from './basketball-readiness.mjs';
import { createBasketballService } from './basketball-service.mjs';
import { frozenTrialHash } from './data-backups.mjs';

const NOW = '2026-10-16T18:00:00.000Z';
const game = (id, season = '2026/2027') => ({ id, league: 'euroleague', season, date: season === '2026/2027' ? '2026-10-14T18:00:00Z' : '2025-03-01T18:00:00Z',
  home: 'A', away: 'B', finished: true, homePoints: 80, awayPoints: 75, periods: { home: { q1: 0, q2: 20, q3: 30, q4: 30 }, away: { q1: 10, q2: 20, q3: 25, q4: 20 } } });
const player = (id, values = {}) => ({ league: 'euroleague', season: '2026/2027', matchId: 'g1', date: '2026-10-14T18:00:00Z', playerKey: `API-Basketball:${id}`,
  name: 'Player', team: id === 1 ? 'A' : 'B', minutes: 30, values: { points: 0, rebounds: 0, assists: 0, pra: 0, threes: null, ...values } });
function setup() {
  const store = { basketball: { trial: { version: 'frozen', snapshots: [], protocol: { lookback: 20 } }, inputs: {}, evaluations: {} } };
  const archive = { games: [game('g1'), game('old', '2024/2025')], players: [player(1), player(2)], availability: [] };
  const service = createBasketballReadiness({ getStore: () => store, persist: async () => {}, read: () => archive, policy: () => ({ paid: false }), now: () => new Date(NOW) });
  return { store, archive, service };
}

test('readiness isolates current seasons, missing fields and leagues without changing the frozen trial', () => {
  const { store, archive, service } = setup(), before = frozenTrialHash(store);
  archive.players.push({ ...player(3), minutes: null });
  const state = service.state(), euro = state.leagues.find(row => row.league === 'euroleague'), endesa = state.leagues.find(row => row.league === 'endesa');
  assert.equal(euro.sampleSize, 1); assert.equal(euro.fields.find(row => row.id === 'quarters').n, 1);
  assert.equal(euro.playerFields.find(row => row.id === 'points').n, 3);
  assert.equal(euro.playerFields.find(row => row.id === 'minutes').missing, 1);
  assert.equal(euro.playerFields.find(row => row.id === 'threes').n, 0);
  assert.equal(euro.playerFields.find(row => row.id === 'quarters').n, 0);
  assert.equal(endesa.sampleSize, 0); assert.equal(endesa.evaluation.trial, null);
  assert.ok(endesa.blockers.some(text => /independiente/.test(text)));
  assert.equal(frozenTrialHash(store), before); assert.equal(store.basketballChecks, undefined);
});

test('historical evidence remains explicitly historical and never establishes current roster', () => {
  const { archive, service } = setup(); archive.games = [game('old', '2024/2025')]; archive.players = [];
  const euro = service.state().leagues[1];
  assert.equal(euro.sampleSize, 0); assert.equal(euro.knownCurrentPlayers, 0); assert.equal(euro.rosterConfirmed, false);
  assert.equal(euro.sampleGames[0].season, '2024/2025'); assert.equal(euro.latestMatch, null);
});

test('official comparisons preserve zero, flag missing and drift, and never rewrite the input', async () => {
  const { service, store, archive } = setup(), before = frozenTrialHash(store);
  const body = { league: 'euroleague', season: '2026/2027', matchId: 'g1', field: 'home:q1', expected: 0,
    sourceUrl: 'https://www.euroleaguebasketball.net/euroleague/game-center/example/', publishedAt: '2026-10-15T12:00:00Z' };
  assert.equal((await service.saveCheck(body)).status, 'match');
  assert.equal((await service.saveCheck({ ...body, field: 'player:threes', playerKey: 'API-Basketball:1' })).status, 'missing');
  archive.games[0].periods.home.q1 = 1;
  assert.equal(service.state().checks.find(row => row.field === 'home:q1').status, 'mismatch');
  assert.equal(store.basketballChecks[0].observedAtSave, 0);
  assert.equal(frozenTrialHash(store), before);
  for (const change of [{ expected: '' }, { expected: -1 }, { publishedAt: '2027-01-01T00:00:00Z' }, { publishedAt: '2026-10-01T00:00:00Z' },
    { sourceUrl: 'https://nba.com/example/' }, { sourceUrl: body.sourceUrl + '?key=secret' }, { sourceUrl: 'https://euroleaguebasketball.net.evil.com/' },
    { matchId: 'unknown' }, { field: 'player:points', playerKey: 'unknown' }]) await assert.rejects(service.saveCheck({ ...body, ...change }));
});

test('availability requires current evidence and a report covering the future start, without reviving expired statuses', () => {
  const { service, archive } = setup();
  archive.games.push({ ...game('future'), finished: false, date: '2026-10-17T18:00:00Z', status: 'NS' });
  const report = { league: 'euroleague', season: '2026/2027', team: 'A', playerKey: 'API-Basketball:1', status: 'active',
    publishedAt: '2026-10-15T00:00:00Z', recordedAt: '2026-10-15T00:00:00Z', expiresAt: '2026-10-18T00:00:00Z' };
  archive.availability.push(report);
  assert.equal(service.state().leagues[1].availability[0].status, 'active');
  archive.availability.push({ ...report, status: 'out', publishedAt: '2026-10-16T00:00:00Z', expiresAt: '2026-10-16T17:00:00Z' });
  assert.equal(service.state().leagues[1].availability[0].status, 'unknown');
  archive.games[2].date = '2026-10-18T18:00:00Z';
  assert.equal(service.state().leagues[1].fixtures.length, 0);
});

test('shared native detail cache survives connector instances and charges only network calls', async () => {
  let current = new Date(NOW); const store = {}, nativeFetch = globalThis.fetch; let calls = 0, key = 'private-test-key';
  const create = () => createBasketballService({ getStore: () => store, persist: async () => {}, getApiKey: () => key, now: () => current });
  globalThis.fetch = async input => { calls++; const id = new URL(input).searchParams.get('id'); return Response.json({ response: [{ game: { id: Number(id) }, team: { id: 1 }, points: 80 }] }); };
  try {
    const service = create();
    const first = await service.withProvider(({ request }) => request('games/statistics/teams', { id: '7' }));
    first.response[0].points = 0;
    const second = await create().withProvider(({ request }) => request('games/statistics/teams', { id: '7' }));
    assert.equal(second.response[0].points, 80); assert.equal(calls, 1); assert.equal(store.basketball.quota.detailUsed, 1);
    assert.equal(JSON.stringify(store).includes(key), false);
    key = null; await assert.rejects(create().withProvider(({ request }) => request('games/statistics/teams', { id: '7' })), /Conecta/);
    key = 'different-key'; current = new Date(Date.parse(NOW) + 86400001);
    await create().withProvider(({ request }) => request('games/statistics/teams', { id: '7' })); assert.equal(calls, 2);
  } finally { globalThis.fetch = nativeFetch; }
});

test('empty and wrong-native-game replies are not cached as complete data', async () => {
  const nativeFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ response: calls === 1 ? [] : [{ game: { id: 999 }, team: { id: 1 } }] }); };
  try {
    // Independent budgets avoid artificial waiting in this parser/cache test.
    for (let i = 0; i < 2; i++) {
      const store = {}, service = createBasketballService({ getStore: () => store, persist: async () => {}, getApiKey: () => 'test', now: () => new Date(NOW) });
      await service.withProvider(({ request }) => request('games/statistics/teams', { id: '7' }));
      assert.equal(store.basketball.sharedDetails, undefined);
    }
    assert.equal(calls, 2);
  } finally { globalThis.fetch = nativeFetch; }
});
