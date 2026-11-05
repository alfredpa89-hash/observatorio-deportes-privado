import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('sports HTTP loads real-shaped sources, caches, imports and preserves isolated manual calendars', async () => {
  const work = path.resolve(tmpdir());
  const folder = await mkdtemp(path.join(work, 'sports-http-'));
  const nativeFetch = globalThis.fetch;
  const originalPort = process.env.PORT;
  const originalDir = process.env.OBSERVATORIO_DATA_DIR;
  process.env.OBSERVATORIO_DATA_DIR = folder; process.env.PORT = '0';
  let server; let providerCalls = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
    providerCalls += 1;
    if (url.hostname === 'site.api.espn.com') {
      if (url.pathname.endsWith('/summary')) {
        const id = url.searchParams.get('event'); const month = id.slice(0, 6); const index = Number(id.slice(6));
        return Response.json({ header: { id, season: { type: 2 }, competitions: [{
          date: `${month.slice(0, 4)}-${month.slice(4)}-${String(index + 10).padStart(2, '0')}T22:00:00Z`, status: { type: { completed: true } },
          competitors: [{ homeAway: 'home', team: { displayName: 'Alpha' }, score: String(110 + index) },
            { homeAway: 'away', team: { displayName: 'Beta' }, score: '105' }],
        }] }, boxscore: { players: [{ team: { displayName: 'Alpha' }, statistics: [{ labels: ['MIN', 'PTS', 'REB', 'AST', '3PT'],
          athletes: [{ athlete: { displayName: 'Player Alpha' }, stats: ['30', '23', '7', '6', '3-8'] }] }] }] } });
      }
      const month = url.searchParams.get('dates'); const year = Number(month.slice(0, 4)); const monthNumber = Number(month.slice(4));
      const seasonEnd = monthNumber >= 10 ? year + 1 : year; const completed = seasonEnd === 2026;
      return Response.json({ events: Array.from({ length: 5 }, (_, index) => ({
        id: `${month}${index}`, date: `${month.slice(0, 4)}-${month.slice(4)}-${String(index + 10).padStart(2, '0')}T22:00:00Z`,
        season: { year: seasonEnd, type: 2 }, status: { type: { completed } },
        competitions: [{ competitors: [
          { homeAway: 'home', team: { displayName: 'Alpha' }, score: completed ? String(110 + index) : '0' },
          { homeAway: 'away', team: { displayName: 'Beta' }, score: completed ? '105' : '0' },
        ] }],
      })) });
    }
    if (url.hostname === 'stats.tennismylife.org') {
      const season = url.pathname.match(/(20\d{2})\.csv$/)?.[1];
      return new Response(['date,tournament,category,surface,player1,player2,winner,best_of,score',
        ...Array.from({ length: 20 }, (_, index) => `${season}-08-${String(index + 1).padStart(2, '0')},Test ATP 500,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4`),
      ].join('\n'));
    }
    throw new Error(`Unexpected network call: ${url.hostname}`);
  };
  try {
    const { startServer } = await import('./server.mjs'); server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async url => (await nativeFetch(base + url)).json();
    const post = async (url, body) => {
      const response = await nativeFetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const initial = await get('/api/sports/state');
    assert.ok(initial.nba.datasets.every(set => !set.matchCount));
    assert.equal((await post('/api/sports/load', { sport: 'other' })).status, 400);
    const loaded = await post('/api/sports/load', { sport: 'nba', season: '2026/2027' });
    assert.equal(loaded.status, 200); assert.equal(loaded.data.state.nba.datasets[0].fixtureCount, 35);
    const calls = providerCalls; await post('/api/sports/load', { sport: 'nba', season: '2026/2027' }); assert.equal(providerCalls, calls);
    const nbaArgs = { sport: 'nba', season: '2026/2027', home: 'Alpha', away: 'Beta', cutoff: '2026-10-07T00:00:00-05:00', totalLine: 220.5 };
    const nba = await post('/api/sports/report', nbaArgs); assert.equal(nba.status, 200);
    assert.equal(nba.data.markets[0].probability + nba.data.markets[1].probability, 100);
    assert.ok(nba.data.history.home.every(match => match.date < nba.data.meta.cutoff));
    for (const lookback of [5, 15, 25, 30]) {
      const window = await post('/api/sports/report', { ...nbaArgs, lookback });
      assert.equal(window.data.history.home.length, lookback); assert.equal(window.data.meta.lookback, lookback);
    }
    const playerArgs = { sport: 'nba', season: nbaArgs.season, cutoff: nbaArgs.cutoff, lookback: 5, team: 'Alpha' };
    const players = await post('/api/profiles/nba-load', playerArgs);
    assert.equal(players.status, 200); assert.equal(players.data.available, 5);
    const playerCalls = providerCalls; await post('/api/profiles/nba-load', playerArgs); assert.equal(providerCalls, playerCalls);
    const playerProfile = await post('/api/profiles/report', { ...playerArgs, kind: 'player', name: 'Player Alpha', playerTeam: 'Alpha', metric: 'pra' });
    assert.equal(playerProfile.status, 200); assert.equal(playerProfile.data.history.length, 5);
    assert.equal(playerProfile.data.summary.find(field => field.id === 'pra').average, 36);
    assert.equal((await post('/api/profiles/nba-load', { ...playerArgs, team: 'Unknown' })).status, 400);
    assert.equal((await post('/api/sports/report', { ...nbaArgs, home: 'Unknown' })).status, 400);
    assert.equal((await post('/api/sports/report', { ...nbaArgs, totalLine: 220 })).status, 400);
    const added = await post('/api/sports/fixtures/manual', { ...nbaArgs, date: '2027-05-01', time: '18:00' }); assert.equal(added.status, 200);
    assert.equal((await post('/api/sports/fixtures/manual', { ...nbaArgs, date: '2027-05-01', time: '18:00' })).status, 409);
    assert.equal((await post('/api/sports/fixtures/manual', { ...nbaArgs, date: '2028-05-01', time: '18:00' })).status, 400);
    const imported = await post('/api/sports/import', { sport: 'nba', season: '2026/2027',
      csv: 'date,home,away,home_points,away_points,home_threes,home_q1_points,away_q1_points,home_ht_points,away_ht_points\n2026-10-01,Alpha,Beta,120,110,15,25,26,55,54\n2026-12-01,Alpha,Beta,,,' });
    assert.equal(imported.status, 200); assert.equal(imported.data.imported, 1);
    assert.equal(imported.data.state.nba.datasets[0].fixtureCount, 2);
    const individual = await post('/api/profiles/report', { sport: 'nba', season: '2026/2027', name: 'Alpha', cutoff: nbaArgs.cutoff, lookback: 15 });
    assert.equal(individual.status, 200); assert.equal(individual.data.meta.lookback, 15);
    assert.equal(individual.data.history[0].values.firstQuarterPoints, 25);
    assert.equal(individual.data.history[0].values.halfTimePoints, 55);
    const listed = await post('/api/sports/list', nbaArgs); assert.equal(listed.status, 200);
    assert.equal(listed.data.fixtures.filter(match => match.manual).length, 1);
    assert.ok(listed.data.fixtures.every(match => match.analysisCutoff === nba.data.meta.cutoff));
    assert.equal((await post('/api/sports/fixtures/manual/remove', { ...nbaArgs, id: 'not-manual' })).status, 404);
    assert.equal((await post('/api/sports/fixtures/manual/remove', { ...nbaArgs, id: added.data.fixture.id })).status, 200);
    assert.equal((await post('/api/sports/load', { sport: 'tennis', season: '2026' })).status, 200);
    const tennisArgs = { sport: 'tennis', season: '2026', home: 'Alpha', away: 'Beta', cutoff: nbaArgs.cutoff, totalLine: 22.5, bestOf: 3, category: 'atp-500' };
    const tennis = await post('/api/sports/report', tennisArgs); assert.equal(tennis.status, 200);
    assert.equal(tennis.data.markets[0].probability + tennis.data.markets[1].probability, 100);
    for (const lookback of [5, 15]) {
      const window = await post('/api/sports/report', { ...tennisArgs, lookback });
      assert.equal(window.data.history.home.length, lookback); assert.equal(window.data.meta.lookback, lookback);
    }
    assert.equal((await post('/api/sports/list', tennisArgs)).data.fixtures.length, 0);
    const planned = await post('/api/sports/fixtures/manual', { ...tennisArgs, date: '2026-12-01', time: '18:00' }); assert.equal(planned.status, 200);
    const saved = JSON.parse(await readFile(path.join(folder, 'state.json'), 'utf8'));
    assert.equal(saved.sports.tennis.manual['2026'].length, 1); assert.equal(saved.matches.length, 0);
    assert.equal((await nativeFetch(base + '/templates/tennis.csv')).status, 200);
  } finally {
    globalThis.fetch = nativeFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
    if (originalDir === undefined) delete process.env.OBSERVATORIO_DATA_DIR; else process.env.OBSERVATORIO_DATA_DIR = originalDir;
    if (!path.resolve(folder).startsWith(work + path.sep)) throw new Error('Unsafe test cleanup');
    await rm(folder, { recursive: true, force: true });
  }
});
