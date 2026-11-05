import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBasketballDaily } from './basketball-daily.mjs';
import { createBasketballResearch } from './basketball-research.mjs';
import { MODEL_VERSION } from './basketball-model.mjs';

const NOW = '2026-10-12T16:00:00.000Z';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function setup() {
  let current = NOW, requests = 0;
  const history = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, league: 'euroleague', season: '2026/2027',
    date: new Date(Date.UTC(2026, 8, i + 1, 18)).toISOString(), home: i % 2 ? 'Alpha' : 'Beta', away: i % 2 ? 'Beta' : 'Alpha',
    homePoints: 88 + i % 4, awayPoints: 76 + i % 5, finished: true, source: 'API-Basketball',
    stats: { home: { firstQuarterPoints: 22, halfTimePoints: 46 }, away: { firstQuarterPoints: 18, halfTimePoints: 38 } } }));
  const fixture = { id: 'future', league: 'euroleague', season: '2026/2027', date: '2026-10-12T18:00:00.000Z', home: 'Alpha', away: 'Beta', finished: false, status: 'NS', stats: {} };
  const players = history.slice(-10).map((game, i) => ({ id: `p${i}`, matchId: game.id, league: 'euroleague', season: '2026/2027', date: game.date,
    apiPlayerId: 10, name: 'Player A', team: 'Alpha', opponent: 'Beta', minutes: 30, source: 'API-Basketball',
    values: { points: 21 + i % 3, rebounds: 5 + i % 2, assists: 4, pra: 30 + i % 3, threes: 2 } }));
  const store = { basketball: { datasets: { euroleague: { '2026/2027': { matches: history, fixtures: [fixture] } } }, players,
    inputs: {}, trial: { version: MODEL_VERSION, snapshots: [], protocol: { lookback: 20, locked: true }, calibration: { untouched: true } } } };
  const frozen = structuredClone(store.basketball);
  const research = createBasketballResearch({ getStore: () => store, persist: async () => {}, basketball: {
    state: () => ({ connected: false }), withProvider: () => { requests++; throw new Error('No external requests allowed'); } }, now: () => new Date(current) });
  const daily = createBasketballDaily({ getStore: () => store, research, now: () => new Date(current) });
  return { daily, research, store, fixture, history, players, frozen, requests: () => requests, setTime: value => { current = value; } };
}
const body = { day: '2026-10-12' };
const reportBody = { league: 'euroleague', season: '2026/2027', fixtureId: 'future', lookback: 20, totalLine: 160.5, spreadLine: -3.5, quarterLine: 40.5, halfLine: 80.5 };
const playerBody = { ...reportBody, playerKey: 'API-Basketball:10', team: 'Alpha', metric: 'points', line: 20.5 };

test('daily GET is read-only, uses Guayaquil dates and never treats missing forecasts as zero probability', () => {
  const context = setup(), before = structuredClone(context.store);
  const result = context.daily.state();
  assert.equal(result.day, body.day); assert.equal(result.counts.fixtures, 1); assert.equal(result.rows.length, 0);
  assert.equal(result.counts.withoutForecast, 1); assert.deepEqual(context.store, before); assert.equal(context.requests(), 0);
  context.setTime('2026-10-13T02:00:00Z'); assert.equal(context.daily.state().day, '2026-10-12');
});

test('daily filters reject historical, impossible and distant dates without reconstruction', async () => {
  const { daily } = setup();
  for (const invalid of [{ day: '2026-10-11' }, { day: '2026-02-30' }, { day: '2026-10-20' }, { day: 'garbage' }, { league: 'football' }, { kind: 'fake' }]) {
    assert.throws(() => daily.state(invalid)); await assert.rejects(daily.prepare(invalid));
  }
});

test('preparation seals team and current roster individual markets, sorts and groups complements, leaves October frozen', async () => {
  const { daily, research, store, frozen, requests } = setup();
  const prepared = await daily.prepare(body);
  assert.equal(prepared.sealed, 6); assert.equal(prepared.state.counts.players, 5); assert.ok(prepared.state.counts.teams > 0);
  const rows = prepared.state.rows;
  assert.ok(rows.every(row => row.n >= 5 && row.probability >= 0 && row.probability <= 100));
  assert.ok(rows.every((row, i) => !i || row.probability <= rows[i - 1].probability));
  const over = research.dailyData().forecasts.find(row => row.playerProjection?.metric === 'assists').markets[0].probability;
  const assists = rows.find(row => row.spec.metric === 'assists');
  assert.equal(assists.spec.direction, 'under'); assert.equal(assists.probability, Math.round((100 - over) * 10000) / 10000);
  assert.match(assists.label, /Under 4.5 asistencias/); assert.equal(assists.projectedMinutes, 30);
  assert.equal((await daily.prepare(body)).sealed, 0); assert.equal((await daily.prepare(body)).existing, 6);
  assert.deepEqual(store.basketball, frozen); assert.equal(requests(), 0);
  assert.ok(daily.state({ ...body, kind: 'player' }).rows.every(row => row.kind === 'player'));
  assert.ok(rows.every(row => row.evidence && row.evidence.latest));
  const playerSupport = rows.find(row => row.kind === 'player').evidence;
  assert.equal(playerSupport.n, 10); assert.equal(playerSupport.unfilled, 10);
  assert.equal(playerSupport.label, 'Evidencia limitada');
  assert.ok(playerSupport.reasons.some(reason => /sin confirmar/.test(reason)));
});

test('daily never seals started, unknown-time, cancelled, preseason or reference fixtures', async () => {
  const { daily, fixture, setTime } = setup();
  for (const change of [{ status: 'Q1' }, { status: 'CANC' }, { timeKnown: false }, { preseason: true }, { referenceOnly: true }]) {
    Object.assign(fixture, change);
    assert.equal((await daily.prepare(body)).sealed, 0);
    delete fixture.timeKnown; delete fixture.preseason; delete fixture.referenceOnly; fixture.status = 'NS';
  }
  setTime('2026-10-12T17:56:00Z'); assert.equal((await daily.prepare(body)).sealed, 0);
  setTime('2026-10-12T18:01:00Z'); assert.equal(daily.state(body).rows.length, 0);
});

test('old seasons are not substituted for recent history and Endesa is not assigned a Euro model', async () => {
  const { daily, history, players, fixture, store, frozen } = setup();
  history.forEach(row => { row.season = '2024/2025'; }); players.forEach(row => { row.season = '2024/2025'; });
  store.basketball.datasets.euroleague['2024/2025'] = { matches: history, fixtures: [] };
  store.basketball.datasets.euroleague['2026/2027'].matches = [];
  const result = await daily.prepare(body);
  assert.equal(result.sealed, 0); assert.equal(result.state.rows.length, 0); assert.ok(result.issues.length > 0);
  store.basketballResearch = { games: [{ ...fixture, id: 'acb', league: 'endesa' }], players: [], availability: [], inputs: {}, forecasts: [] };
  const acb = await daily.prepare({ ...body, league: 'endesa' }); assert.equal(acb.sealed, 0); assert.match(acb.issues[0].reason, /independiente/);
  assert.equal(acb.state.counts.fixtures, 1); assert.equal(acb.state.rows.length, 0);
  assert.deepEqual(store.basketball.trial, frozen.trial);
});

test('missing individual metrics and new roster appearance do not manufacture forecasts', async () => {
  const { daily, players, store } = setup();
  players.forEach(row => { row.values.assists = null; row.values.pra = null; });
  players.push({ ...players.at(-1), id: 'new', apiPlayerId: 11, name: 'New player', values: { points: 18 } });
  const result = await daily.prepare({ ...body, kind: 'player' });
  assert.equal(result.sealed, 3); assert.equal(result.state.counts.teams, 0);
  assert.ok(!result.state.rows.some(row => ['assists', 'pra'].includes(row.spec.metric)));
  assert.ok(!store.basketballResearch.forecasts.some(row => row.playerProjection.player === 'New player'));
});

test('tampered probability or missing inputs are excluded rather than silently regenerated', async () => {
  const { daily, research, store } = setup();
  const snapshot = await research.seal(reportBody); snapshot.markets[0].probability = 100;
  assert.equal(daily.state(body).rows.length, 0); assert.equal(daily.state(body).excluded.invalid, 1);
  assert.equal((await daily.prepare({ ...body, kind: 'team' })).sealed, 0);
  delete store.basketballResearch.inputs[snapshot.inputHash]; assert.equal(daily.state(body).excluded.invalid, 1);
});

test('a reported absence or reduced minute limit removes individual picks without rewriting the seal', async () => {
  const { daily, research, store } = setup();
  const snapshot = await research.seal(playerBody), before = structuredClone(snapshot);
  const report = { league: 'euroleague', season: '2026/2027', team: 'Alpha', playerKey: 'API-Basketball:10', name: 'Player A',
    status: 'minutes_limit', minutesLimit: 15, publishedAt: '2026-10-12T15:00:00Z', expiresAt: '2026-10-13T16:00:00Z', sourceUrl: 'https://www.euroleaguebasketball.net/news/' };
  await research.saveAvailability(report);
  assert.equal(daily.state(body).rows.length, 0); assert.equal(daily.state(body).excluded.unavailable, 2);
  assert.deepEqual(store.basketballResearch.forecasts[0], before);
  await research.saveAvailability({ ...report, status: 'out' }); assert.equal(daily.state(body).rows.length, 0);
});

test('expired latest availability does not revive an older active report', async () => {
  const { daily, research, setTime } = setup();
  await research.seal(playerBody);
  const report = { league: 'euroleague', season: '2026/2027', team: 'Alpha', playerKey: 'API-Basketball:10', name: 'Player A', status: 'out',
    publishedAt: '2026-10-12T14:00:00Z', expiresAt: '2026-10-13T16:00:00Z', sourceUrl: 'https://www.euroleaguebasketball.net/news/' };
  await research.saveAvailability(report);
  await research.saveAvailability({ ...report, status: 'active', publishedAt: '2026-10-12T15:00:00Z', expiresAt: '2026-10-12T17:00:00Z' });
  setTime('2026-10-12T17:01:00Z');
  assert.equal(daily.state(body).rows[0].availability.status, 'unknown');
  assert.match(daily.state(body).rows[0].availability.note, /no verificada/);
});

test('trial scenarios win duplicate ties and player complements normalize FT without double counting', async () => {
  const { daily, research, store } = setup();
  const team = await research.seal(reportBody), player = await research.seal(playerBody);
  store.basketball.inputs = structuredClone(store.basketballResearch.inputs);
  const markets = [...team.markets, { ...player.markets[0], n: player.playerProjection.n, spec: { ...player.markets[0].spec } }];
  delete markets.at(-1).spec.period; delete markets.at(-1).spec.playerKey;
  const snapshot = { id: 'october', league: 'euroleague', fixture: team.fixture, createdAt: NOW, version: MODEL_VERSION, lookback: 20,
    markets, inputHash: team.inputHash, predictions: team.predictions };
  store.basketball.trial.snapshots.push({ ...snapshot, integrity: hash(snapshot) });
  const ranked = daily.state(body); assert.ok(ranked.rows.every(row => row.origin === 'trial'));
  assert.equal(ranked.counts.players, 1);
});

test('rescheduling or a later-started game hides the original picks without reselling them', async () => {
  const { daily, research, fixture, setTime } = setup();
  await research.seal(reportBody);
  fixture.date = '2026-10-12T19:00:00Z';
  assert.equal(daily.state(body).rows.length, 0); assert.equal(daily.state(body).excluded.rescheduled, 1);
  fixture.date = '2026-10-12T18:00:00Z'; setTime('2026-10-12T18:00:00Z');
  assert.equal(daily.state(body).rows.length, 0); assert.equal((await daily.prepare(body)).sealed, 0);
});

test('a missing fourth period does not invent quarter and half probabilities', async () => {
  const { daily, history } = setup();
  history.forEach(game => { game.stats = {}; });
  const result = await daily.prepare({ ...body, kind: 'team' });
  assert.ok(result.state.rows.length > 0); assert.ok(result.state.rows.every(row => row.spec.period === 'ft'));
});

test('the preparation batch advances beyond the first twenty already sealed fixtures', async () => {
  const { daily, store, fixture } = setup();
  store.basketball.datasets.euroleague['2026/2027'].fixtures = Array.from({ length: 21 }, (_, i) => ({ ...fixture, id: `f${i}`, date: new Date(Date.parse(fixture.date) + i * 60000).toISOString() }));
  const first = await daily.prepare({ ...body, kind: 'team' }); assert.equal(first.sealed, 20); assert.equal(first.remaining, 1);
  const second = await daily.prepare({ ...body, kind: 'team' }); assert.equal(second.sealed, 1); assert.equal(second.existing, 20); assert.equal(second.remaining, 0);
});
