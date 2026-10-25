import { count, localDay, regularNba } from './basketball-data.mjs';

const DAY = 86400000;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const nameKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = { barcelona: 'fcbarcelona', partizanbelgrade: 'partizan', partizandebelgrado: 'partizan', olympiakos: 'olympiacos', asvelvilleurbanne: 'asvel' };
const teamKey = name => aliases[nameKey(name)] || nameKey(name);
const identity = game => `${game.league}:${game.season}:${localDay(game.date)}:${teamKey(game.home)}:${teamKey(game.away)}`;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function weekRange(startDate, endDate, now) {
  const today = localDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((weekday + 6) % 7) * DAY);
  startDate ??= monday.toISOString().slice(0, 10);
  endDate ??= new Date(monday.valueOf() + 6 * DAY).toISOString().slice(0, 10);
  if (!validDate(startDate) || !validDate(endDate)) throw new Error('Fechas de consulta no validas.');
  const start = Date.parse(`${startDate}T00:00:00-05:00`), end = Date.parse(`${endDate}T00:00:00-05:00`) + DAY;
  if (end <= start || end - start > 31 * DAY) throw new Error('Selecciona un periodo entre 1 y 31 dias.');
  return { startDate, endDate, start, end, timeZone: 'America/Guayaquil' };
}

function period(game, key) {
  const home = count(key === 'ft' ? game.homePoints : game.stats?.home?.[key]);
  const away = count(key === 'ft' ? game.awayPoints : game.stats?.away?.[key]);
  return { home, away, total: home !== null && away !== null ? home + away : null };
}

export function buildWeekReport({ league, season, startDate, endDate, now, matches = [], fixtures = [], players = [], references = {} }) {
  const range = weekRange(startDate, endDate, now), current = Date.parse(now);
  const eligible = game => game.league === league && game.season === season && Number.isFinite(Date.parse(game.date)) &&
    (league !== 'nba' || regularNba(game.date, season, game.phase || game.status || '') && !game.preseason && game.seasonType !== 1);
  // Club references are observational only. They never enter the service's model inputs or saved trial.
  const byIdentity = new Map();
  for (const game of [...(references.games || []), ...fixtures, ...matches]) {
    if (!eligible(game)) continue;
    const key = identity(game), previous = byIdentity.get(key);
    if (previous?.finished && !game.finished) continue;
    byIdentity.set(key, { ...game });
  }
  const inRange = game => Date.parse(game.date) >= range.start && Date.parse(game.date) < range.end;
  const finished = [...byIdentity.values()].filter(game => inRange(game) && game.finished === true && Date.parse(game.date) < current && period(game, 'ft').total !== null);
  const upcoming = [...byIdentity.values()].filter(game => inRange(game) && !game.finished && Date.parse(game.date) > current).sort((a, b) => a.date.localeCompare(b.date));
  const completed = finished.sort((a, b) => b.date.localeCompare(a.date)).map(game => ({ ...game,
    periods: { ft: period(game, 'ft'), q1: period(game, 'firstQuarterPoints'), ht: period(game, 'halfTimePoints') } }));
  const totals = Object.fromEntries(['ft', 'q1', 'ht'].map(key => {
    const values = completed.map(game => game.periods[key].total).filter(value => value !== null);
    return [key, { average: average(values), n: values.length, missing: completed.length - values.length }];
  }));
  const teams = [...new Set(completed.flatMap(game => [game.home, game.away]))].sort((a, b) => a.localeCompare(b, 'es')).map(team => {
    const games = completed.filter(game => [game.home, game.away].includes(team));
    const periods = Object.fromEntries(['ft', 'q1', 'ht'].map(key => {
      const sample = games.filter(game => game.periods[key].total !== null);
      const value = (game, opponent) => game.periods[key][(game.home === team) !== opponent ? 'home' : 'away'];
      return [key, { scored: average(sample.map(game => value(game, false))), conceded: average(sample.map(game => value(game, true))), n: sample.length, missing: games.length - sample.length }];
    }));
    const wins = games.filter(game => game.periods.ft[game.home === team ? 'home' : 'away'] > game.periods.ft[game.home === team ? 'away' : 'home']).length;
    return { team, games: games.length, wins, losses: games.length - wins, periods };
  });
  const originalGames = new Map([...(references.games || []), ...matches].filter(eligible).map(game => [String(game.id), game]));
  const completedByKey = new Map(completed.map(game => [identity(game), game])), playerRows = new Map();
  const connectedPlayerGames = new Set(players.filter(record => record.league === league && record.season === season && originalGames.has(String(record.matchId)))
    .map(record => identity(originalGames.get(String(record.matchId)))));
  for (const record of [...(references.players || []).map(row => ({ ...row, referenceOnly: true })), ...players]) {
    const original = originalGames.get(String(record.matchId));
    if (!original || !record.referenceOnly && (record.league !== league || record.season !== season)) continue;
    const game = completedByKey.get(identity(original));
    if (!game || ![game.home, game.away].some(team => teamKey(team) === teamKey(record.team))) continue;
    if (record.referenceOnly && connectedPlayerGames.has(identity(game))) continue;
    const values = Object.fromEntries(['points', 'rebounds', 'assists', 'threes'].map(key => [key, count(record.values?.[key])]));
    values.pra = ['points', 'rebounds', 'assists'].every(key => values[key] !== null) ? values.points + values.rebounds + values.assists : null;
    const side = teamKey(game.home) === teamKey(record.team) ? 'home' : 'away';
    const minutes = record.minutes !== null && record.minutes !== undefined && record.minutes !== '' && Number.isFinite(Number(record.minutes)) && Number(record.minutes) > 0 ? Number(record.minutes) : null;
    playerRows.set(`${identity(game)}:${teamKey(record.team)}:${nameKey(record.name)}`, { ...record, values, minutes,
      date: game.date, timeKnown: game.timeKnown, team: game[side], opponent: game[side === 'home' ? 'away' : 'home'],
      source: record.source || original.source, sourceUrl: record.sourceUrl || original.sourceUrl, reviewedOn: record.reviewedOn || original.reviewedOn });
  }
  const rows = [...playerRows.values()].sort((a, b) => b.date.localeCompare(a.date) || (b.values.points ?? -1) - (a.values.points ?? -1));
  return { league, season, range, generatedAt: now, completed, upcoming, teams, players: rows, totals,
    coverage: { complete: false, referenceGames: completed.filter(game => game.referenceOnly).length,
      storedGames: completed.filter(game => !game.referenceOnly).length, referencePlayers: rows.filter(row => row.referenceOnly).length,
      reviewedOn: league === 'euroleague' ? references.reviewedOn || null : null,
      notice: `Cobertura parcial: solo registros guardados y referencias disponibles. ${league === 'euroleague' ? references.notice || '' : league === 'nba' ? 'NBA regular; se excluye pretemporada.' : 'Liga Endesa: muestra separada de NBA y Euroliga, sin modelo predictivo validado.'} Promedios descriptivos de la muestra, no probabilidades. Cero registros no significa que no haya partidos.` } };
}
