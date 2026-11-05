import assert from 'node:assert/strict';
import test from 'node:test';
import { NBA_SOURCE, parseNbaSchedule, parseNbaEspn, buildNbaReport } from './nba.mjs';

function event({ id = '1', year = 2026, type = 2, completed = true, homeScore = '115', awayScore = '109', home = 'Boston Celtics', away = 'Chicago Bulls', date = '2025-11-01T00:00Z', notes = [], period = 4 } = {}) {
  return {
    id, date, season: { year, type },
    competitions: [{ date, notes, status: { period, type: { completed, description: completed ? 'Final' : 'Scheduled' } }, competitors: [
      { homeAway: 'home', team: { displayName: home, logo: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png' }, score: homeScore, statistics: [
        { name: 'rebounds', displayValue: '45' }, { name: 'assists', displayValue: '26' }, { name: 'threePointFieldGoalsMade', displayValue: '14' },
      ] },
      { homeAway: 'away', team: { displayName: away }, score: awayScore },
    ] }],
  };
}

function history() {
  return Array.from({ length: 40 }, (_, index) => ({
    id: `game-${index}`, date: new Date(Date.UTC(2025, 10, index + 1)).toISOString(),
    season: '2025/2026', home: index % 2 ? 'Chicago Bulls' : 'Boston Celtics',
    away: index % 2 ? 'Boston Celtics' : 'Chicago Bulls',
    homePoints: index % 2 ? 107 + index % 7 : 118 + index % 7,
    awayPoints: index % 2 ? 118 + index % 5 : 108 + index % 5,
    finished: true, seasonType: 2, stats: { home: { rebounds: 40 }, away: {} },
  }));
}

const reportOptions = { season: '2025/2026', home: 'Boston Celtics', away: 'Chicago Bulls', lookback: 10, cutoff: '2026-01-01T00:00:00Z' };

test('ESPN parser separates final results and scheduled games without inventing counts', () => {
  assert.equal(parseNbaEspn, parseNbaSchedule);
  const payload = { events: [event(), event({ id: '2', completed: false, homeScore: '0', awayScore: '0', date: '2025-12-01T00:00Z' })] };
  const result = parseNbaSchedule(payload);
  assert.equal(result.season, '2025/2026');
  assert.equal(result.matches.length, 1);
  assert.equal(result.fixtures.length, 1);
  assert.equal(result.matches[0].homePoints, 115);
  assert.equal(result.matches[0].stats.home.threePointersMade, 14);
  assert.deepEqual(result.matches[0].stats.away, {});
  assert.deepEqual(result.teams, ['Boston Celtics', 'Chicago Bulls']);
  assert.equal(result.fixtures[0].homePoints, undefined);
  assert.equal(NBA_SOURCE.seasonType, 2);
  assert.throws(() => parseNbaSchedule({}), /eventos valida/);
});

test('parser excludes preseason, playoffs, Cup final and incomplete final scores', () => {
  const parsed = parseNbaSchedule({ events: [
    event({ id: 'regular', period: 5 }),
    event({ id: 'preseason', type: 1 }), event({ id: 'playoffs', type: 3 }),
    event({ id: 'all-star', notes: [{ headline: 'NBA All-Star - Championship' }] }),
    { ...event({ id: 'all-star-type' }), competitions: [{ ...event().competitions[0], type: { abbreviation: 'ALLSTAR' } }] },
    event({ id: 'cup-final', notes: [{ headline: 'NBA Cup Championship' }] }),
    event({ id: 'cup-semis', notes: [{ headline: 'NBA Cup - Semifinals' }] }),
    event({ id: 'no-scores', homeScore: '0', awayScore: '0' }),
    event({ id: 'tie', homeScore: '100', awayScore: '100' }),
  ] });
  assert.deepEqual(parsed.matches.map(match => match.id).sort(), ['cup-semis', 'regular']);
  assert.equal(parsed.matches.find(match => match.id === 'regular').overtime, true);
  assert.match(parsed.warning, /^2 resultados/);
});

test('parser respects requested season and deduplicates repeated events', () => {
  const parsed = parseNbaSchedule({ events: [event(), event(), event({ id: 'new-season', year: 2027 })] }, { season: '2025/2026' });
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].season, '2025/2026');
});

test('report produces bounded complementary win and fractional over-under percentages', () => {
  const report = buildNbaReport({ ...reportOptions, matches: history(), totalLine: 220.5, spreadLine: -3.5 });
  const market = id => report.markets.find(item => item.id === id);
  assert.equal(report.markets.length, 6);
  for (const item of report.markets) assert.ok(item.probability > 0 && item.probability < 100);
  assert.equal(market('home-win').probability + market('away-win').probability, 100);
  assert.equal(market('total-over').probability + market('total-under').probability, 100);
  assert.equal(market('spread-home').probability + market('spread-away').probability, 100);
  assert.ok(market('home-win').probability > market('away-win').probability);
  assert.equal(market('home-win').observed.home.n, 10);
  assert.equal(report.summary.home.matches, 10);
  assert.equal(report.summary.home.rebounds.n, 5);
  assert.ok(report.meta.totalStandardDeviation >= 15);
  assert.match(report.quality.messages.join(' '), /no calibrada/);
});

test('integer totals and spreads include push probability rather than treating equality as a win', () => {
  const report = buildNbaReport({ ...reportOptions, matches: history(), totalLine: 220, spreadLine: -4 });
  for (const prefix of ['total', 'spread']) {
    const first = report.markets.find(item => item.id === `${prefix}-${prefix === 'total' ? 'over' : 'home'}`);
    const second = report.markets.find(item => item.id === `${prefix}-${prefix === 'total' ? 'under' : 'away'}`);
    assert.ok(first.pushProbability > 0);
    assert.ok(Math.abs(first.probability + second.probability + first.pushProbability - 100) < 0.00001);
  }
  const zero = buildNbaReport({ ...reportOptions, matches: history(), spreadLine: 0 });
  assert.equal(zero.markets.find(item => item.id === 'spread-home').probability, zero.markets.find(item => item.id === 'home-win').probability);
  assert.equal(zero.markets.find(item => item.id === 'spread-home').pushProbability, 0);
});

test('only final prior results and current/prior seasons inform a report, with exact cutoff excluded', () => {
  const matches = history();
  const base = buildNbaReport({ ...reportOptions, matches });
  const excluded = [
    { ...matches[0], id: 'future', date: '2027-01-01T00:00Z', homePoints: 300 },
    { ...matches[0], id: 'at-cutoff', date: reportOptions.cutoff, homePoints: 300 },
    { ...matches[0], id: 'later-season', season: '2026/2027', homePoints: 300 },
    { ...matches[0], id: 'unfinished', finished: false, homePoints: 300 },
    { ...matches[0], id: 'preseason', seasonType: 1, homePoints: 300 },
  ];
  const augmented = buildNbaReport({ ...reportOptions, matches: [...matches, ...excluded, matches[0]] });
  assert.deepEqual(augmented.markets, base.markets);
  assert.deepEqual(augmented.summary, base.summary);
  assert.equal(augmented.meta.leagueMatches, 40);
  const nextSeason = buildNbaReport({ ...reportOptions, season: '2026/2027', matches });
  assert.equal(nextSeason.summary.home.matches, 10);
  assert.match(nextSeason.quality.messages.join(' '), /temporadas anteriores/);
});

test('missing or short samples return unavailable probabilities and no made-up averages', () => {
  const none = buildNbaReport({ ...reportOptions });
  assert.ok(none.markets.every(market => market.probability === null));
  assert.equal(none.summary.home.averagePointsFor, null);
  assert.equal(none.meta.expectedTotalPoints, null);
  const short = buildNbaReport({ ...reportOptions, matches: history().slice(0, 10) });
  assert.ok(short.markets.every(market => market.probability === null));
  assert.equal(short.quality.level, 'sin-datos');
});

test('higher total or stricter home handicap reduces over and cover probabilities', () => {
  const matches = history();
  const low = buildNbaReport({ ...reportOptions, matches, totalLine: 200.5, spreadLine: 5.5 });
  const high = buildNbaReport({ ...reportOptions, matches, totalLine: 250.5, spreadLine: -10.5 });
  assert.ok(low.markets.find(market => market.id === 'total-over').probability > high.markets.find(market => market.id === 'total-over').probability);
  assert.ok(low.markets.find(market => market.id === 'spread-home').probability > high.markets.find(market => market.id === 'spread-home').probability);
  assert.throws(() => buildNbaReport({ ...reportOptions, home: 'Chicago Bulls' }), /diferentes/);
  assert.throws(() => buildNbaReport({ ...reportOptions, cutoff: 'invalid' }), /corte/);
  assert.throws(() => buildNbaReport({ ...reportOptions, totalLine: 220.3 }), /pasos/);
});
