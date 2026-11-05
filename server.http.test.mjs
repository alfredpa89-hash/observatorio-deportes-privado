import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('HTTP routes keep data isolated, honor cutoff, and list cached fixtures', async t => {
  // Keep the fixed fixture calendar in the future independently of the run date.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 14, 15) });
  const testDataDir = await mkdtemp(path.join(tmpdir(), 'observatorio-test-'));
  const nativeFetch = globalThis.fetch;
  process.env.OBSERVATORIO_DATA_DIR = testDataDir;
  process.env.PORT = '0';
  let providerCalls = 0;
  const detailIds = [];
  const match = (id, day) => ({
    fixture: { id, date: `2026-09-${String(day).padStart(2, '0')}T18:00:00+00:00`, status: { short: 'FT' } },
    league: { season: 2026 },
    teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
    goals: { home: 2, away: 1 },
    score: { halftime: { home: 1, away: 0 } },
    statistics: [
      { team: { id: 1 }, statistics: [{ type: 'Shots on Goal', value: 5 }, { type: 'Corner Kicks', value: 7 }, { type: 'Fouls', value: 11 }, { type: 'Yellow Cards', value: 2 }, { type: 'Red Cards', value: 0 }] },
      { team: { id: 2 }, statistics: [{ type: 'Shots on Goal', value: 3 }, { type: 'Corner Kicks', value: 4 }, { type: 'Fouls', value: 12 }, { type: 'Yellow Cards', value: 1 }, { type: 'Red Cards', value: 0 }] },
    ],
  });
  const future = {
    fixture: { id: 999, date: '2027-11-01T18:00:00+00:00', status: { short: 'NS' } },
    league: { season: 2026 },
    teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
    goals: { home: null, away: null },
  };
  const europeCsv = (year) => [
    'Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,HTHG,HTAG',
    ...Array.from({ length: 12 }, (_, index) =>
      `${String(index + 1).padStart(2, '0')}/09/${year},Alpha,Beta,2,1,12,8,5,3,11,13,6,4,2,1,0,0,1,0`),
  ].join('\n');
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return nativeFetch(input, options);
    providerCalls += 1;
    if (url.hostname === 'v3.football.api-sports.io' && url.pathname === '/status') return Response.json({ errors: [], response: { subscription: { plan: 'Pro', active: true }, requests: { current: 0, limit: 7500 } } });
    if (url.hostname === 'v3.football.api-sports.io' && url.pathname === '/leagues') {
      const country = url.searchParams.get('country');
      if (country) {
        const names = { Ecuador: ['Liga Pro', 'Liga Pro Serie B'], Colombia: ['Primera A', 'Primera B'], Bolivia: ['Primera División'], Uruguay: ['Primera División', 'Primera División - Clausura', 'Segunda División'], Peru: ['Primera División', 'Segunda División'], Chile: ['Primera División', 'Primera B', 'Copa Chile'], Paraguay: ['Division Profesional - Apertura', 'Division Profesional - Clausura'], Netherlands: ['Eredivisie', 'Eerste Divisie'], Portugal: ['Primeira Liga', 'Segunda Liga'], World: ['UEFA Champions League', 'UEFA Champions League Women', 'UEFA Europa League', 'UEFA Europa Conference League', 'CONMEBOL Libertadores', 'CONMEBOL Libertadores U20', 'CONMEBOL Sudamericana'] }[country] || [];
        return Response.json({ response: names.map((name, index) => ({
          league: { id: 500 + index, name }, country: { name: country }, seasons: [{ year: 2024 }],
        })) });
      }
      return Response.json({ response: [{
        league: { id: 123, name: 'Liga Prueba' }, country: { name: 'Ecuador' },
        seasons: [{ year: 2026, coverage: { fixtures: { statistics_fixtures: true } } }],
      }] }, { headers: { 'x-ratelimit-requests-limit': '100', 'x-ratelimit-requests-remaining': '99' } });
    }
    if (url.hostname === 'v3.football.api-sports.io' && url.pathname === '/fixtures' && url.searchParams.has('league')) {
      return Response.json({ response: [...Array.from({ length: 12 }, (_, index) => {
        const item = match(index + 1, index + 1);
        delete item.statistics;
        return item;
      }), future] },
        { headers: { 'x-ratelimit-requests-limit': '100', 'x-ratelimit-requests-remaining': '98' } });
    }
    if (url.hostname === 'v3.football.api-sports.io' && url.pathname === '/fixtures' && url.searchParams.has('ids')) {
      const ids = url.searchParams.get('ids').split('-').map(Number);
      detailIds.push(...ids);
      return Response.json({ response: ids.map((id) => match(id, id)) },
        { headers: { 'x-ratelimit-requests-limit': '100', 'x-ratelimit-requests-remaining': '97' } });
    }
    if (url.hostname === 'www.football-data.co.uk' && url.pathname === '/fixtures.csv') {
      return new Response([
        'Div,Date,Time,HomeTeam,AwayTeam',
        'E0,01/05/27,19:45,Alpha,Beta',
        'SP1,01/05/27,20:00,Otro Uno,Otro Dos',
      ].join('\n'), { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    if (url.hostname === 'www.football-data.co.uk' && url.pathname.startsWith('/new/')) {
      const mexican = url.pathname.includes('MEX');
      const [country, league] = url.pathname.includes('BRA') ? ['Brazil', 'Serie A'] : url.pathname.includes('ARG') ? ['Argentina', 'Liga Profesional'] : mexican ? ['Mexico', 'Liga MX'] : ['USA', 'MLS'];
      const rows = [2026, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) =>
        `${country},${league},${mexican ? `${year}/${year + 1}` : year},${String(index + 1).padStart(2, '0')}/09/${year},19:45,Alpha,Beta,2,1,H`));
      return new Response(['Country,League,Season,Date,Time,Home,Away,HG,AG,Res', ...rows].join('\n'), { status: 200 });
    }
    if (url.hostname === 'raw.githubusercontent.com' && /\/(?:co\.1|br\.2)\.json$/.test(url.pathname)) {
      return Response.json({ name: url.pathname.endsWith('/co.1.json') ? 'Colombia Primera A 2025' : 'Brasileiro Série B 2025', matches: [
        ...Array.from({ length: 12 }, (_, index) => ({
          date: `2025-05-${String(index + 1).padStart(2, '0')}`, time: '18:00',
          team1: 'Alpha', team2: 'Beta', score: { ft: [2, 1], ht: [0, 1] },
        })), { date: '2025-05-25', team1: 'Alpha', team2: 'Beta' },
      ] });
    }
    if (url.hostname === 'raw.githubusercontent.com' && /\/(?:2025_ec1|2025_py1)\.txt$/.test(url.pathname)) {
      return new Response([url.pathname.endsWith('/2025_py1.txt') ? '= Paraguay Primera Division 2025' : '= Ecuador Serie A 2025',
        ...Array.from({ length: 12 }, (_, index) => `  Sun May ${index + 1} 2025\n    18:00 Alpha v Beta 2-1 (1-0)`),
        '  Sun Sep 28\n    Alpha v Beta',
      ].join('\n'));
    }
    if (url.hostname === 'www.football-data.co.uk') {
      return new Response(europeCsv(url.pathname.includes('/2627/') ? '26' : '25'), { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  let server;
  try {
    const { startServer } = await import('./server.mjs?isolated-http-test');
    server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (route) => nativeFetch(base + route).then((response) => response.json());
    const post = async (route, body) => nativeFetch(base + route, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(async (response) => ({ status: response.status, data: await response.json() }));

    const badHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1', port: server.address().port, path: '/api/state',
        headers: { Host: 'outside.example' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(badHostStatus, 403);
    const badOrigin = await nativeFetch(base + '/api/key', {
      method: 'POST', headers: { Origin: 'https://outside.example', 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'blocked-key' }),
    });
    assert.equal(badOrigin.status, 403);
    const badType = await nativeFetch(base + '/api/key', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ key: 'blocked-key' }),
    });
    assert.equal(badType.status, 415);
    assert.equal((await get('/api/state')).connected, false);
    assert.equal((await get('/api/basketball/analysis/journal')).total,0);
    assert.deepEqual((await get('/api/basketball/official')).rows,[]);
    assert.equal((await post('/api/basketball/analysis',{})).status,400);
    assert.equal((await post('/api/basketball/analysis/seal',{idempotencyKey:'valid-test-key'})).status,400);
    const noKeyCalls = providerCalls;
    const initialState = await get('/api/state');
    assert.equal(initialState.freeLeagues.length, 19);
    assert.equal(initialState.apiLeagues.length, 13);
    assert.ok(!initialState.catalog.some(league => league.key.startsWith('api-preset:')));
    const freeSearch = await get('/api/search?q=MLS');
    assert.equal(freeSearch.results[0].division, 'USA');
    assert.equal(freeSearch.results[0].sourceType, 'free');
    const mexicoSearch = await get('/api/search?q=Liga%20Mexicana');
    assert.equal(mexicoSearch.results[0].division, 'MEX');
    for (const [query, division] of [['Brasil', 'BRA'], ['Liga%20Argentina', 'ARG'], ['Liga%20Colombiana', 'COL'], ['Liga%20Pro', 'ECU'], ['Liga%20Paraguaya', 'PAR1']]) {
      const result = await get(`/api/search?q=${query}`);
      assert.equal(result.results[0].division, division);
      assert.equal(result.requiresKey, false);
    }
    const otherSearch = await get('/api/search?q=Peru');
    assert.equal(otherSearch.requiresKey, false);
    assert.equal(otherSearch.results[0].key, 'espn:PER');
    assert.equal(providerCalls, noKeyCalls);
    for (const [query, key] of [['Serie%20B%20Ecuador', 'api-preset:ecu2'], ['Serie%20B%20Colombia', 'api-preset:col2'], ['Bolivia', 'api-preset:bol'], ['Uruguay', 'api-preset:uru']]) {
      const result = await get(`/api/search?q=${query}`);
      assert.equal(result.requiresKey, true);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].key, key);
      assert.equal(result.results[0].sourceType, 'api-required');
      assert.deepEqual(result.results[0].seasons, []);
    }
    assert.equal(providerCalls, noKeyCalls);
    assert.equal((await get('/api/search?q=Championship')).results[0].division, 'E1');
    assert.equal((await get('/api/search?q=Serie%20B%20de%20Brasil')).results[0].division, 'BRA2');
    for (const [query, division] of [['Eredivisie', 'N1'], ['Everdise', 'N1'], ['Liga holandesa', 'N1'], ['Holanda', 'N1'], ['Paises Bajos', 'N1'], ['Liga de Portugal', 'P1'], ['Primeira Liga', 'P1']]) {
      const result = await get(`/api/search?q=${encodeURIComponent(query)}`);
      assert.equal(result.results[0].division, division); assert.equal(result.requiresKey, false);
    }
    for (const [query, key] of [['Champions League', 'ucl'], ['Europa League', 'uel'], ['Conference League', 'uecl'], ['Copa Libertadores', 'lib'], ['Copa Sudamericana', 'sud']]) {
      const result = await get(`/api/search?q=${encodeURIComponent(query)}`);
      assert.equal(result.requiresKey, true); assert.equal(result.results.length, 1);
      assert.equal(result.results[0].key, `api-preset:${key}`);
      assert.deepEqual(result.results[0].seasons, []);
      assert.equal(result.results[0].sourceType, 'api-required');
    }
    assert.equal(providerCalls, noKeyCalls);

    for (const [division, season] of [['USA', '2026'], ['MEX', '2026/2027'], ['BRA', '2026'], ['ARG', '2026']]) {
      const loadedFree = await post('/api/free', { division, season });
      assert.equal(loadedFree.status, 200);
      assert.equal(loadedFree.data.imported, 12);
      assert.equal(loadedFree.data.previousImported, 12);
      assert.equal(loadedFree.data.selectedSeason, season);
      assert.ok(loadedFree.data.warning.includes('no córners'));
      const freeReport = await post('/api/report', { leagueKey: `football-data:${division}`, season, home: 'Alpha', away: 'Beta', cutoff: '2026-10-01T00:00:00Z', lookback: 20 });
      assert.equal(freeReport.status, 200);
      assert.equal(freeReport.data.history.home.length, 20);
      assert.notEqual(freeReport.data.markets.find((item) => item.id === 'goals-under-4.5').probability, null);
      assert.equal(freeReport.data.markets.find((item) => item.id === 'cards-under-2.5').probability, null);
      assert.equal(freeReport.data.markets.find((item) => item.id === 'shots-on-target-over-5.5').probability, null);
      assert.ok(freeReport.data.markets.filter((item) => /-1t$/.test(item.group)).every((item) => item.probability === null));
    }
    const callsBeforeExtraAgain = providerCalls;
    await post('/api/free', { division: 'USA', season: '2026' });
    assert.equal(providerCalls, callsBeforeExtraAgain);

    for (const division of ['COL', 'ECU', 'BRA2', 'PAR']) {
      const loadedOpen = await post('/api/free', { division, season: '2025' });
      assert.equal(loadedOpen.status, 200);
      assert.equal(loadedOpen.data.imported, 12);
      assert.equal(loadedOpen.data.league.fixtureCount, 0);
      assert.equal(loadedOpen.data.league.source, 'OpenFootball');
      assert.deepEqual(loadedOpen.data.league.seasons, ['2025']);
      assert.ok(loadedOpen.data.warning.includes('histórico parcial'));
      const beforeRepeat = providerCalls;
      assert.equal((await post('/api/free', { division, season: '2025' })).data.imported, 12);
      assert.equal(providerCalls, beforeRepeat);
      assert.equal((await post('/api/free', { division, season: '2026' })).status, 400);
      const archivedReport = await post('/api/report', {
        leagueKey: `openfootball:${division}`, season: '2025', home: 'Alpha', away: 'Beta',
        cutoff: '2025-06-01T00:00:00Z', lookback: 10,
      });
      assert.equal(archivedReport.status, 200);
      assert.ok(archivedReport.data.meta.providerWarning.includes('No incluye la temporada 2026'));
      assert.notEqual(archivedReport.data.markets.find(item => item.id === 'half-time-result-draw').probability, null);
      assert.equal(archivedReport.data.markets.find(item => item.id === 'corners-over-7.5').probability, null);
      const archivedList = await post('/api/list', { leagueKey: `openfootball:${division}`, season: '2025', cutoff: '2025-01-01T00:00:00Z' });
      assert.deepEqual(archivedList.data.fixtures, []);
    }

    const imported = await post('/api/import', {
      csv: 'Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\n01/08/26,,Manual Uno,Manual Dos,1,0\n01/05/27,20:00,Manual Uno,Manual Dos,,',
      leagueName: 'Liga manual', season: 2026,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.league.source, 'csv');
    assert.equal(imported.data.league.fixtureCount, 1);
    const savedSearch = await get('/api/search?q=Liga%20manual');
    assert.equal(savedSearch.results[0].sourceType, 'saved');
    assert.equal(savedSearch.results[0].key, 'csv:liga-manual');
    const manualEarly = await post('/api/report', {
      leagueKey: 'csv:liga-manual', season: 2026, home: 'Manual Uno', away: 'Manual Dos',
      cutoff: '2026-08-01T00:00:00-05:00',
    });
    assert.equal(manualEarly.data.history.home.length, 0);
    const manualNextDay = await post('/api/report', {
      leagueKey: 'csv:liga-manual', season: 2026, home: 'Manual Uno', away: 'Manual Dos',
      cutoff: '2026-08-02T00:00:00-05:00',
    });
    assert.equal(manualNextDay.data.history.home.length, 1);

    const expanded = await post('/api/import', { leagueName: 'Ventanas ampliadas', season: 2026,
      csv: ['Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG',
        ...Array.from({ length: 30 }, (_, i) => `${String(i + 1).padStart(2, '0')}/09/26,18:00,Ventana Norte,Ventana Sur,2,1,1,0`),
        '01/11/26,18:00,Ventana Norte,Ventana Sur,,,,'].join('\n') });
    assert.equal(expanded.status, 200);
    for (const lookback of [25, 30]) {
      const selection = { leagueKey: expanded.data.league.key, season: 2026, lookback, cutoff: '2026-10-01T00:00:00Z' };
      const result = await post('/api/report', { ...selection, home: 'Ventana Norte', away: 'Ventana Sur' });
      assert.equal(result.status, 200); assert.equal(result.data.meta.lookback, lookback);
      assert.equal(result.data.history.home.length, lookback); assert.equal(result.data.history.away.length, lookback);
      const list = await post('/api/list', selection);
      assert.equal(list.status, 200); assert.equal(list.data.lookback, lookback); assert.equal(list.data.fixtures.length, 1);
      const individual = await post('/api/profiles/report', { ...selection, sport: 'football', kind: 'team', name: 'Ventana Norte' });
      assert.equal(individual.status, 200); assert.equal(individual.data.history.length, lookback);
    }

    const calendarArgs = { leagueKey: 'football-data:USA', season: '2026', lookback: 20, cutoff: '2026-10-01T00:00:00Z' };
    const emptyList = await post('/api/list', calendarArgs);
    assert.equal(emptyList.data.emptyReason, 'calendar-empty');
    assert.ok(emptyList.data.note.includes('No significa 0%'));
    const manualArgs = { ...calendarArgs, home: 'Alpha', away: 'Beta', date: '2026-11-15', time: '18:30' };
    const added = await post('/api/fixtures/manual', manualArgs);
    assert.equal(added.status, 200);
    assert.equal(added.data.fixture.manual, true);
    assert.equal(added.data.fixture.date, '2026-11-15T23:30:00.000Z');
    assert.equal(added.data.state.catalog.find(league => league.key === calendarArgs.leagueKey).fixtureCountBySeason['2026'], 1);
    for (const invalid of [
      { home: 'Unknown' }, { away: 'Alpha' }, { date: '2027-11-15' }, { date: '2026-02-31' },
      { date: '2026-09-01' }, { time: '25:00' }, { time: '' },
    ]) assert.equal((await post('/api/fixtures/manual', { ...manualArgs, ...invalid })).status, 400);
    assert.equal((await post('/api/fixtures/manual', manualArgs)).status, 409);
    const callsBeforeManualReload = providerCalls;
    await post('/api/free', { division: 'USA', season: '2026' });
    assert.equal(providerCalls, callsBeforeManualReload);
    const persisted = JSON.parse(await readFile(path.join(testDataDir, 'state.json'), 'utf8'));
    assert.equal(persisted.leagues['football-data:USA'].manualFixturesBySeason['2026'].length, 1);
    const manualList = await post('/api/list', calendarArgs);
    assert.equal(manualList.data.fixtures.length, 1);
    assert.equal(manualList.data.emptyReason, null);
    assert.equal(manualList.data.fixtures[0].analysisCutoff, '2026-10-01T00:00:00.000Z');
    assert.equal(manualList.data.fixtures[0].markets.find(item => item.id === 'goals-over-1.5').probability,
      (await post('/api/report', { ...calendarArgs, home: 'Alpha', away: 'Beta' })).data.markets.find(item => item.id === 'goals-over-1.5').probability);
    const afterKickoff = await post('/api/list', { ...calendarArgs, cutoff: '2026-12-01T00:00:00Z' });
    assert.equal(afterKickoff.data.emptyReason, 'no-upcoming');
    const removed = await post('/api/fixtures/manual/remove', { ...calendarArgs, id: added.data.fixture.id });
    assert.equal(removed.status, 200);
    assert.equal((await post('/api/list', calendarArgs)).data.emptyReason, 'calendar-empty');
    assert.equal((await post('/api/fixtures/manual/remove', { ...calendarArgs, id: added.data.fixture.id })).status, 404);

    await post('/api/key', { key: 'test-key' });
    for (const [query, name] of [['Liga holandesa', 'Eredivisie'], ['Liga de Portugal', 'Primeira Liga'], ['Champions League', 'UEFA Champions League'], ['Europa League', 'UEFA Europa League'], ['Conference League', 'UEFA Europa Conference League'], ['Copa Libertadores', 'CONMEBOL Libertadores'], ['Copa Sudamericana', 'CONMEBOL Sudamericana']]) {
      const result = await get(`/api/search?q=${encodeURIComponent(query)}`);
      assert.deepEqual(result.results.filter(league => league.sourceType === 'api').map(league => league.name), [name]);
      assert.ok(result.results.filter(league => league.sourceType === 'api').every(league => league.seasons.includes(2024)));
    }
    for (const [query, names] of [['Serie%20B%20Ecuador', ['Liga Pro Serie B']], ['Serie%20B%20Colombia', ['Primera B']], ['Liga%20Boliviana', ['Primera División']], ['Liga%20Uruguaya', ['Primera División', 'Primera División - Clausura']], ['Liga%20Peruana', ['Liga 1 Perú', 'Primera División']], ['Liga%20Chilena', ['Primera División Chile', 'Primera División']], ['Liga%20Paraguaya', ['Primera División Paraguay', 'Primera División Paraguay', 'Division Profesional - Apertura', 'Division Profesional - Clausura']]]) {
      const result = await get(`/api/search?q=${query}`);
      assert.deepEqual(result.results.map(league => league.name), names);
      assert.ok(result.results.every(league => (league.sourceType === 'free' && ['espn:PER', 'espn:CHL', 'espn:PAR1', 'openfootball:PAR'].includes(league.key)) ||
        (league.sourceType === 'api' && league.seasons.includes(2024))));
    }
    const loaded = await post('/api/load', { id: 123, season: 2026 });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.data.league.teamsBySeason['2026'].length, 2);
    assert.equal(loaded.data.league.fixtureCount, 1);
    const fixtures = await get('/api/fixtures?leagueKey=api%3A123&season=2026');
    assert.equal(fixtures.fixtures.length, 1);
    assert.equal(fixtures.fixtures[0].id, '999');
    assert.equal((await post('/api/fixtures/manual/remove', { leagueKey: 'api:123', season: 2026, id: '999' })).status, 404);

    const early = await post('/api/report', {
      leagueKey: 'api:123', season: 2026, home: 'Norte', away: 'Sur', lookback: 10,
      cutoff: '2026-09-07T00:00:00Z',
    });
    assert.equal(early.status, 200);
    assert.equal(early.data.history.home.length, 6);
    assert.equal(early.data.meta.cutoff, '2026-09-07T00:00:00.000Z');
    assert.deepEqual(detailIds.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);

    const callsBeforeList = providerCalls;
    const list = await post('/api/list', {
      leagueKey: 'api:123', season: 2026, lookback: 10,
      cutoff: '2026-10-01T00:00:00Z',
    });
    assert.equal(list.status, 200);
    assert.equal(list.data.fixtures.length, 1);
    assert.ok(list.data.fixtures[0].markets.some((market) => market.id === 'result-home'));
    const listMarkets = list.data.fixtures[0].markets;
    for (const id of ['double-chance-1x', 'double-chance-x2', 'double-chance-12', 'half-time-result-home', 'half-time-result-draw', 'half-time-result-away', 'half-time-goals-over-0.5', 'half-time-goals-under-2.5', 'handicap-european-ft--1-home', 'handicap-asian-ft--0.25-away', 'handicap-european-ht-0-draw', 'handicap-asian-ht-0-home']) {
      assert.notEqual(listMarkets.find((market) => market.id === id)?.probability, null, id);
      assert.ok(listMarkets.some((market) => market.id === id), id);
    }
    assert.equal(listMarkets.find((market) => market.id === 'half-time-corners-over-1.5').probability, null);
    assert.equal(providerCalls, callsBeforeList);

    const europe = await post('/api/europe', { division: 'E0', season: '2627' });
    assert.equal(europe.status, 200);
    assert.equal(europe.data.imported, 12);
    assert.equal(europe.data.previousImported, 12);
    assert.equal(europe.data.league.source, 'Football-Data.co.uk');
    assert.deepEqual(europe.data.league.seasons, ['2026/2027', '2025/2026']);
    assert.equal(europe.data.league.fixtureCount, 1);
    const europeFixtures = await get('/api/fixtures?leagueKey=football-data%3AE0&season=2026%2F2027');
    assert.equal(europeFixtures.fixtures.length, 1);
    assert.equal(europeFixtures.fixtures[0].home, 'Alpha');
    const europeReport = await post('/api/report', {
      leagueKey: 'football-data:E0', season: '2026/2027', home: 'Alpha', away: 'Beta',
      cutoff: '2026-10-01T00:00:00Z', lookback: 10,
    });
    assert.equal(europeReport.data.summary.home.averages.halfTimeGoals.n, 10);
    assert.notEqual(europeReport.data.markets.find((item) => item.id === 'half-time-goals-over-0.5').probability, null);
    const noNewFetch = providerCalls;
    const europeAgain = await post('/api/europe', { division: 'E0', season: '2627' });
    assert.equal(europeAgain.status, 200);
    assert.equal(providerCalls, noNewFetch);
    const championship = await post('/api/free', { division: 'E1', season: '2627' });
    assert.equal(championship.status, 200);
    assert.equal(championship.data.league.name, 'Championship');
    assert.equal(championship.data.imported, 12);
    for (const [division, name] of [['N1', 'Eredivisie'], ['P1', 'Primeira Liga']]) {
      const loaded = await post('/api/free', { division, season: '2627' });
      assert.equal(loaded.status, 200); assert.equal(loaded.data.league.name, name);
      assert.equal(loaded.data.imported, 12); assert.equal(loaded.data.previousImported, 12);
      const report = await post('/api/report', { leagueKey: `football-data:${division}`, season: '2026/2027', home: 'Alpha', away: 'Beta', cutoff: '2026-10-01', lookback: 10 });
      assert.equal(report.status, 200);
      for (const id of ['result-home', 'double-chance-1x', 'goals-over-2.5', 'corners-over-7.5', 'cards-under-3.5', 'red-cards-over-0.5', 'half-time-result-home', 'half-time-goals-over-1.5']) {
        const market = report.data.markets.find(row => row.id === id);
        assert.ok(market, id); assert.notEqual(market.probability, null, id);
      }
      assert.equal(report.data.markets.find(row => row.id === 'half-time-corners-over-1.5').probability, null);
      assert.equal(report.data.markets.find(row => row.id === 'offsides-over-1.5').probability, null);
    }
    await post('/api/key', { key: '' });
    for (const [name, alias, preset] of [
      ['Liga 1 Perú', 'Liga Peruana', 'api-preset:per'],
      ['Primera División Chile', 'Liga Chilena', 'api-preset:chl'],
      ['LigaPro Serie B Ecuador', 'Serie B de Ecuador', 'api-preset:ecu2'],
      ['Primera B Colombia', 'Serie B Colombia', 'api-preset:col2'],
      ['Primera División Bolivia', 'Liga Boliviana', 'api-preset:bol'],
      ['Primera División Uruguay', 'Liga Uruguaya', 'api-preset:uru'],
    ]) {
      const csv = await post('/api/import', { leagueName: name, season: 2026,
        csv: 'Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\n01/08/26,18:00,Alpha,Beta,1,0' });
      assert.equal(csv.status, 200);
      for (const query of [name, alias]) {
        const result = await get(`/api/search?q=${encodeURIComponent(query)}`);
        assert.equal(result.requiresKey, false);
        const saved = result.results.find(item => item.key === csv.data.league.key);
        assert.ok(saved);
        assert.equal(saved.sourceType, 'saved');
      }
      const state = await get('/api/state');
      assert.deepEqual(state.apiLeagues.find(league => league.key === preset).loadedKeys, [csv.data.league.key]);
    }
  } finally {
    globalThis.fetch = nativeFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(testDataDir);
    const safeParent = path.resolve(tmpdir()) + path.sep;
    if (!resolved.startsWith(safeParent) || !path.basename(resolved).startsWith('observatorio-test-')) {
      throw new Error('Unsafe temporary directory cleanup path');
    }
    await rm(resolved, { recursive: true, force: true });
  }
});
