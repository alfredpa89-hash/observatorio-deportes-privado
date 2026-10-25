import { tennisValues, playerKey, completeScore } from './tennis-stats.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unique = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
const latest = values => values.filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
const pair = (a, b) => finite(a) && finite(b);
const logGame = row => String(row.matchId ?? row.fixtureId ?? row.eventId ?? `${row.date}:${row.team}:${row.opponent}`);
function footballDownload(store, league, season) {
  const division = league.key.split(':')[1], label = String(season);
  const code = /^\d{4}\/\d{4}$/.test(label) ? label.slice(2, 4) + label.slice(7, 9) : label;
  const cacheKey = league.source === 'api-football' ? `/fixtures?league=${league.id || division}&season=${season}` :
    league.source === 'Football-Data.co.uk' ? ['E0', 'E1', 'SP1', 'D1', 'I1', 'F1', 'N1', 'P1'].includes(division) ? `europe:${code}:${division}` : `extra:${division}` :
      league.source === 'OpenFootball' ? `openfootball:${division}:${season}` : null;
  const time = store.cache?.[cacheKey]?.savedAt;
  return Number.isFinite(time) ? new Date(time).toISOString() : league.source === 'FootyStats' ? latest(Object.values(store.footystatsResearch?.datasets || {}).filter(set => set.leagueKey === league.key && String(set.season) === label).map(set => set.downloadedAt)) : null;
}
function fields(rows, definitions) {
  return Object.entries(definitions).map(([id, [label, usable]]) => {
    const n = rows.filter(usable).length;
    return { id, label, n, total: rows.length, missing: rows.length - n, status: !rows.length ? 'sin_muestra' : !n ? 'sin_datos' : n === rows.length ? 'completo' : 'parcial' };
  });
}
function teamDepth(games, logs, identity) {
  return [...new Set(games.flatMap(row => [row.home, row.away]))].sort().map(team => {
    const history = games.filter(row => [row.home, row.away].includes(team)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const teamLogs = logs.filter(row => row.team === team), ids = new Set(teamLogs.map(logGame));
    return { team, games: history.length, target: 30, playerGames: history.filter(row => ids.has(String(row.id))).length,
      players: new Set(teamLogs.map(identity)).size, latest: latest(history.map(row => row.date)), latestPlayer: latest(teamLogs.map(row => row.date)) };
  });
}
function base(row, games, logs, now) {
  const currentYear = now.getUTCFullYear();
  return { ...row, historical: Number(String(row.season).slice(0, 4)) < currentYear, matches: games.length, records: logs.length,
    latestMatch: latest(games.map(row => row.date)), latestPlayer: latest(logs.map(row => row.date)),
    sources: [...new Set([...games, ...logs].map(row => row.source).filter(Boolean))],
    rosterStatus: 'participaciones_historicas_no_plantilla_actual', accessStatus: games.length ? 'guardado' : 'sin_descargar' };
}

export function buildDataCoverage(store, basketballData = { games: [], players: [], availability: [] }, now = new Date()) {
  const result = [];
  const allBasketGames = unique(basketballData.games || [], row => `${row.league}:${row.season}:${row.id}`);
  for (const league of ['nba', 'euroleague', 'endesa']) {
    const seasons = [...new Set(['2026/2027', ...allBasketGames.filter(row => row.league === league).map(row => row.season)])].sort().reverse();
    for (const season of seasons) {
      const games = allBasketGames.filter(row => row.league === league && row.season === season && row.finished && row.date < now.toISOString());
      const logs = unique((basketballData.players || []).filter(row => row.league === league && row.season === season && row.minutes > 0), row => `${logGame(row)}:${row.team}:${row.playerKey || `${row.source}:${row.apiPlayerId || row.playerId || row.name}`}`);
      const calendar = allBasketGames.filter(row => row.league === league && row.season === season && !row.finished && row.date > now.toISOString());
      const row = base({ sport: 'basketball', key: league, name: { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa' }[league], season,
        downloadedAt: latest([...games.map(row => row.fetchedAt), ...logs.map(row => row.fetchedAt), store.basketball?.datasets?.[league]?.[season]?.loadedAt,
          league === 'nba' ? store.sports?.nba?.datasets?.[season]?.loadedAt : null]), fixtures: calendar.length }, games, logs, now);
      row.sources = [...new Set([...row.sources, ...calendar.map(game => game.source)].filter(Boolean))];
      if (calendar.length && !games.length) row.accessStatus = 'calendario_guardado_sin_resultados';
      row.fields = fields(games, {
        points: ['Puntos y ganador', game => pair(game.homePoints, game.awayPoints)],
        quarters: ['Cuartos de equipos', game => ['home', 'away'].every(side => ['q1', 'q2', 'q3', 'q4'].every(q => finite(game.periods?.[side]?.[q])))],
        halfTime: ['Puntos al descanso', game => ['home', 'away'].every(side => finite(game.periods?.[side]?.ht ?? game.stats?.[side]?.halfTimePoints))] });
      row.playerFields = fields(logs, Object.fromEntries(['points', 'rebounds', 'assists', 'pra', 'threes'].map(id => [id, [{ points: 'Puntos', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA', threes: 'Triples' }[id], log => finite(log.values?.[id])]])));
      row.playerFields.push(...fields(logs, { minutes: ['Minutos', log => finite(log.minutes)], quarters: ['Individuales por cuarto', log => ['q1', 'q2', 'q3', 'q4'].every(q => finite(log.periods?.[q]?.points))] }));
      row.teams = teamDepth(games, logs, log => log.playerKey || `${log.source}:${log.apiPlayerId || log.playerId || log.name}`);
      row.reports = (basketballData.availability || []).filter(report => report.league === league && report.publishedAt <= now.toISOString() && report.expiresAt > now.toISOString()).length;
      result.push(row);
    }
  }
  for (const league of Object.values(store.leagues || {})) for (const season of league.seasons?.length ? league.seasons : ['Sin temporada']) {
    const games = unique((store.matches || []).filter(row => row.leagueKey === league.key && String(row.season) === String(season) && row.date < now.toISOString()), row => String(row.id));
    const logs = unique((store.playerLogs || []).filter(row => row.sport === 'football' && row.leagueKey === league.key && String(row.season) === String(season) && row.minutes > 0), row => row.id);
    const row = base({ sport: 'football', key: league.key, name: league.name, season: String(season), downloadedAt: footballDownload(store, league, season),
      fixtures: (league.fixturesBySeason?.[season] || []).filter(row => row.date > now.toISOString()).length }, games, logs, now);
    row.sources = [...new Set([league.source, ...row.sources].filter(Boolean))];
    row.fields = fields(games, { goals: ['Goles y resultado', game => pair(game.homeGoals, game.awayGoals)],
      halfGoals: ['Goles 1T', game => pair(game.halfTime?.homeGoals, game.halfTime?.awayGoals)],
      halfCorners: ['Corners 1T', game => pair(game.halfTime?.homeCorners, game.halfTime?.awayCorners)],
      ...Object.fromEntries(['corners', 'offsides', 'fouls', 'shots', 'shotsOnTarget', 'yellow', 'red'].map(id => [id, [{ corners: 'Corners', offsides: 'Fueras de juego', fouls: 'Faltas', shots: 'Tiros', shotsOnTarget: 'Tiros al arco', yellow: 'Amarillas', red: 'Rojas' }[id], game => ['home', 'away'].every(side => finite(game.stats?.[side]?.[id]))]])) });
    row.playerFields = fields(logs, Object.fromEntries(['goals', 'assists', 'saves', 'shots', 'shots_on_target', 'fouls', 'yellow', 'red', 'offsides'].map(id => [id, [{ goals: 'Goles', assists: 'Asistencias', saves: 'Atajadas', shots: 'Tiros', shots_on_target: 'Tiros al arco', fouls: 'Faltas', yellow: 'Amarillas', red: 'Rojas', offsides: 'Fueras de juego' }[id], log => finite(log.values?.[id])]])));
    row.teams = teamDepth(games, logs, log => log.playerKey || `${log.source}:${log.playerId}`);
    row.seasonAggregates = Object.values(store.footystatsResearch?.datasets || {}).filter(set => set.leagueKey === league.key && String(set.season) === String(season)).reduce((sum, set) => sum + (set.playerCount || 0), 0);
    row.declaredCoverage = league.coverageBySeason?.[season] || null;
    result.push(row);
  }
  for (const [season, dataset] of Object.entries(store.sports?.tennis?.datasets || {})) {
    const games = (dataset.matches || []).filter(game => game.date < now.toISOString() && completeScore(game.score, game.bestOf));
    const logs = games.flatMap(game => ['player1', 'player2'].map(side => ({ ...tennisValues(game, playerKey(game, side)), date: game.date })));
    const row = base({ sport: 'tennis', key: 'atp', name: 'ATP / archivo disponible', season, downloadedAt: dataset.loadedAt,
      fixtures: (store.tennisLab?.fixtures || []).filter(game => game.date > now.toISOString()).length }, games, [], now);
    row.sources = [dataset.source].filter(Boolean);
    row.datePrecision = games.every(game => game.timeKnown === true) ? 'exacta' : 'semana_o_fecha_de_fuente';
    row.fields = fields(games, { games: ['Juegos', game => finite(game.totalGames)], sets: ['Sets', game => finite(game.totalSets)], exactDates: ['Fecha exacta confirmada', game => game.timeKnown === true] });
    row.playerFields = fields(logs, Object.fromEntries(['aces', 'doubleFaults', 'breaks', 'serviceGames', 'servePoints', 'firstIn', 'bpSaved', 'bpFaced'].map(id => [id, [{ aces: 'Aces', doubleFaults: 'Dobles faltas', breaks: 'Quiebres', serviceGames: 'Juegos de servicio', servePoints: 'Puntos al saque', firstIn: 'Primer servicio dentro', bpSaved: 'Quiebres salvados', bpFaced: 'Quiebres enfrentados' }[id], log => finite(log[id])]])));
    row.records = logs.length; row.latestPlayer = latest(logs.map(log => log.date)); row.teams = [];
    result.push(row);
  }
  return result;
}

export function dataIntegrity(store) {
  const duplicateIds = rows => { const seen = new Set(); let duplicates = 0; for (const row of rows) { if (seen.has(row)) duplicates++; seen.add(row); } return duplicates; };
  return { footballDuplicates: duplicateIds((store.matches || []).map(row => `${row.leagueKey}:${row.season}:${row.id}`)),
    playerDuplicates: duplicateIds((store.playerLogs || []).map(row => row.id)),
    identityRule: 'IDs nativos por proveedor; no se fusionan personas por nombre ni se convierten acumulados de temporada en partidos individuales.',
    contextRule: 'Disponibilidad solo con fuente, publicacion y vigencia. Un historial no confirma plantilla ni lesiones actuales.' };
}
