import { SportsError } from './sports.mjs';
import { availableTime } from './basketball-model.mjs';
import { eligibleNba } from './basketball-research.mjs';
import { BASKETBALL_PLAYER_METRICS, playerValues, shootingSummary, isCount, normalizeLegacyShooting } from './public/basketball-player-metrics.js';

const fail = message => { throw new SportsError(400, message); };
const identity = row => row.playerKey || (row.apiPlayerId ? `API-Basketball:${row.apiPlayerId}` : `${row.source || 'Guardado'}:${row.playerId || row.name}`);
const names = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));

export function createBasketballPlayerAnalysis({ read, now = () => new Date() }) {
  function context(body = {}) {
    const league = body.league || 'euroleague', season = body.season || '2026/2027', lookback = Number(body.lookback ?? 20);
    if (!['nba', 'euroleague', 'endesa'].includes(league) || !/^202[2-6]\/202[3-7]$/.test(season) || Number(season.slice(5)) !== Number(season.slice(0, 4)) + 1) fail('Competicion o temporada de jugadores no valida.');
    if (![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Historial no valido.');
    const time = Math.min(Date.parse(body.cutoff || now().toISOString()), now().getTime());
    if (!Number.isFinite(time)) fail('Corte no valido.');
    const venue = body.venue || 'all';
    if (!['all', 'home', 'away'].includes(venue)) fail('Condicion local/visitante no valida.');
    return { league, season, lookback, time, cutoff: new Date(time).toISOString(), venue, team: String(body.team || '') };
  }
  function records(config) {
    const saved = read(), games = saved.games.filter(game => game.league === config.league && !game.preseason && !game.referenceOnly);
    const rows = saved.players.filter(row => row.league === config.league && row.season <= config.season && row.date && !row.preseason && !row.referenceOnly &&
      (config.league !== 'nba' || eligibleNba(row.date, row.season, row.phase || 'Regular Season')) && availableTime(row) < config.time);
    const dedup = new Map();
    for (const row of normalizeLegacyShooting(rows)) {
      const game = games.find(game => game.id === row.matchId) || games.find(game => game.date === row.date && [game.home, game.away].includes(row.team) && [game.home, game.away].includes(row.opponent));
      if (game && (!game.finished || game.preseason)) continue;
      const venue = ['home', 'away'].includes(row.venue) ? row.venue : game ? game.home === row.team ? 'home' : 'away' : null;
      const playerKey = identity(row), key = `${playerKey}:${row.team}:${game?.id || row.matchId || `${row.date}:${row.opponent || ''}`}`;
      dedup.set(key, { ...row, playerKey, venue, values: playerValues(row) });
    }
    return [...dedup.values()].sort((a, b) => b.date.localeCompare(a.date));
  }
  function catalog(body) {
    const config = context(body), rows = records(config).filter(row => row.minutes > 0);
    const groups = new Map();
    for (const row of rows.filter(row => !config.team || row.team === config.team)) {
      const key = row.playerKey;
      if (!groups.has(key)) groups.set(key, { key, name: row.name, teams: [], seasons: [], n: 0 });
      const group = groups.get(key); group.teams.push(row.team); group.seasons.push(row.season); group.n++;
    }
    const players = [...groups.values()].map(row => ({ ...row, teams: names(row.teams), seasons: names(row.seasons) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const games = read().games.filter(game => game.league === config.league && game.season <= config.season && game.finished && !game.preseason && !game.referenceOnly &&
      (config.league !== 'nba' || eligibleNba(game.date, game.season, game.phase || 'Regular Season')) && availableTime(game) < config.time);
    const teams = names([...rows.map(row => row.team), ...games.flatMap(game => [game.home, game.away])]);
    const teamCoverage = teams.map(team => {
      const logs = rows.filter(row => row.team === team), matches = games.filter(game => [game.home, game.away].includes(team));
      return { team, players: new Set(logs.map(row => row.playerKey)).size, records: logs.length, seasons: names(logs.map(row => row.season)),
        gameSeasons: names(matches.map(game => game.season)), seasonGames: matches.filter(game => game.season === config.season).length };
    });
    return { ...config, teams, players, teamCoverage, coverage: { players: new Set(rows.map(row => row.playerKey)).size, records: rows.length,
      teams: teams.length, teamsWithPlayers: teamCoverage.filter(team => team.players > 0).length, seasons: names(rows.map(row => row.season)) } };
  }
  function analyze(body) {
    const config = context(body), all = records(config), key = body.playerKey;
    if (!key || !all.some(row => row.playerKey === key)) fail('Selecciona un jugador del historial de esta competicion.');
    const own = all.filter(row => row.playerKey === key), played = own.filter(row => row.minutes > 0);
    const teamRows = played.filter(row => !config.team || row.team === config.team);
    const history = teamRows.filter(row => config.venue === 'all' || row.venue === config.venue).slice(0, config.lookback);
    const metrics = Object.fromEntries(Object.keys(BASKETBALL_PLAYER_METRICS).map(metric => {
      const values = history.map(row => row.values[metric]).filter(isCount);
      return [metric, { n: values.length, missing: history.length - values.length, average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
    }));
    const newest = history[0]?.date || null, oldest = history.at(-1)?.date || null;
    const ageDays = newest ? Math.floor((config.time - Date.parse(newest)) / 86400000) : null;
    const teams = names(played.map(row => row.team)), seasons = names(history.map(row => row.season));
    const warnings = ['Frecuencias historicas, no probabilidades calibradas del siguiente partido. No acreditan disponibilidad ni plantilla actual.'];
    if (history.length < config.lookback) warnings.push(`Solo ${history.length} de ${config.lookback} participaciones solicitadas. No se completan con ceros ni con registros fuera del filtro.`);
    if (history.length < 10) warnings.push('Muestra pequena: menos de diez participaciones. Cada escenario muestra su propio denominador.');
    if (ageDays !== null && ageDays > 90) warnings.push(`Historial antiguo: ${ageDays} dias desde el ultimo registro de esta muestra.`);
    if (teams.length > 1) warnings.push('Hay registros en varios equipos. Filtra por club para separarlos; el ultimo club guardado no confirma el equipo actual.');
    if (seasons.some(season => season !== config.season)) warnings.push('La muestra incluye temporadas anteriores a la elegida.');
    const uncertainShots = history.filter(row => ['unverified', 'inconsistent'].includes(row.shooting?.basis)).length;
    if (uncertainShots) warnings.push(`${uncertainShots} registros con definicion de tiros de campo no verificada o inconsistente. Esos tiros quedan sin dato.`);
    const unknownVenue = teamRows.filter(row => !row.venue).length;
    if (config.venue !== 'all' && unknownVenue) warnings.push(`${unknownVenue} participaciones sin localia verificada excluidas por el filtro.`);
    return { ...config, playerKey: key, name: own[0].name, history, metrics, shooting: shootingSummary(history),
      quality: { n: history.length, availablePlayed: played.length, nonPlaying: own.filter(row => row.minutes === 0).length,
        unknownParticipation: own.filter(row => row.minutes == null).length, unknownVenue, teams, seasons, newest, oldest, ageDays, warnings },
      descriptive: true, modelChanged: false };
  }
  return { catalog, analyze, records: body => records(context(body)) };
}
