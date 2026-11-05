import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNbaSchedule, parseNbaPlayerBoxscore, normalizeNbaPeriods, buildNbaReport } from './nba.mjs';
import { buildIndividualProfile } from './profiles.mjs';
import { createSportsService } from './sports.mjs';

const game = { id: '123', date: '2026-04-01T23:00:00.000Z', season: '2025/2026', home: 'A', away: 'B',
  homePoints: 120, awayPoints: 110, finished: true, seasonType: 2, source: 'espn-nba' };
const payload = () => ({ header: { id: '123', season: { type: 2 }, competitions: [{ date: game.date,
  status: { type: { completed: true } }, competitors: ['home', 'away'].map(side => ({ homeAway: side, team: { displayName: game[side] }, score: String(game[`${side}Points`]) })) }] },
  boxscore: { players: [{ team: { displayName: 'A' }, statistics: [{ labels: ['REB', '3PT', 'MIN', 'AST', 'PTS'], athletes: [
    { athlete: { displayName: 'P' }, stats: ['8', '3-9', '32:30', '5', '24'] },
    { athlete: { displayName: 'Missing' }, stats: ['7', '0-2', '12', '-', '0'] },
    { athlete: { displayName: 'DNP' }, didNotPlay: true, stats: ['0', '0-0', '0', '0', '0'] },
    { athlete: { displayName: 'Zero minutes' }, stats: ['0', '0-0', '0', '0', '0'] },
  ] }] }] } });

test('NBA period scores use explicit Q1/Q2 values, not final score proportions or overtime', () => {
  const parsed = parseNbaSchedule({ events: [{ id: '123', date: game.date, season: { year: 2026, type: 2 }, competitions: [{
    status: { period: 5, type: { completed: true } }, competitors: ['home', 'away'].map(side => ({ homeAway: side,
      team: { displayName: game[side] }, score: String(game[`${side}Points`]), linescores: side === 'home'
        ? [{ period: 1, value: 25 }, { period: 2, value: 30 }, { period: 3, value: 26 }, { period: 4, value: 29 }, { period: 5, value: 10 }]
        : [{ period: 1, value: 28 }] })) }] }] });
  assert.equal(parsed.matches[0].stats.home.firstQuarterPoints, 25);
  assert.equal(parsed.matches[0].stats.home.halfTimePoints, 55);
  assert.equal(parsed.matches[0].stats.away.halfTimePoints, null);
  assert.equal(parsed.matches[0].overtime, true);
  assert.deepEqual(normalizeNbaPeriods({ firstQuarterPoints: -2, halfTimePoints: 130 }, 120), { firstQuarterPoints: null, halfTimePoints: null });
  assert.equal(normalizeNbaPeriods({ firstQuarterPoints: 30, halfTimePoints: 29 }, 120).halfTimePoints, null);
  const individual = buildIndividualProfile({ sport: 'nba', name: 'A', season: game.season, cutoff: '2026-05-01', matches: parsed.matches,
    metric: 'halfTimePoints', lookback: 5 });
  assert.equal(individual.summary.find(field => field.id === 'halfTimePoints').average, 55);
  assert.equal(individual.summary.find(field => field.id === 'halfTimePointsTotal').n, 0);
  const away = buildIndividualProfile({ sport: 'nba', name: 'B', season: game.season, cutoff: '2026-05-01', matches: parsed.matches });
  assert.equal(away.history[0].values.firstQuarterPoints, 28);
  assert.equal(away.history[0].values.firstQuarterPointsAgainst, 25);
  assert.equal(away.history[0].values.firstQuarterPointsTotal, 53);
});

test('player box scores use labels, made threes and complete PRA; DNP is not zero', () => {
  const records = parseNbaPlayerBoxscore(payload(), game);
  assert.equal(records.length, 2); assert.equal(records[0].minutes, 32.5);
  assert.deepEqual(records[0].values, { points: 24, rebounds: 8, assists: 5, threes: 3, pra: 37 });
  assert.equal(records[1].values.points, 0); assert.equal(records[1].values.assists, null); assert.equal(records[1].values.pra, null);
  assert.throws(() => parseNbaPlayerBoxscore(payload(), { ...game, id: '456' }), /corresponde/);
  const unfinished = payload(); unfinished.header.competitions[0].status.type.completed = false;
  assert.throws(() => parseNbaPlayerBoxscore(unfinished, game), /corresponde/);
});

test('5 and 15 histories are not silently changed to 10 in NBA or individual players', () => {
  const matches = Array.from({ length: 25 }, (_, index) => ({ ...game, id: String(index), date: `2026-04-${String(index + 1).padStart(2, '0')}T23:00:00Z` }));
  const playerLogs = matches.map(match => ({ ...parseNbaPlayerBoxscore(payload(), game)[0], id: `p-${match.id}`, date: match.date }));
  playerLogs.push({ ...playerLogs[0], id: 'trade', date: '2026-04-30T23:00Z', team: 'C', values: { points: 200 } });
  for (const lookback of [5, 15]) {
    const report = buildNbaReport({ matches, season: game.season, home: 'A', away: 'B', cutoff: '2026-05-01', lookback });
    assert.equal(report.history.home.length, lookback);
    const profile = buildIndividualProfile({ sport: 'nba', kind: 'player', name: 'P', playerTeam: 'A', season: game.season,
      cutoff: '2026-05-01', playerLogs, lookback });
    assert.equal(profile.history.length, lookback); assert.equal(profile.summary[0].average, 24);
    assert.ok(profile.history.every(row => row.team === 'A'));
  }
});

test('bounded NBA box-score loading caches, preserves CSV corrections, and survives partial errors', async () => {
  const records = parseNbaPlayerBoxscore(payload(), game);
  const store = { sports: { nba: { datasets: { [game.season]: { matches: [game, { ...game, id: '456', date: '2026-04-02T23:00Z' },
    { ...game, id: 'future', date: '2029-01-01' }], fixtures: [] } }, manual: {} } }, playerLogs: [{ ...records[0], source: 'CSV personal', values: { points: 30 } }] };
  let saved = 0; let calls = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => { calls++; if (new URL(input).searchParams.get('event') === '456') return new Response('Unavailable', { status: 503 }); return Response.json(payload()); };
  try {
    const service = createSportsService({ getStore: () => store, persist: async () => { saved++; } });
    const body = { sport: 'nba', season: game.season, team: 'A', cutoff: '2026-05-01', lookback: 5 };
    const result = await service.loadNbaPlayers(body);
    assert.equal(result.games, 2); assert.equal(result.available, 1); assert.equal(saved, 1); assert.match(result.warning, /1 partidos/);
    assert.equal(store.playerLogs.find(row => row.name === 'P').values.points, 30);
    assert.equal(store.sports.nba.datasets[game.season].matches.length, 3);
    await service.loadNbaPlayers(body); assert.equal(calls, 3); assert.equal(store.playerLogs.length, 2);
    await assert.rejects(service.loadNbaPlayers({ ...body, cutoff: '2026-03-01' }), /No hay partidos/);
    await assert.rejects(service.loadNbaPlayers({ ...body, lookback: 100 }), /5, 10, 15, 20, 25 o 30/);
  } finally { globalThis.fetch = originalFetch; }
});

test('daily NBA player batches are capped at four, refresh recent corrections and preserve personal values', async () => {
  const originalFetch=globalThis.fetch,season='2026/2027';let calls=0,points=24;
  const recent=Array.from({length:6},(_,i)=>({...game,id:String(200+i),season,date:new Date(Date.now()-(20+i)*3600000).toISOString()}));
  const store={sports:{nba:{datasets:{[season]:{matches:recent,fixtures:[]}},manual:{}}},playerLogs:[]};
  const service=createSportsService({getStore:()=>store,persist:async()=>{}});
  globalThis.fetch=async url=>{calls++;const id=new URL(url).searchParams.get('event'),match=recent.find(g=>g.id===id),value=payload();value.header.id=id;value.header.competitions[0].date=match.date;value.boxscore.players[0].statistics[0].athletes[0].stats[4]=String(points);return new Response(JSON.stringify(value));};
  try{
    let result=await service.loadNbaDailyPlayers({season});assert.equal(calls,4);assert.equal(result.pending,2);
    result=await service.loadNbaDailyPlayers({season});assert.equal(calls,6);assert.equal(result.pending,0);await service.loadNbaDailyPlayers({season});assert.equal(calls,6);
    const personal=store.playerLogs.find(row=>row.eventId==='200'&&row.name==='P');personal.source='CSV personal';personal.values.points=99;
    store.nbaPlayerChecks['200']='2020-01-01T00:00:00Z';store.nbaPlayerChecks['201']='2020-01-01T00:00:00Z';points=31;
    result=await service.loadNbaDailyPlayers({season});assert.equal(calls,8);assert.equal(store.playerLogs.find(row=>row.id===personal.id).values.points,99);assert.equal(store.playerLogs.find(row=>row.eventId==='201'&&row.name==='P').values.points,31);assert.equal(result.pending,0);
  }finally{globalThis.fetch=originalFetch;}
});
