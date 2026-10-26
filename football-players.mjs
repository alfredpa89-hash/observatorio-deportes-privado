import { isFinished } from './model.mjs';
import { SportsError } from './sports.mjs';

export const FOOTBALL_PLAYER_METRICS = [
  { id: 'goals', label: 'Goles', lines: [.5, 1.5, 2.5] },
  { id: 'assists', label: 'Asistencias', lines: [.5, 1.5, 2.5] },
  { id: 'saves', label: 'Atajadas', lines: [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5] },
  { id: 'shots', label: 'Tiros', lines: [.5, 1.5, 2.5, 3.5, 4.5] },
  { id: 'shots_on_target', label: 'Tiros al arco', lines: [.5, 1.5, 2.5, 3.5] },
  { id: 'fouls', label: 'Faltas cometidas', lines: [.5, 1.5, 2.5, 3.5] },
  { id: 'fouls_drawn', label: 'Faltas recibidas', lines: [.5, 1.5, 2.5, 3.5] },
  { id: 'yellow', label: 'Amarillas', lines: [.5, 1.5] },
  { id: 'red', label: 'Rojas', lines: [.5, 1.5] },
  { id: 'offsides', label: 'Fuera de juego', lines: [.5, 1.5, 2.5] },
];
const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLocaleLowerCase('es');
const searchKey = value => key(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const count = value => typeof value !== 'boolean' && value != null && clean(value) !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const minutes = value => typeof value !== 'boolean' && value != null && clean(value) !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 130 ? Number(value) : null;
const rating = value => typeof value !== 'boolean' && value != null && clean(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10 ? Number(value) : null;
const round = value => Math.round(value * 100) / 100;
const photo = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'media.api-sports.io' ? url.href : null; } catch { return null; }
};

function validValues(values = {}) {
  const result = Object.fromEntries(FOOTBALL_PLAYER_METRICS.map(field => [field.id, count(values[field.id])]));
  if (result.shots !== null && result.shots_on_target !== null && result.shots_on_target > result.shots) result.shots_on_target = null;
  return result;
}

// Only full-time match blocks are accepted; season aggregates and extra-time totals are not game logs.
export function parseFootballFixturePlayers(fixture, match) {
  if (!match || !/^\d+$/.test(String(match.id)) || String(fixture?.fixture?.id) !== String(match.id) ||
      fixture.fixture?.status?.short !== 'FT' || String(fixture.league?.season) !== String(match.season) ||
      (match.leagueKey?.startsWith('api:') && String(fixture.league?.id) !== match.leagueKey.slice(4)) ||
      Date.parse(fixture.fixture?.date) !== Date.parse(match.date) ||
      key(fixture.teams?.home?.name) !== key(match.home) || key(fixture.teams?.away?.name) !== key(match.away)) return [];
  const records = [];
  for (const block of Array.isArray(fixture.players) ? fixture.players : []) {
    const atHome = String(block.team?.id) === String(fixture.teams.home.id);
    const team = atHome ? fixture.teams.home : fixture.teams.away;
    const opponent = atHome ? fixture.teams.away : fixture.teams.home;
    if (!team.id || String(block.team?.id) !== String(team.id)) continue;
    for (const item of Array.isArray(block.players) ? block.players : []) {
      const stats = item.statistics?.length === 1 ? item.statistics[0] : null;
      const played = minutes(stats?.games?.minutes), name = clean(item.player?.name), playerId = count(item.player?.id);
      if (!stats || !played || !name || !playerId) continue;
      records.push({ id: `player:football:${match.leagueKey}:${match.season}:${match.id}:${playerId}:${team.id}`,
        sport: 'football', leagueKey: match.leagueKey, season: match.season, fixtureId: String(match.id), playerId,
        playerKey: `api:${playerId}`, date: match.date, availableAfter: new Date(Date.parse(match.date) + 3 * 3600000).toISOString(),
        name, team: clean(team.name), opponent: clean(opponent.name), teamId: team.id, venue: atHome ? 'home' : 'away',
        minutes: played, position: clean(stats.games.position), starter: typeof stats.games.substitute === 'boolean' ? !stats.games.substitute : null,
        rating: rating(stats.games.rating), photo: photo(item.player.photo), teamLogo: photo(team.logo), source: 'API-Football',
        values: validValues({ goals: stats.goals?.total, assists: stats.goals?.assists, saves: stats.goals?.saves, shots: stats.shots?.total,
          shots_on_target: stats.shots?.on, fouls: stats.fouls?.committed, fouls_drawn: stats.fouls?.drawn,
          yellow: stats.cards?.yellow, red: stats.cards?.red, offsides: stats.offsides }) });
    }
  }
  return [...new Map(records.map(row => [row.id, row])).values()];
}

// Recover only this new field from saved, identity-checked fixture details; no network calls or new appearances.
export function restoreFootballPlayerSaves(store) {
  const matches = new Map((store.matches || []).filter(row => row.leagueKey?.startsWith('api:')).map(row => [`${row.leagueKey}:${row.season}:${row.id}`, row]));
  const values = new Map();
  for (const [cacheKey, cache] of Object.entries(store.cache || {})) {
    const fixtureId = cacheKey.match(/^\/fixtures\?id=(\d+)$/)?.[1];
    if (!fixtureId || !Array.isArray(cache.data)) continue;
    for (const fixture of cache.data) {
      if (String(fixture?.fixture?.id) !== fixtureId) continue;
      const match = matches.get(`api:${fixture.league?.id}:${fixture.league?.season}:${fixtureId}`);
      for (const row of parseFootballFixturePlayers(fixture, match)) if (row.values.saves !== null) values.set(row.id, row.values.saves);
    }
  }
  let restored = 0;
  for (const row of store.playerLogs || []) {
    if (row.sport !== 'football' || row.source !== 'API-Football' || row.values?.saves != null || !values.has(row.id)) continue;
    row.values = { ...row.values, saves: values.get(row.id) }; restored++;
  }
  return restored;
}

export function parseFootballAssistLeaders(response, leagueId, season) {
  const rows = [];
  for (const [index, item] of (Array.isArray(response) ? response.slice(0, 20) : []).entries()) {
    const blocks = (Array.isArray(item?.statistics) ? item.statistics : []).filter(stats => String(stats.league?.id) === String(leagueId) && String(stats.league?.season) === String(season));
    if (blocks.length !== 1) continue;
    const stats = blocks[0], assists = count(stats.goals?.assists), playerId = count(item.player?.id), teamId = count(stats.team?.id);
    if (assists === null || !playerId || !teamId || !clean(item.player?.name) || !clean(stats.team?.name)) continue;
    rows.push({ providerRank: index + 1, playerKey: `api:${playerId}`, name: clean(item.player.name), team: clean(stats.team.name), teamId,
      assists, appearances: count(stats.games?.appearences), minutes: count(stats.games?.minutes), photo: photo(item.player.photo) });
  }
  return rows;
}

function settings(body = {}) {
  const cutoff = Date.parse(body.cutoff || new Date().toISOString()), window = clean(body.window || '10');
  const minGames = Number(body.minGames ?? 1), metric = body.metric || 'goals', basis = body.basis || 'total', position = clean(body.position);
  if (!Number.isFinite(cutoff) || cutoff > Date.now() + 1000) throw new SportsError(400, 'El corte debe ser una fecha valida, no futura.');
  if (!['season', '5', '10', '15', '20', '25', '30'].includes(window)) throw new SportsError(400, 'Selecciona temporada o 5, 10, 15, 20, 25 o 30 participaciones.');
  if (!Number.isInteger(minGames) || minGames < 1 || minGames > 100) throw new SportsError(400, 'El minimo debe estar entre 1 y 100 participaciones.');
  if (!FOOTBALL_PLAYER_METRICS.some(field => field.id === metric) || !['total', 'average', 'per90'].includes(basis)) throw new SportsError(400, 'Estadistica u orden no valido.');
  if (!['', 'G', 'D', 'M', 'F'].includes(position)) throw new SportsError(400, 'Posicion no valida.');
  return { cutoff, window, minGames, metric, basis, position, team: clean(body.team), query: searchKey(body.query).slice(0, 100) };
}

function eligibleLogs(logs, body, config) {
  const unique = new Map();
  const eligible = logs.filter(row => row.sport === 'football' && row.leagueKey === body.leagueKey &&
    String(row.season) === String(body.season) && clean(row.name) && clean(row.team) && clean(row.opponent) &&
    Date.parse(row.date) < config.cutoff && Date.parse(row.availableAfter || row.date) < config.cutoff &&
    (row.minutes == null || minutes(row.minutes) !== null) && (!config.team || key(row.team) === key(config.team)))
    .sort((a, b) => Number(Boolean(a.playerId)) - Number(Boolean(b.playerId)));
  const apiIdentities = new Map();
  for (const row of eligible.filter(row => row.playerId)) {
    const identity = `${row.date}:${key(row.name)}:${key(row.team)}:${key(row.opponent)}`;
    if (!apiIdentities.has(identity)) apiIdentities.set(identity, new Set());
    apiIdentities.get(identity).add(row.playerKey || `api:${row.playerId}`);
  }
  for (const row of eligible) {
    // Precise fixture identity is preferred; exact-date CSV duplicates are coalesced, not guessed across dates.
    const event = `${row.date}:${key(row.name)}:${key(row.team)}:${key(row.opponent)}`;
    const candidates = apiIdentities.get(event);
    const playerKey = row.playerKey || (row.playerId ? `api:${row.playerId}` : candidates?.size === 1 ? [...candidates][0] : `name:${key(row.name)}`);
    const identity = `${row.date}:${playerKey}:${key(row.team)}:${key(row.opponent)}`;
    unique.set(identity, { ...row, playerKey,
      minutes: minutes(row.minutes), rating: rating(row.rating), values: validValues(row.values) });
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function footballPlayerSummary(history) {
  return FOOTBALL_PLAYER_METRICS.map(field => {
    const valid = history.filter(row => row.values[field.id] !== null), paired = valid.filter(row => row.minutes !== null);
    const sum = valid.reduce((value, row) => value + row.values[field.id], 0), pairedMinutes = paired.reduce((value, row) => value + row.minutes, 0);
    return { ...field, n: valid.length, missing: history.length - valid.length, total: valid.length ? sum : null,
      average: valid.length ? round(sum / valid.length) : null, per90: pairedMinutes ? round(90 * paired.reduce((value, row) => value + row.values[field.id], 0) / pairedMinutes) : null,
      per90N: paired.length, per90Minutes: pairedMinutes };
  });
}

function playerEntry(history) {
  const current = history[0], withMinutes = history.filter(row => row.minutes !== null), ratings = history.filter(row => row.rating !== null);
  const summary = footballPlayerSummary(history);
  return { playerKey: current.playerKey, name: current.name, team: current.team, position: current.position || '',
    photo: photo(current.photo), teamLogo: photo(current.teamLogo), appearances: history.length, lastDate: current.date,
    minutes: withMinutes.length ? round(withMinutes.reduce((sum, row) => sum + row.minutes, 0)) : null,
    minutesN: withMinutes.length, averageMinutes: withMinutes.length ? round(withMinutes.reduce((sum, row) => sum + row.minutes, 0) / withMinutes.length) : null,
    averageRating: ratings.length ? round(ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length) : null, ratingN: ratings.length,
    sources: [...new Set(history.map(row => row.source || 'Sin fuente'))], summary };
}

export function buildFootballPlayerDirectory(logs, body) {
  const config = settings(body), eligible = eligibleLogs(logs, body, config), groups = new Map();
  for (const row of eligible) {
    const id = `${row.playerKey}:${key(row.team)}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  const selected = [...groups.values()].filter(history => !config.position || history[0].position === config.position)
    .map(history => config.window === 'season' ? history : history.slice(0, Number(config.window)));
  const players = selected.map(playerEntry).filter(player => player.appearances >= config.minGames &&
    (!config.query || searchKey(`${player.name} ${player.team}`).includes(config.query)));
  const score = player => player.summary.find(field => field.id === config.metric)[config.basis];
  players.sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1) || b.appearances - a.appearances || a.name.localeCompare(b.name, 'es'));
  const records = selected.flat();
  return { meta: { ...body, cutoff: new Date(config.cutoff).toISOString(), window: config.window, metric: config.metric, basis: config.basis,
    method: 'Estadisticas de participaciones guardadas de la temporada elegida; no plantilla actual ni pronostico.' },
    players, count: players.length, savedPlayers: selected.length, records: records.length,
    gameCount: new Set(records.map(row => row.fixtureId || `${row.date}:${[row.team, row.opponent].sort().join(':')}`)).size,
    coverage: FOOTBALL_PLAYER_METRICS.map(field => ({ ...field, n: records.filter(row => row.values[field.id] !== null).length, records: records.length })),
    note: 'Totales de la muestra, no lideres oficiales de toda la liga. Una ausencia no es cero. Por 90 usa solo partidos con esa estadistica y minutos disponibles. No mezcla temporadas.' };
}

export function buildFootballPlayerProfile(logs, body) {
  const config = settings(body);
  if (!body.playerKey || !clean(body.team)) throw new SportsError(400, 'Selecciona un jugador y su equipo.');
  let history = eligibleLogs(logs, body, config).filter(row => row.playerKey === body.playerKey);
  if (config.window !== 'season') history = history.slice(0, Number(config.window));
  if (!history.length) throw new SportsError(404, 'Sin participaciones del jugador para estos filtros.');
  return { ...playerEntry(history), history, meta: { ...body, cutoff: new Date(config.cutoff).toISOString() },
    note: 'Frecuencias historicas, no probabilidades prepartido. Participaciones guardadas: las ausencias no cuentan como cero. La valoracion, cuando existe, es de API-Football, no de SofaScore.' };
}

export function createFootballPlayersService({ getStore, getReadStore = () => getStore(), resolveLoad = body => body, getPresets = () => [], seasonAggregates = () => [], persist, request, connected, getQuota, getPolicy = () => ({ reserve: 5 }), getConnection = () => null, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let loading = false, lastProviderCall = 0;
  function leagueFor(body, readStore = getReadStore(body.leagueKey)) {
    const league = readStore.leagues?.[body.leagueKey];
    if (!league) throw new SportsError(404, 'Carga primero la competicion en Encuentros.');
    if (!league.seasons?.some(season => String(season) === String(body.season))) throw new SportsError(400, 'Temporada no guardada.');
    return league;
  }
  function state({ sourceMode } = {}) {
    const store = sourceMode === 'api-football' ? getStore() : getReadStore();
    return { connected: connected(), connection: getConnection(), quota: getQuota(), metrics: FOOTBALL_PLAYER_METRICS,
      pending: getPresets().filter(league => !league.loadedKeys?.length),
      catalog: Object.values(store.leagues || {}).filter(league => sourceMode !== 'api-football' || league.source === 'api-football').map(league => ({ key: league.key, name: league.name, country: league.country, source: league.source,
        sourceKeys: league.sourceKeys, sources: league.sources, coverageNote: league.coverageNote,
        seasons: league.seasons, teams: [...new Set([...(Object.values(league.teamsBySeason || {}).flat()), ...store.matches.filter(match => match.leagueKey === league.key).flatMap(match => [match.home, match.away])])].sort(),
        seasonsInfo: Object.fromEntries((league.seasons || []).map(season => {
          const logs = (store.playerLogs || []).filter(row => row.sport === 'football' && row.leagueKey === league.key && String(row.season) === String(season));
          return [season, { records: logs.length, players: new Set(logs.map(row => `${row.playerKey || row.name}:${row.team}`)).size,
            teamCoverage: Object.fromEntries([...new Set([...(league.teamsBySeason?.[season] || []), ...logs.map(row => row.team)])].map(team => {
              const rows = logs.filter(row => key(row.team) === key(team));
              return [team, { records: rows.length, players: new Set(rows.map(row => row.playerKey || row.name)).size,
                games: new Set(rows.map(row => row.fixtureId || `${row.date}:${row.opponent}`)).size }];
            })),
            teams: [...new Set([...(league.teamsBySeason?.[season] || []), ...store.matches.filter(match => match.leagueKey === league.key && String(match.season) === String(season)).flatMap(match => [match.home, match.away]), ...logs.map(row => row.team)])].sort(),
            apiLoadable: league.source === 'api-football' || Boolean(league.sourceSeasons?.[season]?.some(ref => getStore().leagues[ref.leagueKey]?.source === 'api-football')),
            apiCoverage: league.coverageBySeason?.[season]?.fixtures?.statistics_players ?? null,
            topAssistCoverage: league.coverageBySeason?.[season]?.top_assists ?? null }];
        })) })).sort((a, b) => a.name.localeCompare(b.name, 'es')) };
  }
  function directory(body) { const view = getReadStore(body.leagueKey), league = leagueFor(body, view); return { ...buildFootballPlayerDirectory(view.playerLogs || [], body), competition: league.name,
    seasonAggregates: seasonAggregates(body, league) }; }
  function profile(body) { const view = getReadStore(body.leagueKey), league = leagueFor(body, view); return { ...buildFootballPlayerProfile(view.playerLogs || [], body), competition: league.name }; }
  async function assistLeaders(body) {
    const selected = leagueFor(body);
    const native = resolveLoad({ ...body, team: '' }), league = getStore().leagues[native.leagueKey];
    if (league.source !== 'api-football' || !/^api:\d+$/.test(league.key)) throw new SportsError(400, 'Carga primero esta temporada desde API-Football para consultar sus asistentes.');
    const reportKey = `${league.key}:${native.season}`, stored = getStore().footballAssistLeaders?.[reportKey] || null;
    if (body.refresh !== true) return { competition: selected.name, report: stored };
    if (loading) throw new SportsError(409, 'Ya hay una consulta de jugadores en curso.');
    if (!connected()) throw new SportsError(401, 'Conecta API-Football en Fuentes de datos; los rankings guardados se conservan.');
    if (league.coverageBySeason?.[native.season]?.top_assists === false) throw new SportsError(403, 'El proveedor no declara ranking de asistentes para esta temporada.');
    const cacheKey = `/players/topassists?league=${league.key.slice(4)}&season=${native.season}`;
    const ttl = 6 * 3600000, cache = getStore().cache?.[cacheKey], connection = getConnection();
    const cached = cache && (!connection || cache.plan === connection.plan) && Date.now() - cache.savedAt < ttl;
    const quota = getQuota(), sameDay = quota?.checkedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
    if (!cached && sameDay && quota.remaining != null && quota.remaining <= Math.min(5, getPolicy().reserve)) throw new SportsError(429, 'Presupuesto de consultas alcanzado. El ranking guardado se conserva.');
    loading = true;
    try {
      if (!cached && lastProviderCall) await pause(Math.max(0, 6500 - (Date.now() - lastProviderCall)));
      if (!cached) lastProviderCall = Date.now();
      const result = await request('/players/topassists', { league: Number(league.key.slice(4)), season: Number(native.season) }, ttl);
      const rows = parseFootballAssistLeaders(result, league.key.slice(4), native.season);
      if (!rows.length) throw new SportsError(404, 'El proveedor no devolvio un ranking de asistentes valido de esta temporada. Lo guardado se conserva.');
      const savedAt = getStore().cache?.[cacheKey]?.savedAt;
      const report = { leagueKey: league.key, season: native.season, rows, fetchedAt: new Date(Number.isFinite(savedAt) ? savedAt : Date.now()).toISOString(),
        source: 'API-Football /players/topassists',
        note: 'Hasta 20 asistentes del torneo segun el proveedor al momento de consulta. Agregados de temporada, no participaciones: no aplican equipo, posicion, ventana ni fecha de corte del historial. No se usan para reconstruir pronosticos pasados.' };
      getStore().footballAssistLeaders ||= {}; getStore().footballAssistLeaders[reportKey] = report;
      await persist();
      return { competition: selected.name, report, requests: cached ? 0 : 1 };
    } finally { loading = false; }
  }
  async function load(body) {
    if (loading) throw new SportsError(409, 'Ya hay una carga de jugadores en curso.');
    body = resolveLoad(body);
    const league = getStore().leagues?.[body.leagueKey];
    if (!league) throw new SportsError(404, 'Carga primero la competicion en Encuentros.');
    if (!league.seasons?.some(season => String(season) === String(body.season))) throw new SportsError(400, 'Temporada no guardada.');
    const config = settings(body), lookback = Number(body.lookback || 10);
    const scope = body.scope || 'team', maxGames = Number(body.maxGames ?? 5);
    if (!connected()) throw new SportsError(401, 'Conecta API-Football en Fuentes de datos; no pegues la clave en el chat.');
    if (league.source !== 'api-football') throw new SportsError(400, 'Esta liga usa archivos de equipos. Carga su version API-Football desde Buscar otra liga, o importa registros individuales CSV. No se pueden deducir jugadores de los totales del equipo.');
    if (!['team', 'league'].includes(scope) || !Number.isInteger(maxGames) || maxGames < 1 || maxGames > 5) throw new SportsError(400, 'Carga por equipo o liga, con un maximo de 1 a 5 encuentros.');
    if (![5, 10, 15, 20, 25, 30].includes(lookback) || (scope === 'team' && !config.team)) throw new SportsError(400, 'Selecciona un equipo o carga por liga, con una ventana de 5, 10, 15, 20, 25 o 30 partidos.');
    if (league.coverageBySeason?.[body.season]?.fixtures?.statistics_players === false) throw new SportsError(403, 'El proveedor no declara estadisticas individuales para esta liga y temporada. Se conservan los datos guardados.');
    const store = getStore(); store.footballPlayerLoads ||= {};
    const finished = store.matches.filter(match => match.leagueKey === body.leagueKey && String(match.season) === String(body.season) &&
      /^\d+$/.test(String(match.id)) && isFinished(match) && !['AET', 'PEN'].includes(match.status) &&
      Date.parse(match.date) + 3 * 3600000 < config.cutoff).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const teams = scope === 'team' ? [config.team] : [...new Set(finished.flatMap(match => [match.home, match.away]))];
    const windows = new Map(teams.map(team => [key(team), finished.filter(match => [match.home, match.away].some(name => key(name) === key(team))).slice(0, lookback)]));
    const games = [...new Map([...windows.values()].flat().map(match => [String(match.id), match])).values()];
    if (!games.length) throw new SportsError(404, 'Sin partidos finalizados de este equipo en la temporada y antes del corte.');
    const id = match => `${match.leagueKey}:${match.season}:${match.id}`;
    const checked = match => {
      const marker = store.footballPlayerLoads[id(match)];
      return marker && (marker.records > 0 || Date.now() - Date.parse(marker.checkedAt) < 24 * 3600000);
    };
    const teamRecords = new Set((store.playerLogs || []).filter(row => row.sport === 'football' && row.leagueKey === body.leagueKey && String(row.season) === String(body.season) && row.fixtureId)
      .map(row => `${row.fixtureId}:${key(row.team)}`));
    const availableFor = team => (windows.get(key(team)) || []).filter(match => teamRecords.has(`${match.id}:${key(team)}`)).length;
    const priority = match => [match.home, match.away].reduce((score, team) => {
      const count = availableFor(team); return score + (count === 0 ? 100 : 0) + lookback - count;
    }, 0);
    const pending = games.filter(match => !checked(match));
    let processed = 0, imported = 0, requests = 0, warning = null;
    loading = true;
    try {
      for (let index = 0; index < maxGames && pending.length; index++) {
        // League batches cover teams without logs first; each detail still supplies both teams.
        if (scope === 'league') pending.sort((a, b) => priority(b) - priority(a) || Date.parse(b.date) - Date.parse(a.date));
        const match = pending.shift();
        const ttl = store.footballPlayerLoads[id(match)]?.records === 0 ? 86400000 : 30 * 86400000;
        const cache = store.cache?.[`/fixtures?id=${match.id}`], connection = getConnection();
        const cached = cache && (!connection || cache.plan === connection.plan) && Date.now() - cache.savedAt < ttl;
        const quota = getQuota(), sameDay = quota?.checkedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
        if (!cached && sameDay && quota.remaining != null && quota.remaining <= Math.min(5, getPolicy().reserve)) { warning = 'Presupuesto de consultas alcanzado. Continua con la siguiente cuota; los registros ya cargados se conservan.'; break; }
        if (!cached && lastProviderCall) await pause(Math.max(0, 6500 - (Date.now() - lastProviderCall)));
        try {
          if (!cached) { requests++; lastProviderCall = Date.now(); }
          const fixtures = await request('/fixtures', { id: match.id }, ttl);
          const fixture = Array.isArray(fixtures) ? fixtures.find(item => String(item.fixture?.id) === String(match.id)) : null;
          if (!fixture || fixture.fixture?.status?.short !== 'FT' || String(fixture.league?.season) !== String(match.season) ||
              String(fixture.league?.id) !== league.key.slice(4) ||
              key(fixture.teams?.home?.name) !== key(match.home) || key(fixture.teams?.away?.name) !== key(match.away) ||
              Date.parse(fixture.fixture?.date) !== Date.parse(match.date)) {
            warning = 'El detalle devuelto no coincide con el partido reglamentario guardado. No se importo ni se marco como completo.'; break;
          }
          const logs = parseFootballFixturePlayers(fixture, match), oldIds = new Set((store.playerLogs || []).map(row => row.id));
          store.playerLogs = [...new Map([...(store.playerLogs || []), ...logs].map(row => [row.id, row])).values()];
          for (const row of logs) teamRecords.add(`${row.fixtureId}:${key(row.team)}`);
          imported += logs.filter(row => !oldIds.has(row.id)).length; processed++;
          store.footballPlayerLoads[id(match)] = { checkedAt: new Date().toISOString(), records: logs.length };
          await persist();
        } catch (error) { warning = error.message; break; }
      }
    } finally { loading = false; }
    const markers = games.map(match => store.footballPlayerLoads[id(match)]);
    return { imported, processed, requests, scope, games: games.length, available: markers.filter(marker => marker?.records > 0).length,
      teamsCovered: teams.filter(team => availableFor(team) > 0).length, teamsTotal: teams.length,
      remainingGames: games.filter(match => !checked(match)).length, emptyGames: markers.filter(marker => marker && !marker.records).length,
      warning, state: state(), note: 'Maximo 5 encuentros por carga. Por liga prioriza equipos sin registros, dentro de la ventana elegida de cada equipo. Incluye ambos equipos para reutilizar los registros. Solo FT, sin prorrogas. Datos nulos siguen ausentes; minutos reales, no proyectados.' };
  }
  return { state, directory, profile, load, assistLeaders };
}
