import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('count markets flow through CSV, reports, lists and legacy API enrichment', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'football-counts-test-'));
  const nativeFetch = globalThis.fetch;
  process.env.OBSERVATORIO_DATA_DIR = directory;
  process.env.PORT = '0';
  const legacy = key => Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1), leagueKey: key, season: 2026,
    date: `2026-09-${String(index + 1).padStart(2, '0')}T18:00:00Z`,
    home: 'Norte', away: 'Sur', homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 1,
    stats: { home: { yellow: 2, red: 0 }, away: { yellow: 1, red: 1 } },
    statsChecked: true, source: 'api-football',
  }));
  const league = (key, covered) => ({ key, name: key, seasons: [2026], source: 'api-football',
    teamsBySeason: { 2026: ['Norte', 'Sur'] },
    coverageBySeason: { 2026: { fixtures: { statistics_fixtures: covered } } },
  });
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1,
    leagues: { 'api:99': league('api:99', true), 'api:98': league('api:98', false) },
    matches: [...legacy('api:99'), ...legacy('api:98')], cache: {},
  }));
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
    assert.equal(url.hostname, 'v3.football.api-sports.io');
    if (url.pathname === '/status') return Response.json({ errors: [], response: { subscription: { plan: 'Pro', active: true }, requests: { current: 0, limit: 7500 } } });
    assert.equal(url.pathname, '/fixtures');
    calls += 1;
    const ids = url.searchParams.get('ids').split('-').map(Number);
    return Response.json({ response: ids.map(id => ({
      fixture: { id, date: `2026-09-${String(id).padStart(2, '0')}T18:00:00Z`, status: { short: 'FT' } },
      league: { season: 2026 }, teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
      goals: { home: 2, away: 1 },
      statistics: [
        { team: { id: 1 }, statistics: [{ type: 'Offsides', value: 2 }, { type: 'Red Cards', value: 0 }] },
        { team: { id: 2 }, statistics: [{ type: 'Offsides', value: 1 }, { type: 'Red Cards', value: 1 }] },
      ],
    })) });
  };
  let server;
  try {
    const { startServer } = await import('./server.mjs?count-markets-test');
    server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body) => {
      const response = await nativeFetch(base + route, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const args = { season: 2026, home: 'Norte', away: 'Sur', cutoff: '2026-10-01T00:00:00Z', lookback: 10 };
    const find = (report, id) => report.markets.find(market => market.id === id);
    await post('/api/key', { key: 'isolated-test-key' });
    const first = await post('/api/report', { ...args, leagueKey: 'api:99' });
    assert.equal(calls, 1);
    assert.notEqual(find(first, 'offsides-over-2.5').probability, null);
    assert.equal(first.summary.home.averages.offsides.for, 2);
    assert.equal(first.summary.away.averages.offsides.for, 1);
    assert.equal(first.summary.leagueAverages.offsides.n, 10);
    await post('/api/report', { ...args, leagueKey: 'api:99' });
    assert.equal(calls, 1);
    const unsupported = await post('/api/report', { ...args, leagueKey: 'api:98' });
    assert.equal(find(unsupported, 'offsides-over-1.5').probability, null);
    assert.equal(calls, 1);
    await post('/api/key', { key: '' });

    const csv = [
      'date,time,home,away,home_goals,away_goals,home_offsides,away_offsides,home_red,away_red',
      ...Array.from({ length: 20 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')},18:00,Norte,Sur,2,1,${index % 4},1,${index % 3},0`),
      '2026-12-01,18:00,Norte,Sur,,,,,,',
    ].join('\n');
    const imported = await post('/api/import', { csv, leagueName: 'Conteos CSV', season: 2026 });
    assert.equal(imported.imported, 20);
    const csvArgs = { ...args, leagueKey: imported.league.key };
    const result = await post('/api/report', csvArgs);
    const ids = [
      ...[1.5, 2.5, 3.5, 4.5].flatMap(line => ['over', 'under'].map(direction => `offsides-${direction}-${line}`)),
      ...[0.5, 1.5, 2.5].map(line => `red-cards-over-${line}`),
    ];
    for (const id of ids) {
      const market = find(result, id);
      assert.ok(market);
      assert.ok(Number.isFinite(market.probability));
      assert.equal(market.samples.league, 20);
      assert.equal(market.observed.home.n, 10);
    }
    const list = await post('/api/list', csvArgs);
    assert.equal(list.fixtures.length, 1);
    for (const id of ids) assert.equal(find(list.fixtures[0], id).probability, find(result, id).probability);
    const withoutOffsides = await post('/api/import', { season: 2026, leagueName: 'Sin fuera de juego',
      csv: csv.split('\n').map(line => line.split(',').filter((_, index) => index !== 6 && index !== 7).join(',')).join('\n'),
    });
    const absent = await post('/api/report', { ...args, leagueKey: withoutOffsides.league.key });
    assert.equal(find(absent, 'offsides-over-1.5').probability, null);
    assert.equal(find(absent, 'offsides-over-1.5').samples.league, 0);
    assert.notEqual(find(absent, 'red-cards-over-0.5').probability, null);
  } finally {
    globalThis.fetch = nativeFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('football-counts-test-')) {
      throw new Error('Unsafe test cleanup path');
    }
    await rm(resolved, { recursive: true, force: true });
  }
});
