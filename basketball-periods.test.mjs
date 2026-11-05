import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teamValue, playerPeriod, playerKey, inspectGame, admissibleGame, periodRecords, usableHistory, replayHistory, parsePeriodImport, mergePersonalGames, sourceDiscrepancies } from './public/basketball-periods-core.js';
const NOW = Date.parse('2026-10-11T20:00:00Z');
const samples = JSON.parse(await readFile(new URL('./public/data/quarter-reference.json', import.meta.url), 'utf8'));
const game = (overrides = {}) => ({ id: 'game1', league: 'nba', season: '2025/2026', date: '2026-01-01T00:00:00.000Z', home: 'Denver Nuggets', away: 'Golden State Warriors', finished: true, preseason: false, phase: 'regular',
  source: 'Personal', sourceUrl: 'https://example.com/authorized-record', periods: { home: { q1: 20, q2: 21, q3: 22, q4: 23, ot: 0, ft: 86 }, away: { q1: 19, q2: 20, q3: 21, q4: 22, ot: 0, ft: 82 } }, players: [], ...overrides });
const query = { league: 'nba', season: '2025/2026', kind: 'teams', entity: 'Denver Nuggets', period: 'q1', metric: 'points', now: NOW };
const payload = games => ({ schema: 1, license: 'Personal authorized observations', games });
const parse = games => parsePeriodImport(payload(games), { rightsConfirmed: true, now: NOW });
test('NBA and ACB official pilot totals agree with all four quarters', () => {
  assert.equal(samples.games.length, 2);
  assert.equal(samples.games.reduce((sum, game) => sum + game.players.length, 0), 52);
  for (const game of samples.games) { assert.equal(inspectGame(game).complete, true); assert.equal(game.referenceOnly, true); }
  const jokic = samples.games[0].players.find(player => player.name === 'Nikola Jokic');
  assert.deepEqual(playerPeriod(jokic, 'ht'), { minutes: 19 + 11 / 60, points: 15, rebounds: 8, assists: 4, pra: 27, threes: 2 });
  assert.equal(playerPeriod(jokic, 'q3').points, 10);
  assert.equal(playerPeriod(jokic, 'ft').pra, 48);
});
test('missing quarters never become zero or final divided by four', () => {
  assert.equal(teamValue({ ft: 100 }, 'q1'), null);
  assert.equal(teamValue({ q1: 20 }, 'ht'), null);
  assert.equal(teamValue({ q1: 0, q2: 20 }, 'ht'), 20);
  assert.equal(playerPeriod({ periods: { ft: { points: 20, minutes: 30 } } }, 'q1'), null);
});
test('player halftime requires both quarters; documented non-participation is allowed', () => {
  const player = { periods: { q1: { minutes: 0, points: null, rebounds: null, assists: null, threes: null }, q2: { minutes: 5, points: 4, rebounds: 1, assists: 2, threes: 0 } } };
  assert.equal(playerPeriod(player, 'ht').pra, 7);
  delete player.periods.q1; assert.equal(playerPeriod(player, 'ht'), null);
});
test('team overtime stays separate and is included only in final reconciliation', () => {
  const input = game(); input.periods.home.ot = 5; input.periods.home.ft = 91;
  assert.equal(inspectGame(input).valid, true);
  assert.equal(teamValue(input.periods.home, 'q4'), 23);
  assert.equal(teamValue(input.periods.home, 'ot'), 5);
  input.periods.home.ft = 90; assert.equal(inspectGame(input).valid, false);
});
test('bad halftime, impossible minutes, triples and PRA are rejected', () => {
  const input = game(); input.periods.home.ht = 1;
  input.players = [{ playerId: 'p1', name: 'Test', team: input.home, periods: { q1: { minutes: 13, points: 1, rebounds: 1, assists: 1, pra: 9, threes: 1 } } }];
  assert.equal(inspectGame(input).errors.length, 4);
  assert.throws(() => parse([input]), /no coincide|fuera del periodo/);
});
test('full rosters reconcile individual scoring with team quarter points', () => {
  const input = game({ rosterComplete: true, players: [{ name: 'Test', team: 'Denver Nuggets', periods: { q1: { minutes: 5, points: 19 } } }] });
  assert.equal(inspectGame(input).valid, false);
});
test('official technical references are viewable but not statistical evidence', () => {
  const sample = samples.games[0], records = periodRecords([sample], { ...query, period: 'q1' });
  assert.equal(records[0].value, 23);
  assert.equal(usableHistory(records).values.length, 0);
  assert.equal(replayHistory(records, { line: 20.5 }).n, 0);
});
test('preseason, All-Star, NBA playoffs and future results are excluded', () => {
  const inputs = [game({ preseason: true }), game({ home: 'Team Shaq' }), game({ phase: 'playoffs' }), game({ date: '2026-11-01T00:00:00Z' })];
  assert.equal(periodRecords(inputs, query).length, 0);
  assert.equal(admissibleGame(game({ league: 'endesa', phase: 'playoffs' }), NOW), true);
});
test('PRA is calculated only with all three values and unknown minutes are not participation', () => {
  const input = game({ players: [{ name: 'Test', team: 'Denver Nuggets', periods: { q1: { minutes: null, points: 1, rebounds: 2, assists: null } } }] });
  const records = periodRecords([input], { ...query, kind: 'players', entity: playerKey(input.players[0]), metric: 'points' });
  assert.equal(records[0].values.pra, null);
  assert.equal(usableHistory(records).values.length, 0);
});
test('recent missing games remain in the chosen window', () => {
  const records = Array.from({ length: 6 }, (_, index) => ({ gameKey: `g${index}`, date: new Date(NOW - index * 86400_000).toISOString(), valid: true, value: index === 0 ? null : 10 }));
  const result = usableHistory(records, 5);
  assert.equal(result.window.length, 5); assert.equal(result.values.length, 4);
});
test('duplicates count once and discrepant sources are excluded', () => {
  const records = periodRecords([game(), game({ id: 'same-stats' })], query);
  assert.equal(usableHistory(records).values.length, 1);
  const conflict = structuredClone(game()); conflict.periods.home.q1 = 21; conflict.periods.home.ft = 87;
  const result = usableHistory(periodRecords([game(), conflict], query));
  assert.equal(result.values.length, 0); assert.equal(result.conflicts.length, 1);
});
test('chronological replay uses only prior games and a fixed selected window', () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ gameKey: `g${index}`, date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * 86400_000).toISOString(), valid: true, opponent: 'Other', value: index === 11 ? 99 : 10 }));
  const result = replayHistory(records, { depth: 5, line: 20.5 });
  assert.equal(result.n, 7); assert.equal(result.outcomes.at(-1).expected, 10);
  assert.equal(result.outcomes.at(-1).probability, 1 / 7);
  assert.equal(result.outcomes.at(-1).error, 89);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.n, 0), result.n);
  assert.ok(Number.isFinite(result.logLoss));
  assert.throws(() => replayHistory(records, { line: 20 }), /\.5/);
  assert.throws(() => replayHistory(records, { line: 20.5, depth: 4 }), /Ventana/);
});

test('quarter histories and replay honor 25/30 without widening missing-data samples', () => {
  const records = Array.from({ length: 45 }, (_, index) => ({ gameKey: `extended-${index}`,
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), valid: true, value: index === 44 ? null : 20 }));
  for (const depth of [25, 30]) {
    const history = usableHistory(records, depth);
    assert.equal(history.window.length, depth); assert.equal(history.values.length, depth - 1);
    const replay = replayHistory(records, { depth, line: 20.5 });
    assert.equal(replay.outcomes.at(-1).n, depth);
  }
});
test('replay excludes insufficient history and simultaneous or just-started games', () => {
  const date = game().date;
  const records = Array.from({ length: 6 }, (_, index) => ({ gameKey: `g${index}`, date, valid: true, value: 10 }));
  assert.equal(replayHistory(records, { line: 5.5 }).n, 0);
});
test('import requires rights, source, past timezone-aware date and regular NBA', () => {
  assert.throws(() => parsePeriodImport(payload([game()]), { now: NOW }), /Confirma/);
  assert.throws(() => parse([game({ phase: '' })]), /phase/);
  assert.throws(() => parse([game({ sourceUrl: 'javascript:alert(1)' })]), /URL/);
  assert.throws(() => parse([game({ date: '2026-01-01' })]), /Fecha/);
  assert.throws(() => parse([game({ date: '2026-10-11T19:00:00Z' })]), /Fecha/);
  assert.throws(() => parse([game({ season: '2025/2027' })]), /temporada/);
});
test('import keeps blanks missing and rejects strings, negatives and future values', () => {
  const input = game(); input.periods.home.q2 = ''; input.periods.home.q3 = null;
  assert.equal(parse([input])[0].periods.home.q2, null);
  input.periods.home.q1 = '20'; assert.throws(() => parse([input]), /numeros o null/);
  input.periods.home.q1 = -1; assert.throws(() => parse([input]), /Valor/);
  assert.throws(() => parse([game({ periods: {}, players: [] })]), /ningun dato/);
});
test('player imports reject duplicates, wrong teams and zero-minute positive stats', () => {
  const player = { playerId: 'p1', name: 'Test', team: 'Denver Nuggets', periods: { q1: { minutes: 0, points: 5 } } };
  assert.throws(() => parse([game({ players: [player] })]), /cero minutos/);
  player.periods.q1.minutes = 5;
  assert.throws(() => parse([game({ players: [player, player] })]), /duplicado/);
  assert.throws(() => parse([game({ players: [{ ...player, team: 'Other' }] })]), /Equipo/);
});
test('import is atomic, does not overwrite conflicts and preserves per-game licenses', () => {
  const incoming = parse([game({ license: 'Individual license' })]);
  const existing = mergePersonalGames([], incoming).games;
  assert.equal(existing[0].license, 'Individual license');
  assert.equal(mergePersonalGames(existing, incoming).added, 0);
  const conflict = parse([game({ source: 'Changed source' })]);
  assert.throws(() => mergePersonalGames(existing, [parse([game({ id: 'new', date: '2026-01-02T00:00:00Z' })])[0], ...conflict]), /No se sobrescribio/);
  assert.equal(existing.length, 1);
  assert.throws(() => parse([game(), game()]), /duplicado/);
});
test('bad preexisting quality flags prevent history inclusion', () => {
  assert.equal(usableHistory(periodRecords([game({ issues: ['Provider totals mismatch'] })], query)).values.length, 0);
});
test('invalid recent games and conflicts reduce the sample instead of extending the window', () => {
  const records = Array.from({ length: 6 }, (_, index) => ({ gameKey: `g${index}`, date: new Date(NOW - index * 86400_000).toISOString(), valid: index !== 0, value: 10 }));
  assert.equal(usableHistory(records, 5).values.length, 4);
  records.push({ ...records[1], value: 11 });
  const result = usableHistory(records, 5);
  assert.equal(result.window.length, 5); assert.equal(result.values.length, 3); assert.equal(result.conflicts.length, 1);
});
test('disagreements in reported participation cannot silently change the player sample', () => {
  const first = { gameKey: 'game1', date: game().date, valid: true, minutes: 0, value: 0 };
  const result = usableHistory([first, { ...first, minutes: 5 }]);
  assert.equal(result.conflicts.length, 1); assert.equal(result.values.length, 0);
});
test('source comparisons require the same date, season, team, opponent and player', () => {
  const sample = samples.games[0], player = sample.players.find(player => player.name === 'Nikola Jokic');
  const log = { ...player, league: sample.league, season: sample.season, date: sample.date.replace('.000Z', 'Z'), opponent: sample.away, source: 'Other', values: { points: 23, rebounds: 17, assists: 17, threes: 0 } };
  assert.equal(sourceDiscrepancies([sample], [log]).length, 1);
  for (const change of [{ date: '2026-03-25T03:00:00Z' }, { season: '2024/2025' }, { opponent: 'Other' }, { name: 'Other' }, { team: 'Other' }]) assert.equal(sourceDiscrepancies([sample], [{ ...log, ...change }]).length, 0);
});
