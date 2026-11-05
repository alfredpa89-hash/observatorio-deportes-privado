import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFixture, parseFootballCsv, parseUpcomingCsv, parseOpenFootball } from './server.mjs';

test('imports Football-Data columns, quoted names, dates and missing statistics', () => {
  const csv = [
    'Date;HomeTeam;AwayTeam;FTHG;FTAG;HS;AS;HST;AST;HF;AF;HC;AC;HY;AY;HR;AR',
    '09/08/26;"Atlético; Norte";Sur;2;1;11;8;4;-1;13;12;6;3;2;1;0;0',
  ].join('\r\n');
  const imported = parseFootballCsv(csv, { leagueName: 'Liga Prueba', season: 2026 });
  assert.equal(imported.matches.length, 1);
  const match = imported.matches[0];
  assert.equal(match.home, 'Atlético; Norte');
  assert.equal(match.date, '2026-08-10T04:59:59.999Z');
  assert.equal(match.stats.home.shotsOnTarget, 4);
  assert.equal(match.stats.away.shotsOnTarget, null);
  assert.equal(match.stats.home.red, 0);
});

test('normalizes API-Football fixture detail without inventing absent fields', () => {
  const match = normalizeFixture({
    fixture: { id: 123, date: '2026-08-09T20:00:00+00:00', status: { short: 'FT' } },
    league: { season: 2026 },
    teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
    goals: { home: 1, away: 0 },
    score: { halftime: { home: 0, away: 0 } },
    statistics: [
      { team: { id: 1, name: 'Norte' }, statistics: [{ type: 'Shots on Goal', value: 5 }, { type: 'Corner Kicks', value: 7 }] },
      { team: { id: 2, name: 'Sur' }, statistics: [{ type: 'Shots on Goal', value: null }, { type: 'Corner Kicks', value: 2 }] },
    ],
  }, 'api:10');
  assert.equal(match.stats.home.shotsOnTarget, 5);
  assert.equal(match.stats.home.corners, 7);
  assert.equal(match.stats.home.fouls, null);
  assert.equal(match.stats.away.shotsOnTarget, null);
  assert.equal(match.stats.away.corners, 2);
  assert.equal(match.statsChecked, true);
  assert.deepEqual(match.halfTime, { homeGoals: 0, awayGoals: 0, homeCorners: null, awayCorners: null });
});

test('imports offsides and reds from CSV without replacing missing fields with zeros', () => {
  const csv = [
    'date,home,away,home_goals,away_goals,home_offsides,away_offsides,home_red,away_red',
    '2026-08-01,Norte,Sur,2,1,3,0,1,0',
    '2026-08-02,Norte,Sur,1,1,,-1,,',
  ].join('\n');
  const [valid, missing] = parseFootballCsv(csv, { leagueName: 'Prueba', season: 2026 }).matches;
  assert.equal(valid.stats.home.offsides, 3);
  assert.equal(valid.stats.away.offsides, 0);
  assert.equal(valid.stats.home.red, 1);
  assert.equal(valid.stats.away.red, 0);
  assert.equal(missing.stats.home.offsides, null);
  assert.equal(missing.stats.away.offsides, null);
  assert.equal(missing.stats.home.red, null);
  const spanish = parseFootballCsv('fecha,local,visitante,goleslocal,golesvisitante,fuera_de_juego_local,fuera_de_juego_visitante,rojaslocal,rojasvisitante\n2026-08-01,Norte,Sur,2,1,2,4,0,1', {
    leagueName: 'Prueba', season: 2026,
  }).matches[0];
  assert.equal(spanish.stats.home.offsides, 2);
  assert.equal(spanish.stats.away.offsides, 4);
});

test('normalizes explicit API offsides and reds, preserving incomplete coverage', () => {
  const match = normalizeFixture({
    fixture: { id: 124, date: '2026-08-09T20:00:00Z', status: { short: 'FT' } },
    league: { season: 2026 },
    teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
    goals: { home: 1, away: 0 },
    statistics: [
      { team: { id: 1 }, statistics: [{ type: 'Offsides', value: 2 }, { type: 'Red Cards', value: 0 }] },
      { team: { id: 2 }, statistics: [{ type: 'Offsides', value: null }, { type: 'Red Cards', value: 1 }] },
    ],
  }, 'api:10');
  assert.equal(match.stats.home.offsides, 2);
  assert.equal(match.stats.away.offsides, null);
  assert.equal(match.stats.home.red, 0);
  assert.equal(match.stats.away.red, 1);
  assert.equal(match.stats.home.yellow, null);
});

test('imports the MLS and Liga MX goal-only column format without invented statistics', () => {
  const csv = 'Country,League,Season,Date,Time,Home,Away,HG,AG,Res\nUSA,MLS,2026,02/10/2026,02:30,Seattle,KC,2,1,H';
  const imported = parseFootballCsv(csv, { leagueName: 'MLS', season: 2026 });
  const match = imported.matches[0];
  assert.equal(match.date, '2026-10-02T01:30:00.000Z');
  assert.equal(match.homeGoals, 2);
  assert.equal(match.awayGoals, 1);
  assert.equal(match.stats.home.corners, null);
  assert.equal(match.stats.home.yellow, null);
  assert.equal(match.stats.home.shotsOnTarget, null);
  assert.deepEqual(match.halfTime, { homeGoals: null, awayGoals: null, homeCorners: null, awayCorners: null });
});

test('imports explicit first-half scores and corners without substituting full-time totals', () => {
  const official = parseFootballCsv('Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HC,AC\n02/08/26,Norte,Sur,2,1,0,1,8,5', {
    leagueName: 'Prueba', season: 2026,
  }).matches[0];
  assert.deepEqual(official.halfTime, { homeGoals: 0, awayGoals: 1, homeCorners: null, awayCorners: null });
  const manual = parseFootballCsv('date,home,away,home_goals,away_goals,home_half_goals,away_half_goals,home_half_corners,away_half_corners\n2026-08-02,Norte,Sur,2,1,1,0,3,2', {
    leagueName: 'Prueba', season: 2026,
  }).matches[0];
  assert.deepEqual(manual.halfTime, { homeGoals: 1, awayGoals: 0, homeCorners: 3, awayCorners: 2 });
  const spanish = parseFootballCsv('fecha,local,visitante,goleslocal,golesvisitante,goleslocal1t,golesvisitante1t,cornerslocal1t,cornersvisitante1t\n2026-08-02,Norte,Sur,2,1, ,0,-1,2', {
    leagueName: 'Prueba', season: 2026,
  }).matches[0];
  assert.deepEqual(spanish.halfTime, { homeGoals: null, awayGoals: 0, homeCorners: null, awayCorners: 2 });
});

test('imports structured Colombian archive without inventing unplayed results or half-time scores', () => {
  const raw = JSON.stringify({ name: 'Colombia Primera A 2025', matches: [
    { date: '2025-02-01', time: '19:30', team1: 'Norte', team2: 'Sur', score: { ft: [2, 1], ht: [0, 1] } },
    { date: '2025-02-02', team1: 'Norte', team2: 'Sur', score: { ft: [0, 0] } },
    { date: '2025-02-03', team1: 'Norte', team2: 'Sur' },
    { date: '2026-02-04', team1: 'Norte', team2: 'Sur', score: { ft: [2, 1] } },
    { date: '2025-02-05', team1: 'Norte', team2: 'Sur', score: { ft: [null, 1] } },
  ] });
  const options = { format: 'json', datasetName: 'Colombia Primera A 2025', leagueName: 'Colombia', season: '2025', timeZone: 'America/Bogota' };
  const parsed = parseOpenFootball(raw, options);
  assert.equal(parsed.matches.length, 2);
  assert.equal(parsed.skipped, 3);
  assert.equal(parsed.matches[0].date, '2025-02-02T00:30:00.000Z');
  assert.equal(parsed.matches[0].halfTime.homeGoals, 0);
  assert.equal(parsed.matches[1].halfTime.homeGoals, null);
  assert.equal(parsed.matches[0].stats.home.corners, null);
  assert.throws(() => parseOpenFootball('<html>error</html>', options), /JSON válido/);
  assert.throws(() => parseOpenFootball(raw, { ...options, datasetName: 'Otra liga' }), /no corresponde/);
});

test('imports the Ecuador Football.TXT archive with explicit dates, scores and optional half-time scores', () => {
  const raw = [
    '= Ecuador Serie A 2025', '# Matches 4', '', '▪ Matchday 1', '  Fri Feb 14 2025',
    '    19:00 Manta v Barcelona 2-3 (1-1)',
    '  Sat Feb 15', '    14:00 Aucas v Técnico Universitario 0-0',
    '  Sun Mar 2', '    LDU Quito v Orense SC 4-0 (0-0)',
    '  Sun Sep 28', '    Orense SC v Emelec',
  ].join('\n');
  const options = { format: 'football-txt', datasetName: 'Ecuador Serie A 2025', leagueName: 'Ecuador', season: '2025', timeZone: 'America/Guayaquil' };
  const parsed = parseOpenFootball(raw, options);
  assert.equal(parsed.matches.length, 3);
  assert.equal(parsed.matches[0].date, '2025-02-15T00:00:00.000Z');
  assert.equal(parsed.matches[0].home, 'Manta');
  assert.deepEqual(parsed.matches[0].halfTime, { homeGoals: 1, awayGoals: 1, homeCorners: null, awayCorners: null });
  assert.equal(parsed.matches[1].halfTime.homeGoals, null);
  assert.equal(parsed.matches[2].date, '2025-03-03T04:59:59.999Z');
  assert.equal(parsed.matches[2].halfTime.homeGoals, 0);
  assert.throws(() => parseOpenFootball(raw.replace('Fri Feb 14 2025', 'Fri Feb 14 2026'), options), /Fecha inesperada/);
  assert.throws(() => parseOpenFootball(raw.replace('2-3 (1-1)', '2-3 (extra)'), options), /Formato de marcador inesperado/);
});

test('imports the partial Paraguayan archive without treating unscored Clausura rows as upcoming fixtures', () => {
  const raw = [
    '= Paraguay Primera Division 2025', '# Stages Apertura (132) Clausura (6)',
    '  Fri Jan 24 2025', '    18:00 Sportivo Trinidense v Sportivo Ameliano 1-2 (0-1)',
    '  Sat Jan 25', '    09:00 2 de Mayo v Club Nacional 0-0',
    '  Sun May 4', '    19:15 Libertad v Atlético Tembetary 0-0',
    '  Fri Jul 4', '    Sportivo Ameliano v Atlético Tembetary',
  ].join('\n');
  const parsed = parseOpenFootball(raw, {
    format: 'football-txt', datasetName: 'Paraguay Primera Division 2025',
    leagueName: 'Primera División Paraguay', season: '2025', timeZone: 'America/Asuncion',
  });
  assert.equal(parsed.matches.length, 3);
  assert.equal(parsed.matches[0].date, '2025-01-24T21:00:00.000Z');
  assert.equal(parsed.matches[2].date, '2025-05-04T22:15:00.000Z');
  assert.equal(parsed.matches[1].home, '2 de Mayo');
  assert.deepEqual(parsed.matches[0].halfTime, { homeGoals: 0, awayGoals: 1, homeCorners: null, awayCorners: null });
  assert.equal(parsed.matches[1].halfTime.homeGoals, null);
  assert.ok(parsed.matches.every(match => match.stats.home.corners === null && match.stats.away.shotsOnTarget === null));
});

test('CSV dates use the source timezone and missing hours stay after the local day', () => {
  const header = 'Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HST,AST';
  const row = (date, time) => `${date},${time},Norte,Sur,1,0, ,3`;
  const london = parseFootballCsv([header, row('05/10/26', '19:45')].join('\n'), {
    leagueName: 'Premier League', season: '2026/2027', timeZone: 'Europe/London',
  });
  assert.equal(london.matches[0].date, '2026-10-05T18:45:00.000Z');
  const auto = parseFootballCsv([header, row('05/10/26', '19:45')].join('\n'), { leagueName: 'Premier League', season: '2026/2027' });
  assert.equal(auto.matches[0].date, london.matches[0].date);
  assert.equal(london.matches[0].stats.home.shotsOnTarget, null);
  const local = parseFootballCsv([header, row('05/10/26', '19:45')].join('\n'), {
    leagueName: 'Manual', season: 2026, timeZone: 'America/Guayaquil',
  });
  assert.equal(local.matches[0].date, '2026-10-06T00:45:00.000Z');
  const unknownHour = parseFootballCsv([header, row('05/10/26', '')].join('\n'), {
    leagueName: 'Manual', season: 2026,
  });
  assert.equal(unknownHour.matches[0].date, '2026-10-06T04:59:59.999Z');
  const iso = parseFootballCsv([header, row('2026-10-05T19:45:12-05:00', '')].join('\n'), {
    leagueName: 'Manual', season: 2026,
  });
  assert.equal(iso.matches[0].date, '2026-10-06T00:45:12.000Z');
  const upcoming = parseUpcomingCsv('Date,Time,HomeTeam,AwayTeam\n01/05/27,19:45,Norte,Sur', {
    leagueKey: 'csv:manual', season: 2026,
  });
  assert.equal(upcoming[0].date, '2027-05-02T00:45:00.000Z');
});

test('blank scores do not become zero and extra-time matches use 90-minute scores only', () => {
  const csv = 'Date,HomeTeam,AwayTeam,FTHG,FTAG\n01/08/26,Norte,Sur, ,1\n02/08/26,Norte,Sur,1,0';
  const imported = parseFootballCsv(csv, { leagueName: 'Manual', season: 2026 });
  assert.equal(imported.matches.length, 1);
  assert.equal(imported.skipped, 1);
  const fixture = {
    fixture: { id: 456, date: '2026-08-09T20:00:00+00:00', status: { short: 'AET' } },
    league: { season: 2026 },
    teams: { home: { id: 1, name: 'Norte' }, away: { id: 2, name: 'Sur' } },
    goals: { home: 2, away: 1 },
    score: { fulltime: { home: 1, away: 1 } },
    statistics: [{ team: { id: 1 }, statistics: [{ type: 'Corner Kicks', value: 7 }] }],
  };
  const normalized = normalizeFixture(fixture, 'api:10');
  assert.equal(normalized.homeGoals, 1);
  assert.equal(normalized.awayGoals, 1);
  assert.equal(normalized.stats.home.corners, null);
  assert.equal(normalized.statsChecked, true);
  assert.equal(normalizeFixture({ ...fixture, score: { fulltime: { home: null, away: 1 } } }, 'api:10'), null);
});
