import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIndividualProfile, createProfilesService } from './profiles.mjs';
import { parseTennisCsv } from './tennis.mjs';
import { buildReport, footballCountMarkets } from './model.mjs';

const football = Array.from({ length: 25 }, (_, i) => ({ id: String(i), leagueKey: 'test', season: 2026,
  date: `2026-09-${String(i + 1).padStart(2, '0')}T18:00:00Z`, home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A',
  homeGoals: 2, awayGoals: 1, stats: { home: { corners: 5, yellow: 2, red: 0, offsides: 1 }, away: { corners: 3, yellow: 1, red: 0, offsides: null } },
}));
const args = { sport: 'football', leagueKey: 'test', season: 2026, name: 'A', cutoff: '2026-10-01', matches: football };

test('individual football profiles require no rival, orient stats and limit to latest completed history', () => {
  const result = buildIndividualProfile({ ...args, matches: [...football, { ...football[0], id: 'future', date: '2026-12-01' },
    { ...football[0], id: 'pending', date: '2026-09-30', finished: false }, { ...football[0], id: 'other', leagueKey: 'other' }] });
  assert.equal(result.history.length, 10); assert.equal(result.record.wins, 5); assert.equal(result.record.losses, 5);
  assert.equal(result.summary.find(field => field.id === 'goals').average, 1.5);
  assert.equal(result.summary.find(field => field.id === 'corners').average, 4);
  assert.equal(result.summary.find(field => field.id === 'offsides').n, 5);
  assert.equal(result.summary.find(field => field.id === 'offsidesTotal').n, 0);
  assert.ok(result.history.every(row => !['future', 'pending', 'other'].includes(row.id)));
  assert.equal(buildIndividualProfile({ ...args, lookback: 20 }).history.length, 20);
  for (const lookback of [5, 15]) assert.equal(buildIndividualProfile({ ...args, lookback }).history.length, lookback);
  const home = buildIndividualProfile({ ...args, venue: 'home', lookback: 20 });
  assert.equal(home.history.length, 12); assert.equal(home.record.wins, 12);
  assert.ok(home.history.every(row => row.values.goals === 2 && row.values.goalsAgainst === 1));
});

test('profile frequencies preserve missing values and report observations rather than predictions', () => {
  const result = buildIndividualProfile({ ...args, metric: 'offsidesTotal' });
  assert.ok(result.frequencies.every(item => item.n === 0 && item.frequency === null));
  assert.equal(result.frequencies[0].probability, undefined);
  const custom = buildIndividualProfile({ ...args, metric: 'cornersTotal', line: 7.5 });
  assert.equal(custom.frequencies.find(item => item.line === 7.5 && item.direction === 'over').frequency, 100);
  assert.equal(custom.frequencies.find(item => item.line === 7.5 && item.direction === 'under').frequency, 0);
  assert.equal(buildIndividualProfile({ ...args, cutoff: '2026-01-01' }).record.played, 0);
  for (const patch of [{ metric: 'bad' }, { line: 2 }, { cutoff: 'bad' }, { venue: 'bad' }, { lookback: 35 }]) assert.throws(() => buildIndividualProfile({ ...args, ...patch }));
});

test('25 and 30 histories preserve football cutoffs and are also accepted by tennis profiles', () => {
  const matches = Array.from({ length: 40 }, (_, i) => ({ ...football[i % football.length], id: `extended-${i}`,
    date: new Date(Date.UTC(2026, 7, i + 1, 18)).toISOString() }));
  matches.push({ ...matches[0], id: 'extended-future', date: '2026-10-05T18:00:00Z' });
  for (const lookback of [25, 30]) {
    const result = buildIndividualProfile({ ...args, matches, lookback });
    assert.equal(result.meta.lookback, lookback); assert.equal(result.history.length, lookback);
    assert.ok(result.history.every(row => row.id !== 'extended-future'));
    const short = buildIndividualProfile({ ...args, lookback });
    assert.equal(short.history.length, 25);
    assert.equal(buildIndividualProfile({ ...args, sport: 'tennis', lookback }).meta.lookback, lookback);
  }
});

test('football team scenarios include every match threshold, both teams scoring, results and double chance', () => {
  const result = buildIndividualProfile(args);
  const matchReport = buildReport({ matches: football, leagueKey: 'test', season: 2026, home: 'A', away: 'B', cutoff: args.cutoff });
  const definitions = footballCountMarkets();
  for (const definition of definitions) {
    assert.ok(matchReport.markets.some(item => item.id === definition.id), definition.id);
    const scenario = result.scenarios.find(item => item.id === definition.id);
    assert.ok(scenario, definition.id); assert.equal(scenario.scope, 'total');
    assert.equal(scenario.line, definition.line); assert.equal(scenario.direction, definition.direction);
  }
  assert.equal(new Set(result.scenarios.map(item => item.id)).size, result.scenarios.length);
  const scenario = id => result.scenarios.find(item => item.id === id);
  assert.equal(scenario('result-win').probability, 50);
  assert.equal(scenario('result-draw').probability, 0);
  assert.equal(scenario('result-loss').probability, 50);
  assert.equal(scenario('btts-yes').probability, 100);
  assert.equal(scenario('btts-no').probability, 0);
  assert.ok(scenario('btts-yes').interval95.low < 100);
  for (const [id, excluded] of [['double-chance-win-draw', 'result-loss'], ['double-chance-draw-loss', 'result-win'], ['double-chance-win-loss', 'result-draw']]) {
    assert.equal(scenario(id).probability + scenario(excluded).probability, 100);
  }
  assert.equal(scenario('corners-over-7.5').probability, 100);
  assert.equal(scenario('corners-under-7.5').probability, 0);
  assert.equal(scenario('offsides-over-1.5').n, 0);
  assert.equal(scenario('offsides-over-1.5').probability, null);
  assert.equal(scenario('half-time-result-draw').n, 0);
  assert.equal(scenario('half-time-result-draw').probability, null);
  assert.ok(scenario('shots-over-19.5')); assert.ok(scenario('shots-under-19.5'));
  assert.match(result.scenarioNote, /sin ajuste por rival/);
});

test('first-half team profiles orient away appearances and separate partial periods from full-time totals', () => {
  const scores = [[2, 1, 0, 1], [1, 1, 0, 0], [3, 0, 1, 0], [0, 0, null, null], [1, 0, 1, 0]];
  const corners = [[1, 2], [1, 2], [null, 2], [null, null], [8, 0]];
  const sample = scores.map(([homeGoals, awayGoals, htHome, htAway], index) => ({
    ...football[index], home: [1, 2].includes(index) ? 'B' : 'A', away: [1, 2].includes(index) ? 'A' : 'B', homeGoals, awayGoals,
    stats: { home: { corners: 5, yellow: 2, red: 0, shots: 9, shotsOnTarget: 4, fouls: 11 }, away: { corners: 3, yellow: 1, red: 0, shots: 7, shotsOnTarget: 2, fouls: 13 } },
    halfTime: { homeGoals: htHome, awayGoals: htAway, homeCorners: corners[index][0], awayCorners: corners[index][1] },
  }));
  const result = buildIndividualProfile({ ...args, matches: sample });
  assert.deepEqual(result.record.halfTime, { played: 4, wins: 1, draws: 1, losses: 2 });
  assert.equal(result.record.wins, 2); assert.equal(result.record.draws, 2); assert.equal(result.record.losses, 1);
  const scenario = id => result.scenarios.find(item => item.id === id);
  assert.equal(scenario('btts-yes').probability, 40);
  assert.equal(scenario('half-time-result-win').probability, 25);
  assert.equal(scenario('half-time-result-draw').probability, 25);
  assert.equal(scenario('half-time-result-loss').probability, 50);
  assert.equal(scenario('half-time-goals-over-0.5').n, 4);
  assert.equal(scenario('half-time-goals-over-0.5').probability, 75);
  assert.equal(scenario('half-time-corners-over-2.5').n, 2);
  assert.equal(scenario('half-time-corners-over-2.5').probability, null);
  assert.equal(scenario('half-time-corners-over-1.5-for').n, 3);
  assert.equal(scenario('corners-over-7.5').n, 5);
  assert.equal(result.summary.find(field => field.id === 'fouls').average, 11.8);
  assert.equal(result.summary.find(field => field.id === 'foulsTotal').average, 24);
  const away = buildIndividualProfile({ ...args, matches: sample, venue: 'away' });
  assert.equal(away.record.played, 2); assert.equal(away.record.halfTime.losses, 1);
  assert.equal(away.scenarios.find(item => item.id === 'result-win').probability, null);
  const empty = buildIndividualProfile({ ...args, matches: [], cutoff: '2026-01-01' });
  assert.ok(empty.scenarios.every(item => item.n === 0 && item.probability === null && item.interval95 === null));
});

test('custom profile thresholds are scoped, validated and never alter match defaults or other leagues', () => {
  const thresholds = { cornersTotal: [6.5, 14.5, 14.5], halfTimeCorners: [.5] };
  const result = buildIndividualProfile({ ...args, thresholds });
  assert.ok(result.scenarios.some(item => item.id === 'corners-over-14.5'));
  assert.equal(result.scenarios.filter(item => item.id === 'corners-over-14.5').length, 1);
  assert.ok(!result.scenarios.some(item => item.id === 'corners-over-14.5-for'));
  assert.ok(result.scenarios.some(item => item.id === 'half-time-corners-under-0.5-for'));
  assert.ok(!footballCountMarkets().some(item => item.id === 'corners-over-14.5'));
  assert.ok(!buildIndividualProfile(args).scenarios.some(item => item.id === 'corners-over-14.5'));
  for (const invalid of [null, [], { bad: [1.5] }, { cornersTotal: [2] }, { cornersTotal: ['2.5'] }, { cornersTotal: [-.5] }, { cornersTotal: [100.5] }, { cornersTotal: Array(21).fill(2.5) }]) {
    assert.throws(() => buildIndividualProfile({ ...args, thresholds: invalid }), /límites|Límites/);
  }
  const mixed = [...football, ...football.map(row => ({ ...row, id: 'other-' + row.id, leagueKey: 'other', homeGoals: 0, awayGoals: 0 }))];
  const old = buildIndividualProfile({ ...args, matches: mixed }), other = buildIndividualProfile({ ...args, leagueKey: 'other', matches: mixed });
  assert.equal(old.scenarios.find(item => item.id === 'btts-yes').probability, 100);
  assert.equal(other.scenarios.find(item => item.id === 'btts-yes').probability, 0);
});

test('individual NBA teams exclude uncompleted and non-regular games', () => {
  const matches = Array.from({ length: 20 }, (_, i) => ({ ...football[i], season: '2025/2026', seasonType: 2, homePoints: 110, awayPoints: 100,
    stats: { home: { assists: 28 }, away: {} } }));
  const result = buildIndividualProfile({ sport: 'nba', season: '2026/2027', name: 'A', cutoff: '2026-10-01', matches: [
    ...matches, { ...matches[0], id: 'allstar', seasonType: 3 }, { ...matches[0], id: 'bad', finished: false },
  ] });
  assert.equal(result.history.length, 10); assert.equal(result.summary.find(field => field.id === 'points').average, 105);
  assert.equal(result.summary.find(field => field.id === 'pointsTotal').average, 210);
  assert.equal(result.summary.find(field => field.id === 'rebounds').n, 0);
  const strings = buildIndividualProfile({ sport: 'nba', season: '2026/2027', name: 'A', cutoff: '2026-10-01', matches: [
    { ...matches[0], homePoints: '110', awayPoints: '99' },
  ] });
  assert.equal(strings.history[0].values.pointsTotal, 209);
  assert.equal(strings.history[0].result, 'L');
});

test('one tennis player profile honors surface, category, availability and withdrawals', () => {
  const parsed = parseTennisCsv(['date,tournament,category,surface,player1,player2,winner,best_of,score,player1_aces,player2_aces',
    '2026-09-01,US Open,grand-slam,Hard,A,B,1,5,6-4 6-4 6-4,9,3',
    '2026-09-02,Wimbledon,grand-slam,Grass,B,A,1,5,6-4 6-4 6-4,10,4',
    '2026-09-03,Paris,masters-1000,Hard,A,C,1,3,6-4 RET,5,1',
  ].join('\n'), { season: 2026 });
  const result = buildIndividualProfile({ sport: 'tennis', kind: 'player', name: 'A', season: '2026', cutoff: '2026-10-01', surface: 'Hard', matches: [
    ...parsed.matches, { ...parsed.matches[0], id: 'late', availableAfter: '2026-12-01' },
  ] });
  assert.equal(result.history.length, 1); assert.equal(result.summary.find(field => field.id === 'aces').average, 9);
  assert.equal(result.summary.find(field => field.id === 'games').average, 18);
  assert.equal(result.summary.find(field => field.id === 'gamesTotal').average, 30);
  assert.equal(result.record.wins, 1);
});

test('player imports preserve team datasets, deduplicate, skip DNP and compute PRA only on complete rows', async () => {
  const store = { matches: football, playerLogs: [], sports: {} }; let saved = 0;
  const service = createProfilesService({ getStore: () => store, persist: async () => { saved++; },
    footballCatalog: () => [{ key: 'test', seasons: [2026], teams: ['A', 'B'] }],
    sportsState: () => ({ nba: { seasons: ['2026/2027'], datasets: [{ season: '2026/2027', participants: ['A', 'B'] }] } }),
    parseCsvRows: text => text.split('\n').map(row => row.split(',')), parseCsvDateTime: date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date).toISOString() : null,
    enrichFootball: async () => ({ changed: false }) });
  const body = { sport: 'nba', season: '2026/2027', csv: ['date,player,team,opponent,minutes,points,assists,rebounds,threes',
    '2026-09-01,P,A,B,35,24,5,8,3', '2026-09-02,P,A,B,30,20,,7,2',
    '2026-09-03,P,A,B,0,0,0,0,0', '2026-09-04,P,A,B,30,-1,3,2,1',
  ].join('\n') };
  const imported = await service.importPlayers(body); assert.equal(imported.imported, 2); assert.equal(imported.skipped, 2);
  assert.deepEqual(imported.catalog.players, ['P']); assert.equal(store.matches.length, 25);
  await service.importPlayers(body); assert.equal(store.playerLogs.length, 2); assert.equal(saved, 2);
  const result = await service.report({ ...body, kind: 'player', name: 'P', cutoff: '2026-10-01', metric: 'pra' });
  assert.equal(result.history.length, 2); assert.equal(result.summary.find(field => field.id === 'pra').average, 37);
  assert.equal(result.summary.find(field => field.id === 'pra').n, 1);
  assert.equal(result.history[0].values.pra, null);
  await assert.rejects(service.report({ ...body, kind: 'player', name: 'unknown', cutoff: '2026-10-01' }), /Selecciona/);
  const footballImport = await service.importPlayers({ sport: 'football', leagueKey: 'test', season: 2026,
    csv: 'date,player,team,opponent,goals,red,offsides\n2026-09-01,F,A,B,1,0,2' });
  assert.equal(footballImport.imported, 1);
  const player = await service.report({ sport: 'football', kind: 'player', name: 'F', leagueKey: 'test', season: 2026, cutoff: '2026-10-01' });
  assert.equal(player.summary.find(field => field.id === 'goals').average, 1);
  assert.equal(player.summary.find(field => field.id === 'assists').n, 0);
});
