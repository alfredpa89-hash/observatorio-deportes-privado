import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataControl } from './data-control.mjs';
import { frozenTrialHash } from './data-backups.mjs';
import { createSportsService } from './sports.mjs';
import { currentCutoff, onDataRefresh } from './public/live-refresh.js';

const settle = async service => {
  for (let i = 0; i < 100 && service.running(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.running(), false); return service.progress();
};
function setup({ connected = false, handler = async () => ({ imported: 1 }) } = {}) {
  let time = new Date('2026-10-19T15:00:00Z'); const calls = [];
  const store = { version: 1, matches: [], leagues: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`test${i}`, { key: `football-data:${['E0', 'E1', 'SP1', 'D1', 'I1', 'F1', 'N1', 'P1', 'USA', 'MEX'][i]}`, name: `League ${i}`, source: 'Football-Data.co.uk', seasons: i === 8 ? [2026] : ['2026/2027'] }])),
    basketball: { trial: { protocol: { lookback: 20 }, snapshots: [] }, inputs: {}, evaluations: {} } };
  const handlers = Object.fromEntries(['basketball-access', 'basketball-calendar', 'basketball-details', 'nba-free', 'nba-official', 'nba-free-players', 'tennis-free', 'football-free'].map(kind => [kind, async params => { calls.push({ kind, params }); return handler(kind, params); }]));
  const options = { getStore: () => store, persist: async () => {}, connections: () => ({ basketballConnected: connected }), policies: () => ({ basketball: { paid: false } }), basketballData: () => ({ games: [], players: [] }), handlers, backups: { ensure: async () => {}, list: async () => [] }, now: () => time };
  return { service: createDataControl(options), options, store, calls, advance: minutes => { time = new Date(time.getTime() + minutes * 60000); } };
}
test('opening the app drains all available source checks, not only the first four, and repeated F5 is cached', async () => {
  const { service, calls, store, advance } = setup(), frozen = frozenTrialHash(store);
  assert.equal((await service.visit()).phase, 'updating'); const first = await settle(service);
  assert.equal(first.processed, 14); assert.equal(first.total, 14); assert.equal(calls.length, 14);
  assert.equal(first.phase, 'checked'); assert.ok(first.missing.some(text => text.includes('Endesa')));
  assert.equal(calls.every(call => call.params.freshness === true), true);
  await service.visit(); await settle(service); assert.equal(calls.length, 14);
  advance(16); await service.visit(); await settle(service); assert.equal(calls.length, 28);
  assert.equal(frozenTrialHash(store), frozen);
});
test('free access restrictions stay visible and F5 never retries a blocked season or invents a current archive', async () => {
  const { service, calls, advance } = setup({ connected: true, handler: async kind => {
    if (kind === 'basketball-calendar') throw Object.assign(Error('Free plan no permite esta temporada'), { status: 403 });
    return {};
  } });
  await service.visit(); const result = await settle(service);
  assert.equal(result.issues.filter(issue => issue.message.includes('Free plan')).length, 3);
  const count = calls.filter(call => call.kind === 'basketball-calendar').length;
  advance(16); await service.visit(); await settle(service);
  assert.equal(calls.filter(call => call.kind === 'basketball-calendar').length, count);
  assert.equal(service.progress().issues.some(issue => issue.message.includes('Free plan')), true);
});
test('failed refresh retaining a saved dataset is partial, never a new successful freshness timestamp', async () => {
  const { service, store } = setup({ handler: async kind => kind === 'tennis-free' ? { warning: 'No se pudo conectar; se conserva lo guardado.' } : {} });
  await service.visit(); const result = await settle(service);
  const task = store.dataControl.jobs.find(job => job.kind === 'tennis-free');
  assert.equal(task.status, 'retry'); assert.equal(task.freshAt, undefined);
  assert.ok(result.issues.some(issue => issue.task.includes('ATP')));
});

test('reconnecting a credential rechecks its access even when the previous visit was recent', async () => {
  const { service, calls, store } = setup({ connected: true });
  await service.visit(); await settle(service);
  assert.equal(calls.filter(call => call.kind === 'basketball-access').length, 1);
  await service.reconnect('basketball');
  assert.equal(store.dataControl.jobs.find(job => job.kind === 'basketball-access').freshAt, null);
  await service.visit(); await settle(service);
  assert.equal(calls.filter(call => call.kind === 'basketball-access').length, 2);
});
test('interrupted visits restart and disabled sports are explicitly skipped without contacting providers', async () => {
  const { service, store, calls, options } = setup();
  await service.settings({ automatic: { basketball: false, football: false, tennis: false } });
  store.dataControl.visit = { phase: 'updating', requestedAt: '2026-10-18T10:00:00Z', jobIds: [], processedIds: [] };
  const resumed = createDataControl(options); assert.equal(resumed.progress().phase, 'interrupted');
  await resumed.visit(); const result = await settle(resumed);
  assert.equal(result.total, 0); assert.equal(result.disabledSports.length, 3); assert.equal(calls.length, 0);
});
test('current cutoffs follow Guayaquil including date rollover, while deliberate historical cutoffs remain fixed', () => {
  const monday = new Date('2026-10-19T15:42:15Z');
  assert.equal(currentCutoff('datetime-local', '', false, monday), '2026-10-19T10:42');
  assert.equal(currentCutoff('date', '', false, new Date('2026-10-20T03:00:00Z')), '2026-10-19');
  assert.equal(currentCutoff('datetime-local', '2025-01-01T12:00', true, monday), '2025-01-01T12:00');
});
test('refresh notifications coalesce and wait until the current user action is finished', async () => {
  const oldDocument = globalThis.document, oldInterval = globalThis.setInterval;
  const eventTarget = new EventTarget(); let tick, ready = false, calls = 0;
  globalThis.document = eventTarget; globalThis.setInterval = action => { tick = action; return 0; };
  try {
    onDataRefresh('basketball', () => ready, async () => { calls++; });
    for (let i = 0; i < 3; i++) eventTarget.dispatchEvent(new CustomEvent('observatorio:refreshed', { detail: { sports: ['basketball'] } }));
    await tick(); assert.equal(calls, 0);
    ready = true; await tick(); assert.equal(calls, 1); await tick(); assert.equal(calls, 1);
    eventTarget.dispatchEvent(new CustomEvent('observatorio:refreshed', { detail: { sports: ['tennis'] } })); await tick(); assert.equal(calls, 1);
  } finally { globalThis.document = oldDocument; globalThis.setInterval = oldInterval; }
});
test('visit freshness checks a four-hour-old tennis file again but caches repeated visits within fifteen minutes', async () => {
  const original = globalThis.fetch; let calls = 0;
  const store = { sports: { tennis: { datasets: Object.fromEntries(['2026', '2025'].map(season => [season, { source: 'TennisMyLife', parserVersion: 2, loadedAt: new Date(Date.now() - (season === '2026' ? 4 * 3600000 : 0)).toISOString(), matches: [] }])) } } };
  store.sports.tennis.manual = {};
  const service = createSportsService({ getStore: () => store, persist: async () => {}, parseCsvRows: () => [], parseCsvDateTime: () => null });
  globalThis.fetch = async () => { calls++; return new Response('tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of\n2026-1,Rotterdam,Hard,500,20260209,1,1,Alpha,2,Beta,6-4 6-4,3'); };
  try {
    await service.load({ sport: 'tennis', season: '2026' }); assert.equal(calls, 0);
    await service.load({ sport: 'tennis', season: '2026', freshness: true }); assert.equal(calls, 1);
    assert.equal(store.sports.tennis.datasets['2026'].matches.length, 1);
    await service.load({ sport: 'tennis', season: '2026', freshness: true }); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
