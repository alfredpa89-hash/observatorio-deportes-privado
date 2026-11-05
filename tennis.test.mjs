import assert from 'node:assert/strict';
import test from 'node:test';
import { TENNIS_SOURCE, parseTennisCsv, buildTennisReport } from './tennis.mjs';

const TML_HEADER = 'tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,score,best_of,w_ace,w_df,l_ace,l_df';
const TEMPLATE = TENNIS_SOURCE.csvTemplate;

function fixture(overrides = {}) {
  return {
    id: 'one', date: '2026-01-01T12:00:00.000Z', availableAfter: '2026-01-01T12:00:00.000Z',
    datePrecision: 'match-date', season: '2026', tournament: 'Rotterdam', category: 'atp-500', surface: 'Hard',
    player1: 'Alpha', player2: 'Opponent', winner: 1, bestOf: 3, score: '6-4 6-4',
    totalGames: 20, totalSets: 2, completed: true,
    ...overrides,
  };
}

function context() {
  return Array.from({ length: 20 }, (_, index) => fixture({
    id: `match-${index}`, date: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    availableAfter: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    player1: index < 10 ? 'Alpha' : 'Beta', player2: `Opponent ${index % 5}`,
    winner: index < 8 || index >= 15 ? 1 : 2,
    totalGames: index % 2 ? 26 : 20, totalSets: index % 2 ? 3 : 2,
  }));
}

function report(matches = context(), options = {}) {
  return buildTennisReport({ matches, season: '2026', player1: 'Alpha', player2: 'Beta',
    cutoff: '2026-02-01T00:00:00Z', lookback: 10, ...options });
}

test('tennis source exposes free ATP season files and a separate exact-date template', () => {
  assert.deepEqual(TENNIS_SOURCE.seasons, ['2026', '2025', '2024']);
  assert.equal(TENNIS_SOURCE.downloadUrls['2026'], 'https://stats.tennismylife.org/data/2026.csv');
  assert.match(TENNIS_SOURCE.csvTemplate, /player1,player2,winner,best_of,score/);
  assert.match(TENNIS_SOURCE.dateNote, /14 dias/);
});

test('TML parser uses explicit ATP levels and does not call A or Finals ATP 500/Masters', () => {
  const csv = [TML_HEADER,
    '2025-540,Wimbledon,Grass,G,20250630,1,AA,Alpha,BB,Beta,6-4 6-4 6-4,5,10,1,,0',
    '2025-404,Indian Wells Masters,Hard,M,20250303,2,AA,Alpha,BB,Beta,7-6(5) 6-4,3,,,,',
    '2025-424,Dallas,Hard,500,20250203,3,AA,Alpha,BB,Beta,6-3 6-2,3,,,,',
    '2025-451,Doha,Hard,A,20250217,4,AA,Alpha,BB,Beta,6-3 6-2,3,,,,',
    '2025-605,ATP Finals,Hard,F,20251110,5,AA,Alpha,BB,Beta,6-3 6-2,3,,,,',
  ].join('\n');
  const parsed = parseTennisCsv(csv, { season: '2025' });
  const byName = Object.fromEntries(parsed.matches.map(match => [match.tournament, match]));
  assert.equal(byName.Wimbledon.category, 'grand-slam');
  assert.equal(byName.Wimbledon.totalGames, 30);
  assert.equal(byName.Wimbledon.totalSets, 3);
  assert.equal(byName.Wimbledon.availableAfter, '2025-07-14T00:00:00.000Z');
  assert.equal(byName['Indian Wells Masters'].category, 'masters-1000');
  assert.equal(byName['Indian Wells Masters'].totalGames, 23);
  assert.equal(byName.Dallas.category, 'atp-500');
  assert.equal(byName.Doha.category, 'other');
  assert.equal(byName['ATP Finals'].category, 'other');
  assert.equal(parsed.tournaments.filter(tournament => tournament.name === 'Wimbledon').length, 1);
  assert.equal(byName.Wimbledon.stats.player2.aces, null);
  assert.equal(byName.Wimbledon.stats.player2.doubleFaults, 0);
  assert.match(parsed.note, /semana del torneo/);
});

test('custom CSV supports quoted names and exact match dates with end-of-day availability', () => {
  const parsed = parseTennisCsv(`\uFEFF${TEMPLATE}\r\n2026-01-03,"Event, Name",atp-500,Hard,"Alpha, Jr.",Beta,2,3,4-6 4-6\r\n`, { season: '2026' });
  const match = parsed.matches[0];
  assert.equal(match.player1, 'Alpha, Jr.');
  assert.equal(match.winner, 2);
  assert.equal(match.totalGames, 20);
  assert.equal(match.date, '2026-01-03T05:00:00.000Z');
  assert.equal(match.availableAfter, '2026-01-04T05:00:00.000Z');
  assert.equal(match.datePrecision, 'match-date');
  assert.deepEqual(parsed.players, ['Alpha, Jr.', 'Beta']);
  assert.equal(parseTennisCsv(`${TEMPLATE.replaceAll(',', ';')}\n2026-01-01;Wimbledon;grand-slam;Grass;Alpha;Beta;1;5;6-0 6-0 6-0`).matches.length, 1);
});

test('an explicit TML match_date takes precedence over tournament-week timestamps', () => {
  const parsed = parseTennisCsv(`${TML_HEADER},match_date\n2025-540,Wimbledon,Grass,G,20250630,1,AA,Alpha,BB,Beta,6-4 6-4 6-4,5,,,,,2025-07-13T17:00:00Z`);
  assert.equal(parsed.matches[0].availableAfter, '2025-07-13T23:00:00.000Z');
  assert.equal(parsed.matches[0].datePrecision, 'match-date');
});

test('retirements, walkovers and incomplete scores never fabricate match totals', () => {
  const parsed = parseTennisCsv([TEMPLATE,
    '2026-01-01,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 1-0 RET',
    '2026-01-02,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,W/O',
    '2026-01-03,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 3-2',
    '2026-01-04,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,',
    '2026-01-05,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 4-6 [10-8]',
  ].join('\n'));
  assert.equal(parsed.matches.filter(match => match.retired).length, 2);
  assert.ok(parsed.matches.every(match => match.totalGames === null && match.totalSets === null));
  const result = report(parsed.matches);
  assert.equal(result.summary.home.n, 3);
  assert.equal(result.summary.home.averages.games, null);
  assert.equal(result.summary.home.averages.aces, null);
  assert.ok(result.markets.filter(item => item.group === 'juegos').every(item => item.probability === null));
});

test('winner and total over/under probabilities are complementary percentages', () => {
  const result = report();
  assert.equal(result.summary.home.n, 10);
  assert.equal(result.summary.away.n, 10);
  assert.equal(result.summary.home.wins, 8);
  assert.equal(result.summary.away.wins, 5);
  assert.ok(result.markets[0].probability > result.markets[1].probability);
  assert.equal(round(result.markets[0].probability + result.markets[1].probability), 100);
  for (const group of ['juegos', 'sets']) {
    const markets = result.markets.filter(item => item.group === group);
    assert.ok(markets.every(item => item.probability > 0 && item.probability < 100));
    assert.equal(round(markets[0].probability + markets[1].probability), 100);
    assert.equal(markets[0].samples.league, 20);
  }
  assert.equal(result.markets.find(item => item.id === 'games-over-22.5').probability, 50);
  assert.match(result.quality.messages.join(' '), /calibracion/);
});

function round(number) {
  return Math.round(number * 100) / 100;
}

test('empty or insufficient history yields null instead of invented 50% or 0%', () => {
  for (const matches of [[], context().slice(0, 12)]) {
    const result = report(matches);
    assert.ok(result.markets.every(item => item.probability === null));
    assert.equal(result.quality.status, 'unavailable');
  }
  assert.equal(report([]).summary.home.winRate, null);
  assert.equal(report([]).summary.home.rating, null);
});

test('future matches and unavailable tournament results cannot change a pre-match estimate', () => {
  const initial = report();
  const future = fixture({ id: 'future', date: '2026-03-01T00:00:00Z', availableAfter: '2026-03-01T00:00:00Z', player2: 'Beta', winner: 2 });
  const underway = fixture({ id: 'underway', date: '2026-01-28T00:00:00Z', availableAfter: '2026-02-11T00:00:00Z', player2: 'Beta', datePrecision: 'tournament-week' });
  const atCutoff = fixture({ id: 'at-cutoff', date: '2026-01-20T00:00:00Z', availableAfter: '2026-02-01T00:00:00Z', player2: 'Beta' });
  assert.deepEqual(report([...context(), future, underway, atCutoff]).markets, initial.markets);
  assert.equal(report([...context(), future, underway]).history.h2h.length, 0);
  const futureSeason = fixture({ id: 'future-season', season: '2027', player2: 'Beta' });
  assert.deepEqual(report([...context(), futureSeason]).markets, initial.markets);
});

test('tournament, category and surface filters scope both histories and rating context', () => {
  const extra = context().map(match => ({ ...match, id: `clay-${match.id}`, surface: 'Clay', category: 'grand-slam', tournament: 'Roland Garros', bestOf: 5 }));
  const hard = report([...context(), ...extra], { surface: 'Hard', category: 'atp-500', tournament: 'Rotterdam' });
  assert.equal(hard.meta.eligibleMatches, 20);
  assert.ok(hard.history.home.every(match => match.tournament === 'Rotterdam'));
  const clay = report([...context(), ...extra], { surface: 'Clay', category: 'grand-slam', tournament: 'Roland Garros', bestOf: 5 });
  assert.equal(clay.meta.eligibleMatches, 20);
  assert.ok(clay.history.away.every(match => match.surface === 'Clay'));
});

test('games and sets markets never mix best-of-three with best-of-five records', () => {
  const mixed = context().map((match, index) => index % 2 ? { ...match, bestOf: 5, totalGames: 60, totalSets: 5 } : { ...match, totalGames: 20, totalSets: 2 });
  const three = report(mixed, { bestOf: 3 });
  assert.equal(three.summary.home.averages.games, 20);
  assert.equal(three.summary.away.averages.sets, 2);
  const over = three.markets.find(item => item.id === 'games-over-22.5');
  assert.equal(over.samples.home, 5);
  assert.equal(over.samples.away, 5);
  assert.equal(over.samples.league, 10);
  assert.equal(over.observed.home.hits, 0);
  assert.ok(over.probability < 10);
  assert.ok(!three.markets.some(item => item.id === 'sets-over-4.5'));
  const five = report(mixed, { bestOf: 5 });
  assert.equal(five.summary.home.averages.games, 60);
  assert.ok(five.markets.some(item => item.id === 'sets-over-4.5'));
  assert.ok(five.markets.find(item => item.id === 'games-over-22.5').probability > 90);
  assert.match(three.quality.messages.join(' '), /no se mezclan/);
});

test('deduplication and simultaneous result updates do not double-count h2h matches', () => {
  const headToHead = context().map(match => ({ ...match, player1: 'Alpha', player2: 'Beta' }));
  const result = report([...headToHead, ...headToHead]);
  assert.equal(result.meta.eligibleMatches, 20);
  assert.equal(result.history.h2h.length, 10);
  assert.equal(result.markets.find(item => item.id === 'games-over-22.5').samples.league, 10);
  const sameDate = context().map(match => ({ ...match, date: '2026-01-01T12:00:00Z', availableAfter: '2026-01-01T12:00:00Z' }));
  assert.deepEqual(report(sameDate).markets, report([...sameDate].reverse()).markets);
});

test('invalid dates, contradictory results and unclosed CSV quotes are rejected', () => {
  assert.throws(() => parseTennisCsv(`${TEMPLATE}\n2026-02-30,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4`), /validos/);
  assert.throws(() => parseTennisCsv(`${TEMPLATE}\n2026-02-30T12:00:00Z,Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4`), /validos/);
  assert.throws(() => parseTennisCsv(`${TEMPLATE}\n2026-01-03,Rotterdam,atp-500,Hard,Alpha,Beta,2,3,6-4 6-4`), /validos/);
  assert.throws(() => parseTennisCsv(`${TEMPLATE}\n2026-01-03,"Rotterdam,atp-500,Hard,Alpha,Beta,1,3,6-4 6-4`), /comillas/);
  assert.throws(() => report([], { player2: 'Alpha' }), /distintos/);
  assert.throws(() => report([], { cutoff: 'bad' }), /corte/);
  assert.throws(() => report([], { lookback: 1 }), /historial/);
  assert.throws(() => report([], { gamesLine: 22 }), /linea/);
  assert.throws(() => report([], { bestOf: 4 }), /formato/);
  assert.throws(() => report([], { surface: 'Unknown' }), /Superficie/);
  assert.throws(() => report([], { category: 'atp-250' }), /Categoria/);
});
