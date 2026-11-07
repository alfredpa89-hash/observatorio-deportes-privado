import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataControl } from './data-control.mjs';
import { frozenTrialHash } from './data-backups.mjs';
import { updateStatus, quotaLabel } from './public/update-status.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const store = { leagues: { sample: { key: 'football-data:E0', name: 'League', seasons: ['2026/2027'], source: 'Football-Data.co.uk' } }, matches: [], basketball: { trial: { snapshots: [] } } };
  const options = { getStore: () => store, persist: async () => {}, connections: () => ({}), policies: () => ({ basketball: {} }),
    basketballData: () => ({ games: [], players: [] }), backups: { ensure: async () => {}, list: async () => [] }, now: () => new Date('2026-11-06T12:00:00Z') };
  return { store, options };
}
test('restart reconciles stale executors, preserves successful checkpoints and access blocks', async () => {
  const { store, options } = fixture(), frozen = frozenTrialHash(store);
  store.dataControl = { schema: 1, automatic: {}, budgets: {}, events: [], jobs: [
    { id: 'one', status: 'complete', freshAt: '2026-11-06T11:00:00Z' },
    { id: 'two', status: 'running', attempt: { id: 'old', startedAt: '2026-11-06T11:00:00Z' } },
    { id: 'three', status: 'blocked', issue: { code: 'access_restricted' } }], visit: { phase: 'updating', jobIds: ['one','two','three'], processedIds: ['one'], requestedAt: '2026-11-06T11:00:00Z' } };
  let writes = 0; options.persist = async () => { writes++; };
  const service = createDataControl(options), progress = service.progress();
  assert.equal(progress.running, false); assert.equal(progress.phase, 'interrupted'); assert.equal(progress.processed, 1);
  assert.equal(store.dataControl.jobs[1].status, 'interrupted'); assert.equal(store.dataControl.jobs[1].attempt.outcome, 'interrupted');
  assert.equal(store.dataControl.jobs[1].nextAt, '2026-11-06T12:05:00.000Z');
  assert.equal(store.dataControl.jobs[2].status, 'blocked'); assert.equal(writes, 0);
  assert.equal(frozenTrialHash(store), frozen);
});
test('football and tennis checkpoint while NBA waits; pause is immediate and starts no queued basketball calls', async () => {
  const { store, options } = fixture(); let release, calls = [], persisted = [];
  options.handlers = Object.fromEntries(['nba-free', 'nba-official', 'nba-free-players', 'football-free', 'tennis-free'].map(kind => [kind, async () => {
    calls.push(kind); if (kind === 'nba-official') await new Promise(resolve => { release = resolve; });
    return { imported: 20 }; // received totals do not prove twenty newly added rows
  }]));
  options.persist = async () => { persisted.push(structuredClone(store.dataControl)); };
  const service = createDataControl(options); await service.visit();
  for (let i = 0; i < 30 && (!release || !service.progress().checks.some(job => job.sport === 'tennis' && job.status === 'complete')); i++) await tick();
  assert.ok(release); assert.ok(calls.includes('football-free')); assert.ok(calls.includes('tennis-free'));
  assert.equal(service.progress().processed, 2); assert.ok(persisted.some(state => state.visit?.processedIds.length === 2));
  assert.deepEqual(service.pause(), { requested: true, running: true }); release();
  for (let i = 0; i < 50 && service.running(); i++) await tick();
  assert.equal(service.progress().phase, 'paused'); assert.equal(calls.includes('nba-free'), false);
  const checked = store.dataControl.jobs.find(job => job.kind === 'football-free');
  assert.equal(checked.attempt.outcome, 'checked'); assert.ok(checked.startedAt); assert.ok(checked.finishedAt); assert.ok(checked.lastSuccessAt);
});
test('a verified source failure is partial and stale quota snapshots never claim today usage', () => {
  assert.match(updateStatus({ phase: 'interrupted', requestedAt: '2026-11-05', total: 4, processed: 2 }).title, /interrumpida/);
  assert.match(updateStatus({ phase: 'checked', issues: [{ task: 'A', message: 'Blocked' }] }).title, /parcial/);
  assert.match(quotaLabel({ day: '2026-10-23' }, new Date('2026-11-06')), /no acredita/);
  assert.equal(quotaLabel({ day: '2026-11-06' }, new Date('2026-11-06')), 'Contador de hoy (UTC)');
});
