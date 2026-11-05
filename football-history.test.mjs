import test from 'node:test';
import assert from 'node:assert/strict';
import { combineFootballHistory, footballSeasonAggregates } from './football-history.mjs';
import { buildIndividualProfile } from './profiles.mjs';
import { createFootballPlayersService } from './football-players.mjs';

const league = (key, name, country, seasons, teams) => ({ key, name, country, seasons, source: key.startsWith('api:') ? 'api-football' : 'football-data.co.uk',
  teamsBySeason: Object.fromEntries(seasons.map(season => [season, teams])), fixturesBySeason: {}, coverageBySeason: {} });
const match = (leagueKey, id, season, date, home, away, overrides = {}) => ({ leagueKey, id, season, date, home, away,
  status: 'FT', homeGoals: 2, awayGoals: 1, source: leagueKey.startsWith('api:') ? 'API-Football' : 'football-data.co.uk',
  halfTime: { homeGoals: 1, awayGoals: 0, homeCorners: null, awayCorners: null }, stats: { home: { corners: null, red: 0 }, away: { corners: null, red: 0 } }, ...overrides });
function sample() {
  return { leagues: {
    'football-data:E0': league('football-data:E0', 'Premier League', 'England', ['2024/2025', '2025/2026'], ['Man United', 'Arsenal']),
    'api:39': league('api:39', 'Premier League', 'England', [2024], ['Manchester United', 'Arsenal']),
    'api:71': league('api:71', 'Serie A', 'Brazil', [2024], ['Botafogo', 'Flamengo']),
    'api:135': league('api:135', 'Serie A', 'Italy', [2024], ['Inter', 'Milan']),
  }, matches: [match('football-data:E0', 'csv1', '2024/2025', '2024-10-01T19:00:00Z', 'Man United', 'Arsenal',
    { stats: { home: { corners: 7, red: 0 }, away: { corners: 3, red: 0 } } }),
    match('api:39', '101', 2024, '2024-10-01T19:00:00Z', 'Manchester United', 'Arsenal'),
    match('football-data:E0', 'csv2', '2025/2026', '2025-10-01T19:00:00Z', 'Man United', 'Arsenal')], playerLogs: [] };
}
const premier = 'competition:england:premier-league';
function addFooty(store, overrides = {}) {
  store.leagues['footystats:premier'] = { ...league('footystats:premier', 'Premier League', 'England', ['2024/2025'], ['Manchester United', 'Arsenal']), source: 'FootyStats' };
  store.matches.push(match('footystats:premier', 'footystats:7', '2024/2025', '2024-10-01T19:00:00Z', 'Manchester United', 'Arsenal', {
    source: 'FootyStats', stats: { home: { corners: 9, red: 1, offsides: 2 }, away: { corners: 3, red: 0, offsides: 1 } },
    halfTime: { homeGoals: 1, awayGoals: 0, homeCorners: 2, awayCorners: 1 }, ...overrides }));
}

test('API-Football and FootyStats complement missing fields once, retain native IDs and never replace observed zero', () => {
  const store = sample(); addFooty(store); const before = structuredClone(store);
  const view = combineFootballHistory(store), row = view.matches.find(row => row.season === '2024/2025');
  assert.equal(view.matches.length, 2); assert.equal(row.sourceRefs.length, 3);
  assert.equal(row.stats.home.corners, 9); assert.equal(row.stats.home.red, 0); assert.equal(row.stats.home.offsides, 2);
  assert.equal(row.halfTime.homeCorners, 2); assert.equal(row.fieldSources['halfTime.homeCorners'].source, 'FootyStats');
  assert.equal(row.fieldSources.homeGoals.leagueKey, 'api:39'); assert.equal(row.fieldSources['stats.home.red'].id, '101');
  assert.equal(row.fieldSources['stats.home.corners'].id, 'footystats:7');
  assert.ok(row.fieldConflicts.some(conflict => conflict.field === 'stats.home.red')); assert.match(row.integrityWarning, /sin promediar/);
  assert.equal(view.leagues[premier].supplemented, 1); assert.deepEqual(store, before);
});

test('wrong FootyStats season, kickoff, score or extra-time status cannot fill an API fixture', () => {
  for (const overrides of [{ awayGoals: 0 }, { date: '2024-10-01T20:00:00Z' }, { timeKnown: false }, { status: 'AET' }]) {
    const store = sample(); store.matches = [store.matches[1]]; addFooty(store, overrides);
    const view = combineFootballHistory(store), row = view.matches.find(row => row.sourceRefs.some(ref => ref.leagueKey === 'api:39'));
    assert.equal(row.stats.home.corners, null); assert.equal(row.halfTime.homeCorners, null); assert.ok(row.integrityWarning);
  }
  const store = sample(); addFooty(store, { season: '2023/2024' });
  assert.equal(combineFootballHistory(store).matches.find(row => row.season === '2024/2025').halfTime.homeCorners, null);
});

test('mixed halftime anchors and impossible cross-provider shot/corner pairs remain missing', () => {
  const store = sample(); store.matches = [store.matches[1]];
  store.matches[0].stats = { home: { shotsOnTarget: 6, corners: 1 }, away: {} };
  store.matches[0].halfTime = { homeGoals: 0, awayGoals: null };
  addFooty(store, { stats: { home: { shots: 4, corners: 9 }, away: { corners: 3 } } });
  const row = combineFootballHistory(store).matches[0];
  assert.equal(row.halfTime.awayGoals, null); assert.equal(row.halfTime.homeCorners, undefined);
  assert.equal(row.stats.home.shots, null); assert.equal(row.stats.home.shotsOnTarget, 6); assert.equal(row.stats.home.corners, 1);
});

test('season player aggregates are accessible beside game logs, but never become player appearances or historical inputs', () => {
  const store = sample(); addFooty(store);
  store.footystatsResearch = { datasets: { a: { leagueKey: 'footystats:premier', season: '2024/2025', scope: 'season-aggregates', downloadedAt: '2026-10-17T12:00:00Z',
    players: [{ id: 9, name: 'Season player', team: 'Manchester United', goals: 20, appearances: 38 }] } } };
  const view = combineFootballHistory(store), before = structuredClone(store);
  assert.equal(footballSeasonAggregates(store, view.leagues[premier], { season: '2024/2025', team: 'Man United', cutoff: '2026-10-17T13:00:00Z' })[0].players[0].goals, 20);
  assert.equal(footballSeasonAggregates(store, view.leagues[premier], { season: '2024/2025', cutoff: '2025-01-01T00:00:00Z' }).length, 0);
  assert.equal(view.playerLogs.length, 0); assert.deepEqual(store, before);
});

test('competition view joins source seasons and explicit club names without mutating raw archives', () => {
  const store = sample(), before = structuredClone(store), view = combineFootballHistory(store, '2026-10-13T20:00:00Z');
  assert.equal(Object.keys(view.leagues).length, 3);
  assert.deepEqual(view.leagues[premier].seasons, ['2025/2026', '2024/2025']);
  assert.deepEqual(view.leagues[premier].teamsBySeason['2024/2025'], ['Arsenal', 'Man United']);
  assert.equal(view.matches.length, 2);
  assert.equal(view.leagues[premier].duplicateCount, 1);
  const row = view.matches.find(row => row.season === '2024/2025');
  assert.equal(row.stats.home.corners, 7); assert.equal(row.stats.home.red, 0);
  assert.equal(row.halfTime.homeCorners, null);
  assert.equal(row.sourceRefs.length, 2);
  assert.equal(row.sourceRefs[0].id, '101');
  assert.deepEqual(store, before);
  const profile = buildIndividualProfile({ sport: 'football', name: 'Man United', leagueKey: premier, season: '2025/2026',
    cutoff: '2025-09-30T23:59:59Z', matches: view.matches });
  assert.equal(profile.history.length, 1);
  assert.equal(profile.history[0].season, '2024/2025');
  assert.notEqual(view.leagues['competition:brazil:brasileirao-serie-a'].key, view.leagues['competition:italy:serie-a'].key);
});

test('disagreeing scores keep preferred source and do not borrow missing statistics', () => {
  const store = sample(); store.matches[1].awayGoals = 0;
  const view = combineFootballHistory(store);
  const row = view.matches.find(row => row.season === '2024/2025');
  assert.equal(row.awayGoals, 0); assert.equal(row.stats.home.corners, null);
  assert.ok(row.integrityWarning); assert.equal(view.leagues[premier].conflicts, 1);
});

test('ambiguous same-day identities are retained and flagged rather than arbitrarily spliced', () => {
  const store = sample(); store.matches.push({ ...store.matches[0], id: 'csv3', date: '2024-10-01T20:00:00Z' });
  const view = combineFootballHistory(store);
  assert.equal(view.matches.length, 4); assert.equal(view.leagues[premier].conflicts, 1);
});

test('player logs follow the combined league while loading stays on native provider identities', async () => {
  const store = sample();
  store.playerLogs = [{ id: 'log1', sport: 'football', leagueKey: 'api:39', season: 2024, fixtureId: '101', playerKey: 'api:7',
    playerId: 7, name: 'Jugador', team: 'Manchester United', opponent: 'Arsenal', date: '2024-10-01T19:00:00Z', minutes: 90, values: { goals: 1 }, source: 'API-Football' }];
  const service = createFootballPlayersService({ getStore: () => store, getReadStore: () => combineFootballHistory(store),
    resolveLoad: body => ({ ...body, leagueKey: 'api:39', season: 2024, team: 'Manchester United' }),
    persist: async () => {}, request: async (endpoint, params) => {
      assert.equal(params.id, '101');
      return [{ fixture: { id: 101, status: { short: 'FT' }, date: '2024-10-01T19:00:00Z' }, league: { id: 39, season: 2024 },
        teams: { home: { id: 1, name: 'Manchester United' }, away: { id: 2, name: 'Arsenal' } }, players: [] }];
    }, connected: () => true, getQuota: () => null });
  const state = service.state(), competition = state.catalog.find(league => league.key === premier);
  assert.equal(competition.seasonsInfo['2024/2025'].records, 1);
  assert.equal(competition.seasonsInfo['2024/2025'].teamCoverage['Man United'].games, 1);
  assert.equal(competition.seasonsInfo['2024/2025'].apiLoadable, true);
  assert.equal(competition.seasonsInfo['2025/2026'].apiLoadable, false);
  const directory = service.directory({ leagueKey: premier, season: '2024/2025', team: 'Man United', window: 'season', cutoff: '2026-10-01T00:00:00Z' });
  assert.equal(directory.records, 1); assert.equal(directory.players[0].team, 'Man United');
  const loaded = await service.load({ leagueKey: premier, season: '2024/2025', team: 'Man United', cutoff: '2026-10-01T00:00:00Z', maxGames: 1 });
  assert.equal(loaded.scope, 'team');
  assert.ok(store.footballPlayerLoads['api:39:2024:101']);
  assert.equal(store.playerLogs[0].team, 'Manchester United');
});

test('completed results suppress stale calendars, but unrelated clubs and competitions stay separate', () => {
  const store = sample();
  store.leagues['football-data:E0'].fixturesBySeason['2024/2025'] = [{ leagueKey: 'football-data:E0', id: 'calendar1', season: '2024/2025', date: '2024-10-01T19:00:00Z', home: 'Man United', away: 'Arsenal', status: 'NS' }];
  store.leagues['api:39'].fixturesBySeason[2024] = [{ leagueKey: 'api:39', id: 'next', season: 2024, date: '2024-10-02T19:00:00Z', home: 'Manchester United', away: 'Arsenal', status: 'NS' }];
  const view = combineFootballHistory(store);
  assert.equal(view.leagues[premier].fixturesBySeason['2024/2025'].length, 1);
  assert.equal(view.leagues[premier].fixturesBySeason['2024/2025'][0].home, 'Man United');
  assert.deepEqual(view.leagues['competition:italy:serie-a'].seasons, ['2024/2025']);
  assert.deepEqual(view.leagues['competition:brazil:brasileirao-serie-a'].seasons, ['2024']);
});
