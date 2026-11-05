import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('basketball HTTP persists a private immutable trial, uses free cache and never saves credentials', async t => {
  // Exercise the archived October protocol without reopening it on today's date.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 14, 15) });
  const directory = await mkdtemp(path.join(tmpdir(), 'basketball-http-'));
  const timestamp = new Date().toISOString(), fixtureDate = new Date(Date.now() + 12 * 3600000).toISOString();
  const matches = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, league: 'euroleague', season: '2026/2027',
    date: new Date(Date.UTC(2026, 7, i + 1, 18)).toISOString(), home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A',
    homePoints: 85 + i % 7, awayPoints: 75 + i % 5, finished: true, status: 'Final', seasonType: 2,
    stats: { home: { firstQuarterPoints: 22, halfTimePoints: 45 }, away: { firstQuarterPoints: 18, halfTimePoints: 38 } } }));
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1, leagues: {}, matches: [], cache: {},
    basketballResearch: { games: matches.map((game, i) => ({ ...game, id: `acb-${i}`, league: 'endesa', season: '2024/2025', home: 'C', away: 'D', date: new Date(Date.UTC(2025, 0, i + 1, 18)).toISOString() })), players: [], availability: [], forecasts: [], inputs: {}, details: {} },
    basketball: { catalogAt: timestamp, catalog: [{ id: 50, name: 'Euroleague', seasons: [{ season: 2026, coverage: { games: { statistics: { teams: false, players: false } } } }] }],
      datasets: { euroleague: { '2026/2027': { matches, fixtures: [] } } } } }));
  process.env.OBSERVATORIO_DATA_DIR = directory; process.env.PORT = '0'; process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1';
  const nativeFetch = globalThis.fetch; let calls = 0, server;
  globalThis.fetch = async (input, options) => {
    if (new URL(input).hostname === '127.0.0.1') return nativeFetch(input, options);
    calls++; assert.equal(options.headers['x-apisports-key'], 'a'.repeat(32));
    if (new URL(input).pathname === '/status') return Response.json({ response: { account: { email: 'private@example.com' }, subscription: { plan: 'Free', active: true }, requests: { limit_day: 100 } } });
    assert.equal(new URL(input).searchParams.get('season'), '2026');
    return Response.json({ errors: [], response: [{ id: 99, date: fixtureDate, status: { short: 'NS' }, league: { id: 50, season: 2026 },
      teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } }, scores: { home: { total: 0 }, away: { total: 0 } } }] },
      { headers: { 'x-ratelimit-requests-remaining': '99' } });
  };
  try {
    const { startServer } = await import('./server.mjs'); server = await startServer();
    let base = `http://127.0.0.1:${server.address().port}`;
    const request = async (endpoint, body) => { const response = await nativeFetch(`${base}/api/basketball/${endpoint}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
    assert.equal((await request('state')).data.connected, false);
    assert.equal((await request('key', { key: 'a'.repeat(32) })).status, 200);
    const updated = await request('refresh', { league: 'euroleague', details: false }); assert.equal(updated.status, 200); assert.equal(calls, 1);
    assert.equal(updated.data.state.leagues[1].datasets[0].fixtures, 1);
    await request('refresh', { league: 'euroleague', details: false }); assert.equal(calls, 1);
    const start = await request('trial/start', {}); assert.equal(start.status, 200); assert.equal(start.data.snapshots.length, 1);
    const snapshot = start.data.snapshots[0];
    const beforePrematch = calls;
    const catalog = await request('prematch/catalog?league=euroleague&season=2026%2F2027');
    assert.equal(catalog.status, 200); assert.equal(catalog.data.fixtures[0].id, 'api-basketball:99');
    const prematch = await request('prematch', { league: 'euroleague', season: '2026/2027', fixtureId: 'api-basketball:99', lookback: 30 });
    assert.equal(prematch.status, 200); assert.equal(prematch.data.teams[0].n, 30); assert.equal(prematch.data.meta.modelChanged, false);
    assert.equal((await request('prematch', { league: 'endesa', season: '2024/2025', home: 'C', away: 'D' })).data.meta.descriptive, true);
    assert.equal((await request('prematch', { league: 'euroleague', fixtureId: 'missing' })).status, 400);
    assert.equal(calls, beforePrematch); assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    const teams = await request('teams/catalog?league=endesa&season=2024%2F2025');
    assert.equal(teams.status, 200); assert.equal(teams.data.teams[0].seasonGames, 50);
    const individual = await request('teams/analysis', { league: 'endesa', season: '2024/2025', team: 'C' });
    assert.equal(individual.status, 200); assert.equal(individual.data.summary.n, 50); assert.equal(individual.data.meta.modelChanged, false);
    assert.equal((await request('teams/analysis', { league: 'endesa', season: '2024/2025', team: 'C', lookback: 25 })).data.summary.n, 25);
    assert.equal((await request('teams/analysis', { league: 'endesa', season: '2026/2027', team: 'C' })).data.summary.n, 0);
    assert.equal((await request('teams/analysis', { league: 'endesa', team: 'Unknown' })).status, 400);
    assert.equal(calls, beforePrematch); assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    assert.ok((await request('state')).data.leagues.some(row => row.key === 'endesa'));
    const playerCatalog = await request('players/catalog?league=endesa&season=2024%2F2025');
    assert.equal(playerCatalog.status, 200); assert.equal(playerCatalog.data.players.length, 0); assert.ok(playerCatalog.data.teams.includes('C'));
    assert.equal((await request('players/analysis', { league: 'endesa', season: '2024/2025', playerKey: 'unknown' })).status, 400);
    assert.equal((await request('research/player-sync', { league: 'endesa', season: '2024/2025', team: 'Unknown' })).status, 400);
    for (const lookback of [25, 30]) {
      const body = { league: 'endesa', season: '2024/2025', home: 'C', away: 'D', lookback };
      const endesa = await request('report', body);
      assert.equal(endesa.status, 200); assert.equal(endesa.data.history.home.length, lookback);
      assert.deepEqual(endesa.data.markets, []); assert.equal(endesa.data.meta.descriptive, true);
      assert.equal((await request('list', body)).status, 200);
      assert.equal((await request('evaluation?league=endesa')).data.unavailable, true);
      assert.equal((await request('backtest', body)).status, 400);
    }
    const extended = await request('report', { league: 'euroleague', season: '2026/2027', home: 'A', away: 'B', lookback: 30 });
    assert.equal(extended.data.history.home.length, 30);
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    const access = await request('research/access', {}); assert.equal(access.status, 200); assert.equal(access.data.plan, 'Free'); assert.equal(access.data.dailyLimit, 100); assert.ok(!JSON.stringify(access).includes('private@example.com'));
    const research = await request('research/state?league=euroleague&season=2026%2F2027&lookback=5');
    assert.equal(research.status, 200); assert.equal(research.data.counts.games, 50); assert.equal(research.data.teams[0].n, 5);
    assert.equal((await request('research/state?league=unknown')).status, 400);
    const extra = await request('research/forecast', { league: 'euroleague', season: '2026/2027', fixtureId: 'api-basketball:99', lookback: 20, totalLine: 160.5, spreadLine: -3.5, quarterLine: 40.5, halfLine: 80.5 });
    assert.equal(extra.status, 200); assert.equal((await request('research/state')).data.forecasts[0].valid, true);
    assert.equal((await request('research/backtest', { league: 'euroleague', season: '2026/2027' })).status, 400);
    assert.equal((await request('research/forecast', { league: 'endesa' })).status, 400);
    const exported = await request('research/export'); assert.equal(exported.status, 200); assert.ok(!JSON.stringify(exported.data).includes('a'.repeat(32)));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fixtureDate));
    const daily = await request(`daily?day=${day}`); assert.equal(daily.status, 200); assert.ok(daily.data.rows.length > 0);
    assert.ok(daily.data.rows.every(row => row.origin === 'trial')); assert.ok(!JSON.stringify(daily.data).includes('a'.repeat(32)));
    assert.equal((await request('daily?day=2020-01-01')).status, 400);
    const beforeDaily = calls;
    const prepared = await request('daily/prepare', { day, kind: 'team' }); assert.equal(prepared.status, 200); assert.equal(prepared.data.sealed, 0); assert.equal(calls, beforeDaily);
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    const week = await request('week', { league: 'euroleague', season: '2026/2027', startDate: '2026-10-05', endDate: '2026-10-11' });
    assert.equal(week.status, 200); assert.equal(week.data.completed.length, 3); assert.equal(week.data.players.length, 6);
    assert.equal((await request('state')).data.leagues[1].datasets[0].matches, 50);
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    assert.equal((await request('week', { startDate: '2026-10-12', endDate: '2026-10-11' })).status, 400);
    assert.equal((await request('trial/start', {})).data.snapshots.length, 1);
    assert.equal((await request('audit')).data.valid, true);
    const history = await request('report', { league: 'euroleague', season: '2026/2027', home: 'A', away: 'B', lookback: 20 });
    assert.equal(history.status, 200); assert.equal(history.data.meta.periods.q1.homeN, 20);
    assert.equal((await request('report', { league: 'euroleague', home: 'A', away: 'A' })).status, 400);
    assert.equal((await request('import', { league: 'euroleague', csv: 'date,home,away,home_points,away_points\n2026-09-01,A,B,90,85' })).status, 200);
    assert.equal((await request('import', { league: 'euroleague', csv: 'id,date,home,away,home_points,away_points,home_q1_points,home_ht_points\ninvalid-period,2026-09-02,A,B,90,85,30,20' })).status, 200);
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    const persisted = await readFile(path.join(directory, 'state.json'), 'utf8'); assert.ok(!persisted.includes('a'.repeat(32)));
    assert.ok(!persisted.includes('reference:el:'), 'References must not enter the prediction database.');
    const invalidPeriod = JSON.parse(persisted).basketball.datasets.euroleague['2026/2027'].matches.find(row => row.id === 'invalid-period');
    assert.equal(invalidPeriod.stats.home.firstQuarterPoints, null); assert.equal(invalidPeriod.stats.home.halfTimePoints, null);
    const beforeStop = calls;
    assert.equal((await request('trial/stop', {})).data.active, false);
    assert.equal(calls, beforeStop, 'stopping the trial makes no provider request');
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot);
    await new Promise(resolve => server.close(resolve)); server = await startServer(); base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await request('trial')).data.active, false);
    assert.equal((await request('state')).data.connected, true); // Process-memory key remains; nothing was serialized.
    assert.deepEqual((await request('trial')).data.snapshots[0], snapshot); assert.equal((await request('audit')).data.valid, true);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); globalThis.fetch = nativeFetch;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(directory, { recursive: true, force: true });
  }
});
