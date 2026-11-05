import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDataBackups, frozenTrialHash } from './data-backups.mjs';
import { buildDataCoverage, dataIntegrity } from './data-coverage.mjs';
import { planDataJobs, createDataControl } from './data-control.mjs';
import { createDataContext } from './data-context.mjs';

const now = () => new Date('2026-10-16T17:00:00Z');
const empty = () => ({ version: 1, leagues: {}, matches: [], basketball: { trial: { protocol: { lookback: 20 }, snapshots: [] }, inputs: {}, evaluations: {} } });
test('compressed backups verify, restore and preserve the frozen trial', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'data-backup-')); let store = empty();
  const backups = createDataBackups({ directory, getStore: () => store, replaceStore: value => { store = value; }, persist: async () => {}, now });
  try {
    store.footballQuota = { day: '2026-10-16', used: 1, detailUsed: 1, remaining: 99 };
    store.footystatsResearch = { requestUsage: { day: '2026-10-16', used: 1, quota: { limit: 1800, remaining: 1799, resetAt: 1792173600 } } };
    const saved = await backups.create(); assert.equal((await backups.verify(saved.id)).valid, true);
    store.footballQuota.used = 9; store.footballQuota.detailUsed = 5; store.footballQuota.remaining = 91;
    store.footystatsResearch.requestUsage.used = 9; store.footystatsResearch.requestUsage.quota.remaining = 1791;
    store.basketball.trial.lastRun = '2026-10-16T16:00:00Z';
    store.matches.push({ id: 1 });
    await assert.rejects(backups.restore(saved.id, ''), /Confirma/);
    const restored = await backups.restore(saved.id, 'RESTAURAR'); assert.ok(restored.safetyBackup); assert.equal(store.matches.length, 0);
    assert.equal(store.footballQuota.used, 9); assert.equal(store.footballQuota.detailUsed, 5); assert.equal(store.footballQuota.remaining, 91);
    assert.equal(store.footystatsResearch.requestUsage.used, 9); assert.equal(store.footystatsResearch.requestUsage.quota.remaining, 1791);
    assert.equal(store.basketball.trial.lastRun, '2026-10-16T16:00:00Z');
    store.basketball.trial.snapshots.push({ id: 'new-forecast' });
    await assert.rejects(backups.restore(saved.id, 'RESTAURAR'), /congelada/);
    assert.equal(store.basketball.trial.snapshots.length, 1);
    await assert.rejects(backups.verify('../state'), /Identificador/);
    await writeFile(path.join(directory, `${saved.id}.json.gz`), 'broken');
    await assert.rejects(backups.verify(saved.id), /no valido/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('coverage counts zero as observed, null as missing and season aggregates are not individual logs', () => {
  const store = empty(); store.leagues.test = { key: 'test', name: 'League', seasons: ['2026'], source: 'FootyStats' };
  store.matches.push({ id: '1', leagueKey: 'test', season: '2026', date: '2026-10-14', home: 'A', away: 'B', homeGoals: 0, awayGoals: 0, halfTime: { homeGoals: 0, awayGoals: 0 }, stats: { home: { offsides: 0 }, away: { offsides: null } } });
  store.footystatsResearch = { datasets: { sample: { leagueKey: 'test', season: '2026', playerCount: 50 } } };
  const row = buildDataCoverage(store, { games: [], players: [] }, now()).find(row => row.key === 'test');
  assert.equal(row.fields.find(field => field.id === 'goals').n, 1);
  assert.equal(row.fields.find(field => field.id === 'offsides').n, 0);
  assert.equal(row.records, 0); assert.equal(row.seasonAggregates, 50);
  assert.equal(dataIntegrity(store).footballDuplicates, 0);
});
test('planner gives basketball precedence, no disconnected paid calls, and preserves native football seasons', () => {
  const store = empty(); store.leagues.mls = { key: 'football-data:USA', source: 'Football-Data.co.uk', name: 'MLS', seasons: [2026] };
  const free = planDataJobs(store, {}, now());
  assert.ok(free.some(job => job.kind === 'nba-free')); assert.equal(free.some(job => job.kind === 'basketball-calendar'), false);
  assert.equal(free.find(job => job.kind === 'football-free').params.season, '2026');
  const paid = planDataJobs(store, { basketballConnected: true, paid: true }, now());
  assert.deepEqual(paid.filter(job => job.kind === 'basketball-calendar').map(job => job.params.league), ['nba', 'euroleague', 'endesa']);
  assert.ok(paid.find(job => job.kind === 'basketball-calendar').priority > paid.find(job => job.kind === 'football-free').priority);
});
test('coverage keeps separate ESPN event appearances instead of collapsing all games of one player', () => {
  const store = empty(), games = [1, 2].map(id => ({ id: String(id), league: 'nba', season: '2025/2026', date: `2026-04-0${id}T18:00:00Z`, home: 'A', away: 'B', finished: true, homePoints: 100, awayPoints: 90 }));
  const players = games.map(game => ({ id: `log:${game.id}`, eventId: game.id, league: 'nba', season: game.season, date: game.date, team: 'A', name: 'Player', minutes: 20, source: 'ESPN box score', values: { points: 10 } }));
  const row = buildDataCoverage(store, { games, players }, now()).find(row => row.key === 'nba' && row.season === '2025/2026');
  assert.equal(row.records, 2); assert.equal(row.teams.find(team => team.team === 'A').playerGames, 2);
});
test('queue resumes, backs off restricted jobs, avoids overlaps and does not change forecasts', async () => {
  let store = empty(), date = now(), calls = 0; const before = frozenTrialHash(store);
  const handlers = { 'basketball-access': async () => ({}), 'basketball-calendar': async () => { calls++; throw Object.assign(Error('Temporada bloqueada'), { status: 403 }); }, 'basketball-details': async () => ({ pending: 3, completed: 2 }), 'nba-free': async () => ({ imported: 2 }), 'tennis-free': async () => ({ imported: 1 }) };
  const options = { getStore: () => store, persist: async () => {}, connections: () => ({ basketballConnected: true }), policies: () => ({ basketball: { paid: false } }), basketballData: () => ({ games: [], players: [] }), handlers, backups: { ensure: async () => {}, list: async () => [] }, now: () => date };
  const service = createDataControl(options);
  await service.cycle(); assert.equal(calls, 2);
  const saved = await service.state(); assert.equal(saved.jobs.filter(job => job.status === 'blocked').length, 2);
  await service.cycle(); assert.equal(calls, 3);
  await service.cycle(); assert.equal(calls, 3);
  assert.equal(frozenTrialHash(store), before);
  await assert.rejects(service.settings({ automatic: { basketball: false }, budgets: { basketball: 8000 } }), /presupuesto/);
  assert.equal((await service.state()).automatic.basketball, true);
  await service.settings({ automatic: { basketball: false, tennis: false } });
  date = new Date(date.getTime() + 2 * 86400000); await service.cycle({ automatic: true }); assert.equal(calls, 3);
});
test('context is sourced, expires, uses native identities and does not infer current roster', async () => {
  const store = empty(); store.matches = [{ leagueKey: 'api:1', season: 2026, home: 'A', away: 'B' }];
  store.playerLogs = [{ sport: 'football', leagueKey: 'api:1', season: 2026, team: 'A', playerKey: 'api:42', name: 'Player' }];
  let date = now(); const service = createDataContext({ getStore: () => store, persist: async () => {}, basketballData: () => ({ games: [], players: [] }), now: () => date });
  const body = { sport: 'football', key: 'api:1', season: '2026', team: 'A', playerKey: 'api:42', status: 'questionable', sourceUrl: 'https://example.org/report', publishedAt: '2026-10-16T16:00:00Z', expiresAt: '2026-10-17T16:00:00Z' };
  await service.save(body); assert.equal(service.current()[0].expired, false);
  await assert.rejects(service.save({ ...body, playerKey: 'other' }), /Jugador/);
  await assert.rejects(service.save({ ...body, sourceUrl: 'http://localhost' }), /HTTPS/);
  await assert.rejects(service.save({ ...body, publishedAt: '2026-10-17T16:00:00Z' }), /futura/);
  date = new Date('2026-10-18T16:00:00Z'); assert.equal(service.current()[0].expired, true);
});

test('expanded queues resume partial work every five minutes, preserve counters, and never repeat an access denial without reconnection', async () => {
  const store = empty(); let date = now(), details = 0, denied = 0;
  store.basketball.quota = { day: '2026-10-16', used: 37, detailUsed: 24 };
  const frozen = frozenTrialHash(store);
  const service = createDataControl({ getStore: () => store, persist: async () => {}, now: () => date,
    connections: () => ({ basketballConnected: true }), policies: () => ({ basketball: { paid: false } }), basketballData: () => ({ games: [], players: [] }),
    backups: { ensure: async () => {}, list: async () => [] },
    handlers: { 'basketball-access': async () => ({}), 'basketball-calendar': async () => { denied++; throw Object.assign(Error('Acceso restringido'), { status: 403 }); },
      'basketball-details': async () => { details++; return { completed: 2, pending: 10 }; }, 'nba-free': async () => ({}), 'tennis-free': async () => ({}) } });
  await service.settings({ maximizeFree: { basketball: true, football: true } });
  await service.cycle({ maxJobs: 8 });
  await service.cycle({ maxJobs: 8 });
  assert.equal(details, 3); assert.equal(denied, 3);
  const partial = store.dataControl.jobs.filter(row => row.status === 'partial');
  assert.equal(partial.length, 3); assert.ok(partial.every(row => row.nextAt === '2026-10-16T17:05:00.000Z'));
  assert.equal(store.basketball.quota.used, 37); assert.equal(store.basketball.quota.detailUsed, 24);
  date = new Date('2026-10-18T17:00:00Z'); await service.cycle({ maxJobs: 8 }); assert.equal(denied, 3);
  await service.reconnect('basketball'); await service.cycle({ maxJobs: 8 }); assert.equal(denied, 6);
  await service.settings({ budgets: { basketball: 100 } }); assert.equal(store.dataControl.budgets.basketball.maximizeFree, true);
  await assert.rejects(service.settings({ maximizeFree: { football: 'yes' } }), /verdadero/);
  assert.equal(frozenTrialHash(store), frozen);
});
