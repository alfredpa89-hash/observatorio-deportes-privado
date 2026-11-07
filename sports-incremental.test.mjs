import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportsService } from './sports.mjs';
import { NBA_SOURCE, parseNbaSchedule } from './nba.mjs';
const months = ['202610','202611','202612','202701','202702','202703','202704'];
function payload(month, score = '100') {
  const date = `${month.slice(0,4)}-${month.slice(4)}-02T20:00:00Z`;
  return { events: [{ id: month, date, season: { year: 2027, type: 2 }, competitions: [{ date, status: { period: 4, type: { completed: true } }, competitors: [
    { homeAway: 'home', team: { displayName: 'Boston Celtics' }, score }, { homeAway: 'away', team: { displayName: 'Chicago Bulls' }, score: '90' } ] }] }] };
}
test('NBA refresh reuses verified months, updates recent corrections, and preserves a failed month', async () => {
  const native = globalThis.fetch; let time = new Date('2027-01-10T12:00:00Z'), calls = [], failed = false;
  const matches = months.flatMap(month => parseNbaSchedule(payload(month), { season: '2026/2027' }).matches);
  const checks = Object.fromEntries(months.map(month => [month, { checkedAt: '2027-01-10T05:00:00Z', matchIds: [month], fixtureIds: [] }]));
  const store = { sports: { nba: { datasets: {
    '2026/2027': { source: 'ESPN', parserVersion: NBA_SOURCE.parserVersion, loadedAt: '2027-01-10T05:00:00Z', matches, fixtures: [], monthChecks: checks },
    '2025/2026': { source: 'ESPN', parserVersion: NBA_SOURCE.parserVersion, loadedAt: time.toISOString(), matches: [], fixtures: [] },
  }, manual: {} } } };
  const service = createSportsService({ getStore: () => store, persist: async () => {}, now: () => time });
  globalThis.fetch = async url => { const month = new URL(url).searchParams.get('dates'); calls.push(month); if (failed && month === '202612') throw Error('offline'); return Response.json(payload(month, month === '202701' ? '105' : '100')); };
  try {
    await service.load({ sport: 'nba', season: '2026/2027', freshness: true });
    assert.deepEqual(calls, ['202612','202701','202702']); assert.equal(store.sports.nba.datasets['2026/2027'].matches.length, 7);
    assert.equal(store.sports.nba.datasets['2026/2027'].matches.find(row => row.id === '202701').homePoints, 105);
    calls = []; await service.load({ sport: 'nba', season: '2026/2027', freshness: true }); assert.equal(calls.length, 0);
    time = new Date('2027-01-10T12:20:00Z'); failed = true;
    const partial = await service.load({ sport: 'nba', season: '2026/2027', freshness: true });
    assert.match(partial.warning, /parcial/); assert.equal(store.sports.nba.datasets['2026/2027'].matches.length, 7);
    assert.equal(store.sports.nba.datasets['2026/2027'].monthChecks['202612'].checkedAt, '2027-01-10T12:00:00.000Z');
    assert.equal(store.sports.nba.datasets['2026/2027'].matches.find(row => row.id === '202612').homePoints, 100);
  } finally { globalThis.fetch = native; }
});
