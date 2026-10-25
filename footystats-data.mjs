import { FOOTYSTATS_COMPETITIONS, footystatsSeason } from './footystats-competitions.mjs';

const integer = value => {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object' || String(value).trim() === '') return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const fields = { shots: 'shots', shotsOnTarget: 'shotsOnTarget', corners: 'corners', fouls: 'fouls', yellow: 'yellow_cards', red: 'red_cards', offsides: 'offsides' };

export function normalizeFootystatsMatch(row, target, season, { now = new Date(), clean = value => String(value ?? '').slice(0, 150) } = {}) {
  const id = integer(row?.id), timestamp = integer(row?.date_unix);
  if (!id || !timestamp || integer(row.competition_id) !== season.id) return null;
  const home = clean(row.home_name).trim(), away = clean(row.away_name).trim();
  if (!home || !away || home.toLowerCase() === away.toLowerCase()) return null;
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const base = { id: `footystats:${id}`, providerId: id, leagueKey: target.key, season: footystatsSeason(season.year),
    date: date.toISOString(), home, away, homeId: integer(row.homeID), awayId: integer(row.awayID), source: 'FootyStats' };
  if (row.status === 'incomplete' && date > now) return { ...base, status: 'NS' };
  if (row.status !== 'complete' || date > now) return null;
  const homeGoals = integer(row.homeGoalCount), awayGoals = integer(row.awayGoalCount);
  if (homeGoals === null || awayGoals === null) return null;
  const goalTimings = [...(Array.isArray(row.homeGoals) ? row.homeGoals : []), ...(Array.isArray(row.awayGoals) ? row.awayGoals : [])];
  // Unseparated extra-time statistics must not enter regulation-time markets.
  if (row.extra_time === true || row.extraTime === true || goalTimings.some(value => /^\d+$/.test(String(value)) && Number(value) > 90)) return null;
  const stats = Object.fromEntries(['home', 'away'].map((side, index) => [side, Object.fromEntries(
    Object.entries(fields).map(([field, suffix]) => [field, integer(row[`team_${index ? 'b' : 'a'}_${suffix}`])]))]));
  for (const side of ['home', 'away']) if (stats[side].shots !== null && stats[side].shotsOnTarget > stats[side].shots) stats[side].shotsOnTarget = null;
  let halfGoals = [integer(row.ht_goals_team_a), integer(row.ht_goals_team_b)];
  if (halfGoals.some((value, index) => value === null || value > [homeGoals, awayGoals][index]) ||
      (row.HTGoalCount !== undefined && (integer(row.HTGoalCount) === null || integer(row.HTGoalCount) !== halfGoals[0] + halfGoals[1]))) halfGoals = [null, null];
  let halfCorners = integer(row.corner_timings_recorded) > 0 ? [integer(row.team_a_fh_corners), integer(row.team_b_fh_corners)] : [null, null];
  if (halfCorners.some((value, index) => value === null || ([stats.home.corners, stats.away.corners][index] !== null && value > [stats.home.corners, stats.away.corners][index]))) halfCorners = [null, null];
  return { ...base, status: 'FT', finished: true, homeGoals, awayGoals, stats, statsChecked: true,
    availableAt: new Date(date.getTime() + 3 * 3600000).toISOString(),
    halfTime: { homeGoals: halfGoals[0], awayGoals: halfGoals[1], homeCorners: halfCorners[0], awayCorners: halfCorners[1] } };
}

export function ensureFootystatsLeagues(store) {
  for (const target of FOOTYSTATS_COMPETITIONS) if (!store.leagues[target.key]) store.leagues[target.key] = {
    key: target.key, name: target.name, country: target.country, source: 'FootyStats', seasons: [], teamsBySeason: {}, fixturesBySeason: {},
    sourceUrl: 'https://footystats.org/api/documentations', coverageNote: 'FootyStats: sin historial autorizado descargado. No se usan otras fuentes para rellenar esta competicion.' };
}

export function importFootystatsSeason(store, target, season, rows, players, { now = new Date(), clean } = {}) {
  ensureFootystatsLeagues(store);
  const normalized = rows.map(row => normalizeFootystatsMatch(row, target, season, { now, clean })).filter(Boolean);
  const finished = normalized.filter(row => row.finished), upcoming = normalized.filter(row => row.status === 'NS');
  const label = footystatsSeason(season.year), league = store.leagues[target.key];
  const existing = new Map(store.matches.map(row => [`${row.leagueKey}|${row.id}`, row]));
  for (const row of finished) existing.set(`${row.leagueKey}|${row.id}`, row);
  store.matches = [...existing.values()];
  league.seasons = [...new Set([...league.seasons, label])].sort().reverse();
  league.teamsBySeason[label] = [...new Set(normalized.flatMap(row => [row.home, row.away]))].sort();
  league.fixturesBySeason[label] = upcoming;
  league.coverageNote = `Solo FootyStats / temporada ${label} / ${finished.length} resultados descargados. Los porcentajes del modelo se calculan en la app con este historial, no son probabilidades certificadas por FootyStats. Los campos ausentes quedan sin dato.`;
  return { results: finished.length, calendar: upcoming.length, players: players.length, skipped: rows.length - normalized.length, season: label };
}
