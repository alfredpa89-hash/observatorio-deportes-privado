import { belongsToSelectedHistory, isFinished, metricPair, footballCountMarkets, observed } from './model.mjs';
import { validMatch, teamRow } from './nba.mjs';
import { SportsError } from './sports.mjs';
import { handicapDefinitions, settleHandicap, settlementSummary, HANDICAP_GROUPS } from './public/football-handicap.js';

const key = value => String(value ?? '').trim().toLocaleLowerCase('es');
const clean = value => String(value ?? '').trim();
const categories = ['grand-slam', 'masters-1000', 'atp-500'];
const integer = value => value !== null && value !== undefined && clean(value) !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const round = value => value === null ? null : Number(value.toFixed(1));
const total = values => values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
const sortedNames = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const definition = (id, label, lines) => ({ id, label, lines });
const footballFields = [
  ['goals', 'Goles', [0.5, 1.5, 2.5]], ['corners', 'Córners', [2.5, 3.5, 4.5, 5.5, 6.5]],
  ['cards', 'Tarjetas', [0.5, 1.5, 2.5, 3.5]], ['yellow', 'Amarillas', [0.5, 1.5, 2.5, 3.5]], ['red', 'Rojas', [0.5, 1.5, 2.5]],
  ['offsides', 'Fuera de juego', [1.5, 2.5, 3.5, 4.5]], ['fouls', 'Faltas', [8.5, 10.5, 12.5, 14.5]],
  ['shots', 'Tiros', [7.5, 9.5, 11.5, 13.5]], ['shotsOnTarget', 'Tiros al arco', [1.5, 2.5, 3.5, 4.5]],
  ['halfTimeGoals', 'Goles 1T', [0.5, 1.5, 2.5]], ['halfTimeCorners', 'Córners 1T', [1.5, 2.5, 3.5, 4.5]],
];
const playerFields = {
  nba: [['points', 'Puntos', [9.5, 14.5, 19.5, 24.5, 29.5]], ['assists', 'Asistencias', [2.5, 4.5, 6.5, 8.5]],
    ['rebounds', 'Rebotes', [3.5, 5.5, 7.5, 9.5]], ['pra', 'PRA', [19.5, 24.5, 29.5, 34.5, 39.5]],
    ['threes', 'Triples', [0.5, 1.5, 2.5, 3.5, 4.5]]],
  football: [['goals', 'Goles', [0.5, 1.5, 2.5]], ['assists', 'Asistencias', [0.5, 1.5]],
    ['saves', 'Atajadas', [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]],
    ['shots', 'Tiros', [0.5, 1.5, 2.5, 3.5]], ['shots_on_target', 'Tiros al arco', [0.5, 1.5, 2.5]],
    ['fouls', 'Faltas', [0.5, 1.5, 2.5]], ['fouls_drawn', 'Faltas recibidas', [0.5, 1.5, 2.5]], ['yellow', 'Amarillas', [0.5, 1.5]],
    ['red', 'Rojas', [0.5, 1.5, 2.5]], ['offsides', 'Fuera de juego', [0.5, 1.5, 2.5]]],
};

function fieldsFor(sport, kind) {
  if (kind === 'player' && sport !== 'tennis') return playerFields[sport].map(fields => definition(...fields));
  if (sport === 'football') {
    const shared = footballCountMarkets();
    return footballFields.flatMap(([id, label, lines]) => [
      definition(id, `${label} a favor`, lines), definition(`${id}Against`, `${label} en contra`, lines),
      definition(`${id}Total`, `${label} del encuentro`, id === 'shots' ? [15.5, 19.5, 23.5, 27.5, 31.5]
        : [...new Set(shared.filter(market => market.metric === id).map(market => market.line))]),
    ]);
  }
  if (sport === 'nba') return [definition('points', 'Puntos a favor', [99.5, 109.5, 119.5]),
    definition('pointsAgainst', 'Puntos en contra', [99.5, 109.5, 119.5]),
    definition('pointsTotal', 'Puntos del encuentro', [199.5, 209.5, 219.5, 229.5, 239.5]),
    definition('rebounds', 'Rebotes', [39.5, 44.5, 49.5]), definition('assists', 'Asistencias', [19.5, 24.5, 29.5]),
    definition('threes', 'Triples', [9.5, 12.5, 15.5]),
    definition('firstQuarterPoints', 'Puntos a favor 1Q', [24.5, 27.5, 30.5, 33.5]),
    definition('firstQuarterPointsAgainst', 'Puntos en contra 1Q', [24.5, 27.5, 30.5, 33.5]),
    definition('firstQuarterPointsTotal', 'Puntos del encuentro 1Q', [49.5, 54.5, 59.5, 64.5]),
    definition('halfTimePoints', 'Puntos a favor al descanso', [49.5, 54.5, 59.5, 64.5]),
    definition('halfTimePointsAgainst', 'Puntos en contra al descanso', [49.5, 54.5, 59.5, 64.5]),
    definition('halfTimePointsTotal', 'Puntos del encuentro al descanso', [99.5, 109.5, 119.5, 129.5])];
  return [definition('aces', 'Aces', [3.5, 5.5, 7.5, 9.5]), definition('doubleFaults', 'Dobles faltas', [1.5, 2.5, 3.5]),
    definition('games', 'Juegos ganados', [9.5, 12.5, 15.5]), definition('gamesTotal', 'Juegos del encuentro', [19.5, 22.5, 25.5, 29.5]),
    definition('sets', 'Sets del encuentro', [2.5, 3.5, 4.5])];
}

function teamRecord(match, sport, name) {
  const atHome = key(match.home) === key(name);
  const side = atHome ? 'home' : 'away';
  const values = {};
  let result, halfTimeResult = null;
  if (sport === 'football') {
    for (const [metric] of footballFields) {
      const pair = metricPair(match, metric);
      values[metric] = pair[atHome ? 0 : 1];
      values[`${metric}Against`] = pair[atHome ? 1 : 0];
      values[`${metric}Total`] = total(pair);
    }
    result = values.goals === values.goalsAgainst ? 'D' : values.goals > values.goalsAgainst ? 'W' : 'L';
    if (values.halfTimeGoals !== null && values.halfTimeGoalsAgainst !== null) {
      halfTimeResult = values.halfTimeGoals === values.halfTimeGoalsAgainst ? 'D' : values.halfTimeGoals > values.halfTimeGoalsAgainst ? 'W' : 'L';
    }
  } else {
    const row = teamRow({ ...match, homePoints: integer(match.homePoints), awayPoints: integer(match.awayPoints) }, name);
    Object.assign(values, { points: row.pointsFor, pointsAgainst: row.pointsAgainst, pointsTotal: row.totalPoints,
      rebounds: integer(row.teamStats.rebounds), assists: integer(row.teamStats.assists), threes: integer(row.teamStats.threePointersMade) });
    for (const field of ['firstQuarterPoints', 'halfTimePoints']) {
      values[field] = row.teamStats[field]; values[`${field}Against`] = row.opponentStats[field];
      values[`${field}Total`] = total([values[field], values[`${field}Against`]]);
    }
    result = row.result;
  }
  return { id: match.id, date: match.date, season: match.season, name, team: name,
    opponent: atHome ? match.away : match.home, venue: side, result, source: match.source,
    fieldSources: match.fieldSources, fieldConflicts: match.fieldConflicts, integrityWarning: match.integrityWarning,
    score: `${atHome ? match.homeGoals ?? match.homePoints : match.awayGoals ?? match.awayPoints}-${atHome ? match.awayGoals ?? match.awayPoints : match.homeGoals ?? match.homePoints}`,
    values, ...(sport === 'football' ? { halfTimeResult } : {}) };
}

function footballScenarios(history, name, fields, thresholds) {
  const scenarios = [];
  const add = (definition, predicate) => {
    const sample = observed(history, predicate);
    scenarios.push({ ...definition, hits: sample.hits, n: sample.n, missing: history.length - sample.n,
      frequency: sample.rate, probability: sample.n >= 3 ? sample.rate : null, interval95: sample.interval95,
      quality: sample.n < 3 ? 'unavailable' : sample.n < 10 ? 'limited' : 'historical' });
  };
  for (const [period, prefix, resultField, suffix] of [['ft', '', 'result', ''], ['ht', 'half-time-', 'halfTimeResult', ' al descanso']]) {
    for (const [id, label, outcome] of [['win', `Gana ${name}`, 'W'], ['draw', 'Empate', 'D'], ['loss', `Pierde ${name}`, 'L']]) {
      add({ id: `${prefix}result-${id}`, group: period === 'ht' ? 'resultado-1t' : 'resultado', period, scope: null, label: label + suffix },
        row => row[resultField] === null ? null : row[resultField] === outcome);
    }
  }
  for (const [id, label, outcomes] of [['win-draw', `Gana ${name} o empata`, ['W', 'D']], ['draw-loss', `Empata o pierde ${name}`, ['D', 'L']], ['win-loss', 'Gana uno de los dos (sin empate)', ['W', 'L']]]) {
    add({ id: `double-chance-${id}`, group: 'doble-oportunidad', period: 'ft', scope: null, label }, row => outcomes.includes(row.result));
  }
  for (const yes of [true, false]) {
    add({ id: `btts-${yes ? 'yes' : 'no'}`, group: 'ambos-marcan', period: 'ft', scope: null, label: `Ambos marcan: ${yes ? 'Sí' : 'No'}` }, row =>
      row.values.goals === null || row.values.goalsAgainst === null ? null : (row.values.goals > 0 && row.values.goalsAgainst > 0) === yes);
  }
  const shared = footballCountMarkets();
  for (const field of fields) {
    const scope = field.id.endsWith('Against') ? 'against' : field.id.endsWith('Total') ? 'total' : 'for';
    const metric = field.id.replace(/(?:Against|Total)$/, '');
    const config = shared.find(market => market.metric === metric) || { group: 'tiros', baseId: 'shots', metricLabel: 'tiros', period: 'ft', overOnly: false };
    for (const line of field.lines) for (const direction of config.overOnly ? ['over'] : ['over', 'under']) {
      const scopeLabel = scope === 'for' ? `de ${name}` : scope === 'against' ? `del rival de ${name}` : 'del encuentro';
      add({ id: `${config.baseId}-${direction}-${line}${scope === 'total' ? '' : `-${scope}`}`, group: config.group, period: config.period,
        scope, metric: field.id, line, direction, label: `${direction === 'over' ? 'Más' : 'Menos'} de ${line} ${config.metricLabel} ${scopeLabel}` }, row => {
        const value = row.values[field.id];
        return value === null || value === undefined ? null : direction === 'over' ? value > line : value < line;
      });
    }
  }
  for (const definition of handicapDefinitions(thresholds, { home: name, away: `Rival de ${name}` }, true)) {
    const metric = definition.period === 'ht' ? 'halfTimeGoals' : 'goals';
    const outcomes = history.map(row => settleHandicap(row.values[metric], row.values[metric + 'Against'], definition.line, definition.handicapKind));
    const outcome = definition.handicapKind === 'asian' ? 'fullWin' : definition.side;
    const sample = observed(outcomes, value => value === null ? null : value === outcome);
    const settlement = definition.handicapKind === 'asian' ? settlementSummary(outcomes) : null;
    scenarios.push({ ...definition, hits: sample.hits, n: sample.n, missing: history.length - sample.n,
      frequency: sample.rate, probability: sample.n >= 3 ? sample.rate : null, interval95: sample.interval95,
      quality: sample.n < 3 ? 'unavailable' : sample.n < 10 ? 'limited' : 'historical',
      ...(settlement ? { settlement: sample.n >= 3 ? settlement.percentages : null, historicalSettlement: settlement } : {}) });
  }
  return scenarios;
}

function tennisRecord(match, name) {
  const first = key(match.player1) === key(name);
  const stats = match.stats?.[first ? 'player1' : 'player2'] || {};
  return { id: match.id, date: match.date, availableAfter: match.availableAfter, season: match.season, name,
    opponent: first ? match.player2 : match.player1, venue: null, tournament: match.tournament, surface: match.surface,
    result: match.winner === (first ? 1 : 2) ? 'W' : 'L', score: match.score, source: match.source,
    values: { aces: integer(stats.aces), doubleFaults: integer(stats.doubleFaults),
      games: integer(match[first ? 'player1Games' : 'player2Games']), gamesTotal: integer(match.totalGames), sets: integer(match.totalSets) } };
}

export function buildIndividualProfile({ sport, kind = 'team', name, matches = [], playerLogs = [], leagueKey, season,
  cutoff, lookback = 10, venue = 'all', category = 'all', surface = 'all', tournament = '', playerTeam = '', metric, line, thresholds = {} } = {}) {
  if (!['football', 'nba', 'tennis'].includes(sport) || !['team', 'player'].includes(kind) || !clean(name)) throw new SportsError(400, 'Selecciona un equipo o jugador.');
  const time = Date.parse(cutoff);
  if (!Number.isFinite(time)) throw new SportsError(400, 'Fecha de corte no válida.');
  const windows = [5, 10, 15, 20, 25, 30];
  if (!windows.includes(Number(lookback)) || !['all', 'home', 'away'].includes(venue)) throw new SportsError(400, 'Historial o condición no válida.');
  if (!['all', ...categories].includes(category) || !['all', 'Hard', 'Clay', 'Grass', 'Carpet'].includes(surface)) throw new SportsError(400, 'Filtro de tenis no válido.');
  let rows;
  if (kind === 'player' && sport !== 'tennis') {
    rows = playerLogs.filter(row => row.sport === sport && (sport !== 'football' || row.leagueKey === leagueKey) &&
      (!playerTeam || key(row.team) === key(playerTeam)) && key(row.name) === key(name) && belongsToSelectedHistory(row, season));
  } else {
    rows = matches.filter(match => belongsToSelectedHistory(match, season)).flatMap(match => {
      if (sport === 'football' && (match.leagueKey !== leagueKey || !isFinished(match))) return [];
      if (sport === 'nba' && !validMatch(match)) return [];
      if (sport === 'tennis') {
        if (match.completed === false || match.retired || ![1, 2].includes(match.winner) || !categories.includes(match.category) ||
          (category !== 'all' && match.category !== category) || (surface !== 'all' && match.surface !== surface) ||
          (tournament && key(match.tournament) !== key(tournament)) || ![match.player1, match.player2].some(player => key(player) === key(name))) return [];
        return [tennisRecord(match, name)];
      }
      return [match.home, match.away].some(team => key(team) === key(name)) ? [teamRecord(match, sport, name)] : [];
    });
  }
  rows = rows.filter(row => Date.parse(row.date) < time && Date.parse(row.availableAfter || row.date) < time && (venue === 'all' || row.venue === venue));
  rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const seen = new Set();
  const history = rows.filter(row => {
    const id = row.id || `${row.date}:${row.opponent}:${row.team || ''}`;
    if (seen.has(id)) return false; seen.add(id); return true;
  }).slice(0, Number(lookback));
  const fields = fieldsFor(sport, kind);
  const footballTeam = sport === 'football' && kind === 'team';
  if (footballTeam) {
    if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) throw new SportsError(400, 'Límites de escenarios no válidos.');
    try { handicapDefinitions(thresholds); } catch (error) { throw new SportsError(400, error.message); }
    const handicapKeys = new Set(Object.values(HANDICAP_GROUPS).map(config => config.key));
    for (const [id, requested] of Object.entries(thresholds)) {
      if (handicapKeys.has(id)) continue;
      const field = fields.find(item => item.id === id);
      if (!field || !Array.isArray(requested) || requested.length > 20 || requested.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < .5 || value > 99.5 || value % 1 !== .5)) {
        throw new SportsError(400, 'Indica hasta 20 límites terminados en .5 por estadística, entre 0.5 y 99.5.');
      }
      field.lines = [...new Set([...field.lines, ...requested])].sort((a, b) => a - b);
    }
  }
  const selected = metric ? fields.find(field => field.id === metric) : fields[0];
  if (!selected) throw new SportsError(400, 'Estadística no válida para esta consulta.');
  const custom = line === undefined ? null : Number(line);
  if (custom !== null && (!Number.isFinite(custom) || custom < 0.5 || custom > 499.5 || custom % 1 !== 0.5)) throw new SportsError(400, 'El límite debe terminar en .5, entre 0.5 y 499.5.');
  const summary = fields.map(field => {
    const values = history.map(row => row.values[field.id]).filter(value => value !== null && value !== undefined);
    return { ...field, n: values.length, average: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
  });
  const values = history.map(row => row.values[selected.id]).filter(value => value !== null && value !== undefined);
  const lines = [...new Set([...selected.lines, ...(custom === null ? [] : [custom])])].sort((a, b) => a - b);
  const frequencies = lines.flatMap(threshold => ['over', 'under'].map(direction => {
    const hits = values.filter(value => direction === 'over' ? value > threshold : value < threshold).length;
    return { metric: selected.id, label: `${direction === 'over' ? 'Over' : 'Under'} ${threshold}`, line: threshold, direction, hits, n: values.length,
      frequency: values.length ? round(100 * hits / values.length) : null };
  }));
  const wins = history.filter(row => row.result === 'W').length;
  const draws = history.filter(row => row.result === 'D').length;
  const losses = history.filter(row => row.result === 'L').length;
  const halfHistory = history.filter(row => row.halfTimeResult !== null && row.halfTimeResult !== undefined);
  return { meta: { sport, kind, name, leagueKey, season, cutoff: new Date(time).toISOString(), lookback: Number(lookback), venue, category, surface, tournament,
    metric: selected.id, playerTeam, method: 'Frecuencias históricas, no probabilidades prepartido frente a un rival.' },
    summary, history, frequencies, record: { played: history.length, wins, draws, losses, resultsN: wins + draws + losses,
      ...(footballTeam ? { halfTime: { played: halfHistory.length, wins: halfHistory.filter(row => row.halfTimeResult === 'W').length,
        draws: halfHistory.filter(row => row.halfTimeResult === 'D').length, losses: halfHistory.filter(row => row.halfTimeResult === 'L').length } } : {}) },
    ...(footballTeam ? { scenarios: footballScenarios(history, name, fields, thresholds), scenarioNote: 'Probabilidad histórica: frecuencia observada, sin ajuste por rival ni calibración prepartido. Se muestra desde 3 partidos con datos. El intervalo 95% refleja incertidumbre de la frecuencia, no garantiza el próximo resultado.' } : {}),
    note: !history.length ? 'Sin partidos disponibles para esta selección y fecha de corte.' : values.length < 3 ? 'Muestra insuficiente para esta estadística; no se estima el próximo partido.' : 'Frecuencia de los partidos guardados; no garantiza el resultado del próximo encuentro.' };
}

export function createProfilesService({ getStore, getFootballStore = () => getStore(), persist, footballCatalog, sportsState, parseCsvRows, parseCsvDateTime, enrichFootball }) {
  const readStore = body => body.sport === 'football' ? getFootballStore(body.leagueKey) : getStore();
  function context(body) {
    const { sport } = body;
    if (!['football', 'nba', 'tennis'].includes(sport)) throw new SportsError(400, 'Deporte no válido.');
    if (sport === 'football') {
      const league = footballCatalog(body.leagueKey).find(item => item.key === body.leagueKey);
      if (!league) throw new SportsError(404, 'Selecciona una liga guardada.');
      const season = league.seasons.find(value => String(value) === String(body.season));
      if (season === undefined) throw new SportsError(400, 'Temporada no disponible.');
      return { league, season, matches: readStore(body).matches.filter(match => match.leagueKey === league.key), teams: league.teams };
    }
    const config = sportsState()[sport];
    if (!config.seasons.includes(String(body.season))) throw new SportsError(400, 'Temporada no disponible.');
    const matches = Object.entries(getStore().sports?.[sport]?.datasets || {}).filter(([season]) => season <= String(body.season)).flatMap(([, dataset]) => dataset.matches || []);
    return { season: String(body.season), matches, teams: config.datasets.find(dataset => dataset.season === String(body.season))?.participants || [] };
  }
  function catalog(body) {
    const selected = context(body);
    const players = (readStore(body).playerLogs || []).filter(row => row.sport === body.sport && (body.sport !== 'football' || row.leagueKey === body.leagueKey) &&
      (!body.playerTeam || key(row.team) === key(body.playerTeam)) && belongsToSelectedHistory(row, selected.season) &&
      (!body.cutoff || Date.parse(row.date) < Date.parse(body.cutoff)));
    return { teams: selected.teams, players: body.sport === 'tennis' ? selected.teams : sortedNames(players.map(row => row.name)),
      playerCount: players.length };
  }
  async function report(body) {
    const selected = context(body);
    const kind = body.sport === 'tennis' ? 'player' : body.kind || 'team';
    const available = catalog(body)[kind === 'team' ? 'teams' : 'players'];
    if (!available.includes(clean(body.name))) throw new SportsError(400, 'Selecciona un equipo o jugador con datos guardados.');
    const args = { ...body, kind, season: selected.season, matches: selected.matches, playerLogs: readStore(body).playerLogs || [] };
    let result = buildIndividualProfile(args);
    if (body.sport === 'football' && kind === 'team') {
      const ids = new Set(result.history.map(row => row.id));
      const enriched = await enrichFootball(selected.league, selected.matches.filter(match => ids.has(match.id)));
      if (enriched.changed) result = buildIndividualProfile({ ...args, matches: readStore(body).matches });
      if (enriched.warning) result.note += ` ${enriched.warning}`;
    }
    result.meta.competition = selected.league?.name || (body.sport === 'nba' ? 'NBA' : 'ATP');
    result.meta.providerNote = kind === 'player' && body.sport !== 'tennis'
      ? 'Registros individuales por partido (CSV personal o box score ESPN). Ausencias y datos faltantes no cuentan como cero. La muestra contiene solo participaciones guardadas.'
      : selected.league?.coverageNote || getStore().sports?.[body.sport]?.datasets[selected.season]?.note || '';
    if (result.meta.providerNote) result.note += ` ${result.meta.providerNote}`;
    return result;
  }
  async function importPlayers(body) {
    const selected = context(body);
    if (!['football', 'nba'].includes(body.sport)) throw new SportsError(400, 'Para tenis utiliza su importador de partidos.');
    if (typeof body.csv !== 'string' || body.csv.length > 10 * 1024 * 1024) throw new SportsError(400, 'Selecciona un CSV de hasta 10 MB.');
    const rows = parseCsvRows(body.csv);
    const header = rows.shift()?.map(value => clean(value).replace(/^\uFEFF/, '').toLowerCase());
    if (!header || !['date', 'player', 'team', 'opponent'].every(field => header.includes(field))) throw new SportsError(400, 'Se requieren date, player, team y opponent.');
    const fields = playerFields[body.sport].map(([field]) => field).filter(field => field !== 'pra');
    if (!fields.some(field => header.includes(field))) throw new SportsError(400, 'El archivo debe incluir al menos una columna estadística de la plantilla.');
    const records = []; let skipped = 0;
    for (const row of rows) {
      const item = Object.fromEntries(header.map((field, index) => [field, row[index] ?? '']));
      const date = parseCsvDateTime(item.date, item.time, 'America/Guayaquil');
      const name = clean(item.player); const team = clean(item.team); const opponent = clean(item.opponent);
      const venue = clean(item.venue).toLowerCase() || null;
      const minutes = clean(item.minutes) === '' ? null : Number(item.minutes);
      const values = Object.fromEntries(fields.map(field => [field, integer(item[field])]));
      const invalidStats = fields.some(field => clean(item[field]) !== '' && values[field] === null);
      if (!date || !name || !team || !opponent || key(team) === key(opponent) || !String(selected.season).split(/[/-]/).includes(date.slice(0, 4)) ||
        (venue && !['home', 'away'].includes(venue)) || (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0 || (body.sport === 'football' && minutes > 130))) ||
        (body.sport === 'football' && values.shots !== null && values.shots_on_target !== null && values.shots_on_target > values.shots) || invalidStats || Object.values(values).every(value => value === null)) { skipped += 1; continue; }
      if (body.sport === 'nba') values.pra = total([values.points, values.rebounds, values.assists]);
      records.push({ id: `player:${body.sport}:${body.leagueKey || 'nba'}:${selected.season}:${date}:${key(name)}:${key(team)}:${key(opponent)}`,
        sport: body.sport, leagueKey: body.sport === 'football' ? body.leagueKey : null, season: selected.season, date, name, team, opponent, venue, minutes, values, source: 'CSV personal' });
    }
    if (!records.length) throw new SportsError(400, 'No hay registros válidos de jugadores en el archivo.');
    getStore().playerLogs = [...new Map([...(getStore().playerLogs || []), ...records].map(row => [row.id, row])).values()];
    await persist();
    return { imported: new Set(records.map(row => row.id)).size, skipped, catalog: catalog(body) };
  }
  return { catalog, report, importPlayers };
}
