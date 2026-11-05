import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTennisCsv } from './tennis.mjs';
import { serviceStats, completeScore, normalizeTennisIdentities, tennisValues, rates } from './tennis-stats.mjs';
import { createTennisLab } from './tennis-lab.mjs';
import { createSportsService } from './sports.mjs';

const DAY = 86400000;
function result(index, overrides = {}) {
  const date = new Date(Date.UTC(2026, 5, index + 1, 12)).toISOString(), winner = index % 3 ? 1 : 2;
  const stats = { aces: index % 8, doubleFaults: 2, servePoints: 60, firstIn: 40, firstWon: 30, secondWon: 10, serviceGames: 10, bpFaced: 5, bpSaved: 3 };
  return { id: `match-${index}`, season: '2026', date, availableAfter: new Date(Date.parse(date) + 3 * 3600000).toISOString(), datePrecision: 'match-date',
    category: 'atp-500', tournament: 'Test Open', surface: 'Hard', indoor: false, player1: 'Alpha', player2: 'Beta', player1Id: '1', player2Id: '2', winner,
    completed: true, retired: false, bestOf: 3, score: winner === 1 ? '6-4 6-4' : '4-6 4-6', totalGames: 20, totalSets: 2,
    player1Games: winner === 1 ? 12 : 8, player2Games: winner === 1 ? 8 : 12, minutes: 90, rankings: { player1: 10, player2: 20 },
    stats: { player1: { ...stats }, player2: { ...stats, aces: 4 } }, ...overrides };
}
function setup() {
  let time = new Date('2026-10-16T17:00:00Z'), writes = 0, loads = 0;
  const store = { basketball: { trial: { version: 'frozen', snapshots: [{ id: 'unchanged' }] }, inputs: { old: 'keep' } },
    sports: { tennis: { datasets: { '2026': { matches: Array.from({ length: 80 }, (_, i) => result(i)), loadedAt: '2026-10-01T12:00:00Z', source: 'test', parserVersion: 2 } }, manual: {} } } };
  const lab = createTennisLab({ getStore: () => store, persist: async () => { writes++; }, now: () => time, sports: { load: async () => { loads++; return { warning: null }; } } });
  return { store, lab, advance: value => { time = new Date(value); }, writes: () => writes, loads: () => loads };
}
const selection = { season: '2026', surface: 'Hard', bestOf: 3, lookback: 20 };
const future = { ...selection, category: 'atp-500', tournament: 'Test Open', indoor: 'outdoor', player1Key: 'atp:1', player2Key: 'atp:2', date: '2026-10-16T22:00:00Z', sourceUrl: 'https://example.com/calendar' };

test('tennis importer retains native IDs, case-sensitive source columns, duration, indoor, ranks and serve/break counts', () => {
  const header = 'tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,indoor,minutes,winner_rank,loser_rank,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced';
  const parsed = parseTennisCsv(`${header}\n2026-1,Test Open,Hard,500,20260601,1,1,Alpha,2,Beta,6-4 6-4,3,No,90,10,20,5,2,60,40,30,10,10,3,5,2,1,55,35,25,10,10,1,3`);
  const match = parsed.matches[0], values = tennisValues(match, 'atp:1');
  assert.equal(match.player1Id, '1'); assert.equal(match.indoor, false); assert.equal(match.minutes, 90); assert.equal(match.rankings.player1, 10);
  assert.equal(values.firstIn, 40); assert.equal(values.serviceGames, 10); assert.equal(values.bpSaved, 3); assert.equal(values.breaks, 2);
  assert.equal(values.serviceHeld, 8); assert.equal(values.secondPlayed, 20);
});
test('invalid serve components and zero opportunities never invent ratios, breaks or aces', () => {
  const invalid = serviceStats({ servePoints: 10, firstIn: 20, firstWon: 30, bpSaved: 5, bpFaced: 3 });
  assert.equal(invalid.servePoints, null); assert.equal(invalid.bpFaced, null); assert.equal(invalid.aces, null);
  const { lab, store } = setup();
  for (const row of store.sports.tennis.datasets['2026'].matches) { row.stats.player1.bpFaced = 0; row.stats.player1.bpSaved = 0; row.stats.player2.bpFaced = null; }
  const profile = lab.profile({ ...selection, playerKey: 'atp:1' });
  assert.equal(profile.ratios.find(row => row.label === 'Puntos de quiebre salvados').percentage, null);
  assert.equal(profile.summary.find(row => row.metric === 'breaks').n, 0);
  assert.equal(rates([null, undefined], value => value > .5).frequency, null);
});
test('native identity merges name variants but never merges separate IDs or silently rewrites saved records', () => {
  const rows = [result(0, { player1: 'Name Old' }), result(1, { player1: 'Name New' }), result(2, { player1Id: '3', player1: 'Name New' })], before = structuredClone(rows);
  const normalized = normalizeTennisIdentities(rows);
  assert.equal(normalized[0].player1, 'Name New'); assert.equal(normalized[2].player1Id, '3'); assert.deepEqual(rows, before);
});
test('score details distinguish tie-breaks, straight sets and incomplete, retired or match-tiebreak results', () => {
  assert.equal(completeScore('7-6(5) 6-4', 3).tieBreaks, 1);
  assert.equal(completeScore('8-6 6-4', 3).tieBreaks, 0);
  for (const score of ['6-4 1-0 RET', 'W/O', '6-4 4-6 [10-8]', '6-4 3-2']) assert.equal(completeScore(score, 3), null);
  assert.equal(tennisValues(result(0, { score: '7-6(5) 6-4', winner: 1 }), 'atp:1').firstSetWon, 1);
});
test('timestamped imports use a conservative finish margin unless an explicit later finish is provided', () => {
  const header = 'date,tournament,category,surface,player1,player2,winner,best_of,score,finished_at';
  const prefix = `${header}\n2026-06-01T12:00:00Z,Test Open,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4,`;
  const unknown = parseTennisCsv(prefix).matches[0]; assert.equal(unknown.availableAfter, '2026-06-01T18:00:00.000Z'); assert.equal(unknown.timeKnown, true);
  const known = parseTennisCsv(prefix + '2026-06-01T14:00:00Z').matches[0]; assert.equal(known.availableAfter, '2026-06-01T14:00:00.000Z');
});
test('player windows 25 and 30 retain missing values, all ranges partition valid results, and reads are immutable', () => {
  const { store, lab, writes } = setup(), before = structuredClone(store);
  for (const lookback of [25, 30]) {
    const profile = lab.profile({ ...selection, playerKey: 'atp:1', lookback });
    assert.equal(profile.history.length, lookback); assert.equal(profile.lines.find(row => row.direction === 'over' && row.line === .5).n, lookback);
    assert.equal(profile.ranges.reduce((sum, row) => sum + row.hits, 0), lookback);
    assert.equal(profile.ratios[0].percentage, 100 * 40 / 60);
  }
  assert.deepEqual(store, before); assert.equal(writes(), 0);
  store.sports.tennis.datasets['2026'].matches.at(-1).stats.player1.aces = null;
  const profile = lab.profile({ ...selection, playerKey: 'atp:1', lookback: 5 });
  assert.equal(profile.lines[0].n, 4); assert.equal(profile.lines[0].missing, 1);
});
test('surface, indoor, category, format, exact cutoff, retirement and future filters apply before the selected window', () => {
  const { lab, store } = setup(), rows = store.sports.tennis.datasets['2026'].matches;
  rows.push(result(81, { surface: 'Clay' }), result(82, { indoor: true }), result(83, { bestOf: 5 }), result(84, { category: 'other' }),
    result(85, { retired: true, completed: false }), result(86, { availableAfter: '2027-01-01T00:00:00Z' }));
  const profile = lab.profile({ ...selection, indoor: 'outdoor', playerKey: 'atp:1', lookback: 30 });
  assert.ok(profile.history.every(row => row.bestOf === 3 && row.surface === 'Hard' && row.indoor === false && !row.retired));
  const cutoff = lab.profile({ ...selection, playerKey: 'atp:1', cutoff: '2026-06-03T14:00:00Z' });
  assert.equal(cutoff.history.length, 2);
  assert.throws(() => lab.coverage({ cutoff: 'bad' }), /corte/);
});
test('weekly dates do not imply zero recent load or a fabricated rest interval; ratios aggregate paired totals', () => {
  const { lab, store } = setup();
  for (const row of store.sports.tennis.datasets['2026'].matches) row.datePrecision = 'tournament-week';
  const profile = lab.profile({ ...selection, playerKey: 'atp:1' });
  assert.equal(profile.context.matches7Days, null); assert.equal(profile.context.daysSinceLast, null); assert.equal(profile.context.minutes14Days, null);
  assert.ok(profile.warnings.some(warning => /semana/.test(warning)));
});
test('comparison separates descriptive handicap/first-set frequencies from experimental pair estimates', () => {
  const { lab } = setup();
  const report = lab.comparison({ ...selection, player1Key: 'atp:1', player2Key: 'atp:2' });
  assert.equal(report.estimates[0].probability + report.estimates[1].probability, 100);
  assert.ok(report.scenarios.some(row => /primer set/.test(row.label))); assert.ok(report.scenarios.some(row => /\+1.5 juegos/.test(row.label)));
  assert.ok(report.scenarios.every(row => row.probability === undefined));
  assert.ok(!report.scenarios.some(row => /[+-]2.5 sets/.test(row.label)));
  assert.ok(report.scenarios.some(row => /gana 2-0/.test(row.label)));
  assert.equal(lab.profile({ ...selection, playerKey: 'atp:1', metric: 'setsWon' }).lines.at(-1).line, 1.5);
  assert.throws(() => lab.profile({ ...selection, playerKey: 'atp:1', metric: 'setsWon', line: 2.5 }), /formato/);
  assert.throws(() => lab.comparison({ ...selection, player1Key: 'atp:1', player2Key: 'atp:1' }), /distintos/);
});
test('calendar needs real future timezone, separate players, tournament context and a public source; no purchase or feed is assumed', async () => {
  const { lab, store } = setup(), frozen = structuredClone(store.basketball);
  const added = await lab.addFixture(future); assert.equal(added.timeKnown, true);
  assert.equal(lab.coverage(selection).fixtures.length, 1);
  for (const body of [{ ...future, sourceUrl: 'http://example.com' }, { ...future, date: '2026-10-15T22:00:00Z' },
    { ...future, player2Key: 'atp:1' }, { ...future, date: '2026-10-17' }, { ...future, date: '2026-10-17T22:00:00Z', sourceUrl: 'https://localhost/test' }]) await assert.rejects(lab.addFixture(body));
  assert.deepEqual(store.basketball, frozen);
  await lab.removeFixture({ id: added.id }); assert.equal(lab.coverage(selection).fixtures.length, 0);
});
test('daily preparation seals once, fixes its protocol at 20, keeps inputs, and never seals started or unverified fixtures', async () => {
  const { lab, store } = setup(), frozen = structuredClone(store.basketball), fixture = await lab.addFixture(future);
  store.tennisLab.fixtures.push({ ...fixture, id: 'unknown', timeKnown: false }, { ...fixture, id: 'too-close', date: '2026-10-16T17:03:00Z' }, { ...fixture, id: 'started', date: '2026-10-16T16:00:00Z' });
  const prepared = await lab.prepare({ ...selection, lookback: 5 }); assert.equal(prepared.prepared, 1);
  const snapshot = structuredClone(store.tennisLab.snapshots[0]); assert.equal(store.tennisLab.inputs[snapshot.inputHash].config.lookback, 20);
  assert.equal((await lab.prepare(selection)).prepared, 0); assert.deepEqual(store.tennisLab.snapshots[0], snapshot);
  assert.equal(lab.daily().picks.filter(row => row.group === 'resultado').length, 1);
  await assert.rejects(lab.removeFixture({ id: fixture.id }), /conserva/);
  const before = structuredClone(store);
  await assert.rejects(lab.prepare({ date: '2026-10-15' }), /Selecciona/); assert.deepEqual(store, before);
  assert.deepEqual(store.basketball, frozen);
});
test('new availability excludes a pick without rewriting its seal; expired latest report does not revive older availability', async () => {
  const { lab, store, advance } = setup(); await lab.addFixture(future); await lab.prepare(selection);
  const snapshot = structuredClone(store.tennisLab.snapshots[0]);
  await lab.saveAvailability({ ...selection, playerKey: 'atp:1', status: 'out', sourceUrl: 'https://example.com/report', publishedAt: '2026-10-16T16:00:00Z', expiresAt: '2026-10-17T17:00:00Z' });
  assert.equal(lab.daily().picks.length, 0); assert.deepEqual(store.tennisLab.snapshots[0], snapshot);
  await lab.saveAvailability({ ...selection, playerKey: 'atp:1', status: 'questionable', sourceUrl: 'https://example.com/latest', publishedAt: '2026-10-16T16:30:00Z', expiresAt: '2026-10-16T18:00:00Z' });
  advance('2026-10-16T19:00:00Z'); assert.equal(lab.profile({ ...selection, playerKey: 'atp:1' }).context.availability.status, 'unknown');
  assert.ok(lab.daily().picks.length > 0);
});
test('prospective evaluation needs unique exact-date results, excludes retirements, detects tampering and scores missing fields separately', async () => {
  const { lab, store, advance } = setup(); await lab.addFixture(future); await lab.prepare(selection);
  const results = store.sports.tennis.datasets['2026'].matches;
  const completed = result(90, { id: 'actual', date: future.date, availableAfter: '2026-10-17T01:00:00Z', winner: 2 });
  results.push({ ...completed, datePrecision: 'tournament-week' }); advance('2026-10-17T02:00:00Z');
  assert.equal(lab.evaluation().exclusions.pending, 1); results.at(-1).datePrecision = 'match-date';
  let evaluation = lab.evaluation(); assert.equal(evaluation.groups.find(row => row.group === 'resultado').n, 1); assert.equal(evaluation.gamesN, 1);
  results.at(-1).retired = true; assert.equal(lab.evaluation().exclusions.retired, 1); results.at(-1).retired = false;
  results.at(-1).totalGames = null; evaluation = lab.evaluation(); assert.equal(evaluation.groups.find(row => row.group === 'juegos').missing, 1);
  store.tennisLab.snapshots[0].markets[0].probability = 99;
  assert.equal(lab.evaluation().exclusions.invalid, 1); assert.equal(lab.daily().picks.length, 0);
});
test('historical validation is temporal, scoped, bounded and separate from prospective and other sports', async () => {
  const { lab, store } = setup(), before = structuredClone(store.basketball);
  const result = await lab.backtest(selection);
  assert.equal(result.candidates, 24); assert.ok(result.n > 0); assert.ok(result.brier >= 0); assert.equal(result.bins.reduce((sum, bin) => sum + bin.n, 0), result.n);
  assert.equal(store.tennisLab.snapshots.length, 0); assert.deepEqual(store.basketball, before);
  assert.equal((await lab.refresh(selection)).warning, null);
});
test('calibration never uses the winner-first ordering of source CSVs as a fixed positive outcome', async () => {
  const { lab, store } = setup();
  store.sports.tennis.datasets['2026'].matches = store.sports.tennis.datasets['2026'].matches.map(row => row.winner === 1 ? row : {
    ...row, player1: row.player2, player2: row.player1, player1Id: row.player2Id, player2Id: row.player1Id, winner: 1,
    score: '6-4 6-4', player1Games: 12, player2Games: 8,
  });
  const result = await lab.backtest(selection);
  const positives = result.bins.reduce((sum, bin) => sum + (bin.observed ?? 0) * bin.n / 100, 0);
  assert.ok(Math.abs(positives - 16) < 1e-8); assert.equal(result.n, 24);
  assert.ok(result.bins.some(bin => bin.n && bin.observed < 100));
});
test('truncated replacement sources retain the previous tennis archive and its real update timestamp', async () => {
  const { store } = setup(), original = globalThis.fetch;
  store.sports.tennis.datasets['2026'].matches = Array.from({ length: 120 }, (_, i) => result(i));
  const before = structuredClone(store.sports.tennis.datasets['2026']);
  globalThis.fetch = async () => new Response('date,tournament,category,surface,player1,player2,winner,best_of,score\n2026-06-01,Test Open,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4');
  try {
    const sports = createSportsService({ getStore: () => store, persist: async () => {} });
    const loaded = await sports.load({ sport: 'tennis', season: '2026' });
    assert.match(loaded.warning, /muchos menos resultados/); assert.deepEqual(store.sports.tennis.datasets['2026'], before);
  } finally { globalThis.fetch = original; }
});
