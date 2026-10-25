import { normalizeNbaPeriods } from './nba.mjs';
import { normalizeApiShooting, shootingConvention } from './public/basketball-player-metrics.js';
export const count = value => value !== '' && value !== null && value !== undefined && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const name = value => String(value || '').trim();
const nbaNames = { 'LA Clippers': 'LA Clippers', 'Los Angeles Clippers': 'LA Clippers', 'LA Lakers': 'Los Angeles Lakers', 'Golden State': 'Golden State Warriors' };
export const teamName = (value, league) => league === 'nba' ? nbaNames[name(value)] || name(value) : name(value);
export const localDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
export function basketballSeason(value) {
  const parts = /^(\d{4})(?:[-/](\d{4}))?$/.exec(String(value ?? ''));
  if (!parts || parts[2] && Number(parts[2]) !== Number(parts[1]) + 1) return null;
  return `${parts[1]}/${Number(parts[1]) + 1}`;
}
export const gameKey = game => `${new Date(game.date).toISOString()}:${game.home}:${game.away}`;
const REGULAR = {
  '2025/2026': ['2025-10-21T05:00:00Z', '2026-04-13T05:00:00Z'],
  '2026/2027': ['2026-10-20T05:00:00Z', '2027-04-12T05:00:00Z'],
};
const CUP_FINAL = { '2025/2026': '2025-12-16', '2026/2027': '2026-12-11' };
export function regularNba(date, season, phase = '') {
  const window = REGULAR[season];
  return Boolean(window && date >= window[0] && date < window[1] && localDay(date) !== CUP_FINAL[season] &&
    !/pre.?season|play.?in|playoff|all.?star|final.*cup|cup.*final|championship/i.test(phase));
}
export function parseBasketballGames(payload, { league, season, leagueId, now = new Date().toISOString() }) {
  if (!Array.isArray(payload?.response)) throw new Error('La fuente no devolvio una lista valida de encuentros.');
  const matches = [], fixtures = []; let skipped = 0;
  for (const row of payload.response) {
    const date = row.date && Number.isFinite(Date.parse(row.date)) && /(?:Z|[+-]\d\d:\d\d)$/.test(row.date) ? new Date(row.date).toISOString() : null;
    const home = teamName(row.teams?.home?.name, league), away = teamName(row.teams?.away?.name, league);
    const phase = typeof row.stage === 'string' ? row.stage : row.stage?.name || '';
    if (!date || !home || !away || home === away || !row.id || row.league?.id !== leagueId ||
      basketballSeason(row.league?.season) !== season || league === 'nba' && !regularNba(date, season, phase)) { skipped++; continue; }
    const short = row.status?.short;
    const game = { id: `api-basketball:${row.id}`, apiId: row.id, date, season, league, home, away,
      homeId: row.teams.home.id, awayId: row.teams.away.id, homeLogo: row.teams.home.logo, awayLogo: row.teams.away.logo,
      seasonType: 2, source: 'API-Basketball', status: short, preseason: false };
    if (['FT', 'AOT'].includes(short) && date < now) {
      const homePoints = count(row.scores?.home?.total), awayPoints = count(row.scores?.away?.total);
      if (!homePoints || !awayPoints || homePoints === awayPoints) { skipped++; continue; }
      Object.assign(game, { homePoints, awayPoints, finished: true, status: 'Final', overtime: short === 'AOT', stats: {} });
      for (const side of ['home', 'away']) {
        const scores = row.scores[side], q1 = count(scores.quarter_1), q2 = count(scores.quarter_2);
        game.stats[side] = normalizeNbaPeriods({ firstQuarterPoints: q1,
          halfTimePoints: q1 !== null && q2 !== null ? q1 + q2 : null }, game[`${side}Points`]);
      }
      matches.push(game);
    } else if (short === 'NS' && date > now) fixtures.push(game);
    else skipped++;
  }
  return { matches, fixtures, skipped };
}
export function attachTeamStats(payload, game) {
  if (!Array.isArray(payload?.response)) throw new Error('Sin estadisticas de equipos validas.');
  const rows = payload.response.filter(row => String(row.game?.id) === String(game.apiId));
  let added = 0;
  for (const side of ['home', 'away']) {
    const row = rows.find(row => row.team?.id === game[`${side}Id`]);
    if (!row) continue;
    const fields = { rebounds: row.rebounds?.total, assists: row.assists, threePointersMade: row.threepoint_goals?.total,
      fieldGoalsAttempted: row.field_goals?.attempts, freeThrowsAttempted: row.freethrows_goals?.attempts,
      offensiveRebounds: row.rebounds?.offence, turnovers: row.turnovers };
    game.stats ||= {}; game.stats[side] ||= {};
    Object.assign(game.stats[side], Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, count(value)]))); added++;
  }
  return added;
}
export function parsePlayerStats(payload, game) {
  if (!Array.isArray(payload?.response)) throw new Error('Sin estadisticas individuales validas.');
  const result = [];
  const rawShooting = row => ({ points: count(row.points), threes: count(row.threepoint_goals?.total), fieldGoalsMade: count(row.field_goals?.total),
    fieldGoalsAttempted: count(row.field_goals?.attempts), threesAttempted: count(row.threepoint_goals?.attempts),
    freeThrowsMade: count(row.freethrows_goals?.total), freeThrowsAttempted: count(row.freethrows_goals?.attempts) });
  const definitions = new Set(payload.response.filter(row => String(row.game?.id) === String(game.apiId) && [game.homeId, game.awayId].includes(row.team?.id)).map(row => shootingConvention(rawShooting(row))).filter(Boolean));
  const hint = definitions.size === 1 ? [...definitions][0] : null;
  for (const row of payload.response) {
    const side = ['home', 'away'].find(side => row.team?.id === game[`${side}Id`]);
    if (!side || String(row.game?.id) !== String(game.apiId) || !row.player?.id || !name(row.player?.name)) continue;
    let minutes = null;
    if (/^\d+:\d{2}$/.test(String(row.minutes))) { const [m, s] = row.minutes.split(':').map(Number); if (s < 60) minutes = m + s / 60; }
    else if (row.minutes !== '' && row.minutes != null && Number.isFinite(Number(row.minutes))) minutes = Number(row.minutes);
    if (minutes === null || minutes <= 0 || minutes > 80) continue;
    const points = count(row.points), rebounds = count(row.rebounds?.total), assists = count(row.assists), threes = count(row.threepoint_goals?.total);
    result.push({ id: `basketball:${game.league}:${game.id}:${row.player.id}`, matchId: game.id, apiPlayerId: row.player.id,
      sport: game.league === 'nba' ? 'nba' : 'basketball', league: game.league, name: name(row.player.name), team: game[side], opponent: game[side === 'home' ? 'away' : 'home'],
      date: game.date, season: game.season, venue: side, minutes, starter: row.type === 'starters', source: 'API-Basketball',
      shooting: normalizeApiShooting(rawShooting(row), hint),
      values: { points, rebounds, assists, threes, pra: [points, rebounds, assists].every(value => value !== null) ? points + rebounds + assists : null } });
  }
  return result;
}
