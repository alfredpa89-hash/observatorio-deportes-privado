export const QUARTERS = ['q1', 'q2', 'q3', 'q4'];
export const PERIOD_LABELS = { q1: 'Primer cuarto', q2: 'Segundo cuarto', q3: 'Tercer cuarto', q4: 'Cuarto cuarto', ht: 'Descanso', ft: 'Final', ot: 'Prorroga' };
export const METRICS = ['points', 'rebounds', 'assists', 'pra', 'threes'];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const completeSum = values => values.every(value => number(value) !== null) ? values.reduce((a, b) => a + b, 0) : null;
export const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const gameKey = game => `${game.league}:${game.date}:${normalizeName(game.home)}:${normalizeName(game.away)}`;
export const playerKey = player => `${normalizeName(player.team)}:${normalizeName(player.name)}`;
const NBA_CLUBS = new Set(['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets', 'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers', 'Los Angeles Clippers', 'LA Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'].map(normalizeName));
export function admissibleGame(game, now = Date.now()) {
  return Boolean(game.finished && !game.preseason && Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) < now &&
    !/pre.?season|friendly|all.?star/i.test(game.phase || '') &&
    (game.league !== 'nba' || (!/play.?off/i.test(game.phase || '') && (game.seasonType == null || game.seasonType === 2) && NBA_CLUBS.has(normalizeName(game.home)) && NBA_CLUBS.has(normalizeName(game.away)))));
}

export function teamValue(periods, period) {
  if (period === 'ht') return completeSum([periods?.q1, periods?.q2]);
  return number(periods?.[period]);
}
export function playerPeriod(player, period) {
  if (period !== 'ht') {
    const original = player.periods?.[period];
    if (!original) return null;
    const result = Object.fromEntries(['minutes', ...METRICS].map(metric => [metric, number(original[metric])]));
    result.pra = completeSum([result.points, result.rebounds, result.assists]);
    return result;
  }
  const halves = ['q1', 'q2'].map(q => playerPeriod(player, q));
  if (halves.some(value => !value)) return null;
  const result = {};
  for (const metric of ['minutes', ...METRICS]) {
    // A documented non-participation is different from an absent statistic.
    result[metric] = completeSum(halves.map(value => value.minutes === 0 ? 0 : value[metric]));
  }
  result.pra = completeSum([result.points, result.rebounds, result.assists]);
  return result;
}
export function inspectGame(game) {
  const errors = [...(Array.isArray(game.issues) ? game.issues : [])], missing = [];
  for (const side of ['home', 'away']) {
    const periods = game.periods?.[side] || {};
    const regulation = completeSum(QUARTERS.map(q => periods[q])), final = number(periods.ft), ot = number(periods.ot);
    const half = teamValue(periods, 'ht');
    QUARTERS.filter(q => number(periods[q]) === null).forEach(q => missing.push(`${side}: ${q}`));
    if (half !== null && number(periods.ht) !== null && half !== periods.ht) errors.push(`${side}: descanso no coincide con Q1 + Q2`);
    if (regulation !== null && final !== null && (ot !== null ? regulation + ot !== final : regulation !== final)) errors.push(`${side}: cuartos y prorroga no coinciden con el final`);
  }
  for (const player of game.players || []) {
    for (const [period, value] of Object.entries(player.periods || {})) {
      const maximum = period === 'ft' ? 100 : period === 'ht' ? (game.league === 'nba' ? 24 : 20) : period === 'ot' ? 100 : game.league === 'nba' ? 12 : 10;
      if (number(value.minutes) !== null && value.minutes > maximum + 1 / 60) errors.push(`${player.name}: minutos fuera del periodo ${period}`);
      if (value.minutes === 0 && METRICS.some(metric => number(value[metric]) > 0)) errors.push(`${player.name}: estadisticas con cero minutos en ${period}`);
      const pra = completeSum([value.points, value.rebounds, value.assists]);
      if (number(value.pra) !== null && pra !== null && value.pra !== pra) errors.push(`${player.name}: PRA inconsistente en ${period}`);
      if (number(value.points) !== null && number(value.threes) !== null && value.threes * 3 > value.points) errors.push(`${player.name}: triples incompatibles con puntos en ${period}`);
    }
    for (const metric of ['minutes', 'points', 'rebounds', 'assists', 'threes']) {
      const values = [...QUARTERS, 'ot'].filter(q => q !== 'ot' || game.overtime || player.periods?.ot).map(q => {
        const value = player.periods?.[q]; return value?.minutes === 0 ? 0 : number(value?.[metric]);
      });
      const sum = completeSum(values), final = number(player.periods?.ft?.[metric]);
      if (sum !== null && final !== null && Math.abs(sum - final) > (metric === 'minutes' ? 3 / 60 : 0)) errors.push(`${player.name}: ${metric} por cuartos difiere del final`);
    }
  }
  if (game.rosterComplete) {
    for (const side of ['home', 'away']) for (const q of QUARTERS) {
      const roster = (game.players || []).filter(player => player.team === game[side]);
      const points = completeSum(roster.map(player => player.periods?.[q]?.minutes === 0 ? 0 : number(player.periods?.[q]?.points)));
      if (roster.length && points !== null && teamValue(game.periods?.[side], q) !== null && points !== game.periods[side][q]) errors.push(`${side}: suma de puntos individuales difiere de ${q}`);
    }
  }
  return { valid: !errors.length, errors, missing, complete: !errors.length && !missing.length };
}

export function periodRecords(games, { league, season, kind, entity, period, metric = 'points', now = Date.now() }) {
  const records = [];
  for (const game of games) {
    if (game.league !== league || game.season !== season || !admissibleGame(game, now)) continue;
    const quality = inspectGame(game), common = { gameId: game.id, date: game.date, source: game.source, sourceUrl: game.sourceUrl,
      referenceOnly: game.referenceOnly === true, valid: quality.valid, quality, gameKey: gameKey(game) };
    if (kind === 'teams') {
      for (const side of ['home', 'away']) {
        if (game[side] !== entity) continue;
        const other = side === 'home' ? 'away' : 'home';
        const scored = teamValue(game.periods?.[side], period), conceded = teamValue(game.periods?.[other], period);
        const value = metric === 'conceded' ? conceded : metric === 'total' ? completeSum([scored, conceded]) : scored;
        records.push({ ...common, name: game[side], opponent: game[other], value, scored, conceded });
      }
    } else {
      for (const player of game.players || []) {
        if (playerKey(player) !== entity) continue;
        const values = playerPeriod(player, period);
        records.push({ ...common, name: player.name, team: player.team, opponent: game.home === player.team ? game.away : game.home,
          values, minutes: values?.minutes ?? null, value: values?.[metric] ?? null });
      }
    }
  }
  return records.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function usableHistory(records, depth = 20) {
  const groups = new Map();
  for (const record of records) {
    if (record.referenceOnly) continue;
    if (!groups.has(record.gameKey)) groups.set(record.gameKey, []);
    groups.get(record.gameKey).push(record);
  }
  const result = [], conflicts = [];
  for (const group of groups.values()) {
    const known = group.filter(record => record.valid && number(record.value) !== null && (record.minutes === undefined || number(record.minutes) > 0));
    const minutes = group.filter(record => record.valid && number(record.minutes) !== null).map(record => record.minutes);
    if (new Set(known.map(record => record.value)).size > 1 || (minutes.length > 1 && Math.max(...minutes) - Math.min(...minutes) > 3 / 60)) {
      conflicts.push(group[0]); result.push({ ...group[0], value: null, valid: false, conflict: true }); continue;
    }
    result.push(known[0] || { ...group[0], value: group[0].valid ? group[0].value : null });
  }
  // Missing recent records remain in the requested window; do not quietly extend it.
  const window = result.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, depth);
  return { window, values: window.filter(record => number(record.value) !== null && (record.minutes === undefined || number(record.minutes) > 0)), conflicts };
}

export function replayHistory(records, { line, depth = 20, minimum = 5 } = {}) {
  if (!Number.isFinite(line) || line < .5 || line % 1 !== .5) throw new Error('La linea debe terminar en .5.');
  if (![5, 10, 15, 20, 25, 30].includes(depth)) throw new Error('Ventana no admitida.');
  const { window: series, conflicts } = usableHistory(records, Number.MAX_SAFE_INTEGER);
  const ascending = [...series].reverse(), outcomes = [];
  for (const current of ascending) {
    if (number(current.value) === null || (current.minutes !== undefined && number(current.minutes) <= 0)) continue;
    const cutoff = Date.parse(current.date) - 4 * 3600_000;
    const prior = ascending.filter(record => Date.parse(record.date) < cutoff).slice(-depth);
    const training = prior.filter(record => number(record.value) !== null && (record.minutes === undefined || number(record.minutes) > 0));
    if (training.length < minimum) continue;
    const hits = training.filter(record => record.value > line).length;
    const probability = (hits + 1) / (training.length + 2), expected = training.reduce((sum, record) => sum + record.value, 0) / training.length;
    const actual = current.value > line ? 1 : 0;
    outcomes.push({ date: current.date, opponent: current.opponent, probability, expected, actual, value: current.value, n: training.length,
      brier: (probability - actual) ** 2, logLoss: -Math.log(actual ? probability : 1 - probability), error: Math.abs(expected - current.value), correct: Number((probability >= .5 ? 1 : 0) === actual) });
  }
  const mean = key => outcomes.length ? outcomes.reduce((sum, item) => sum + item[key], 0) / outcomes.length : null;
  const bins = Array.from({ length: 5 }, (_, index) => {
    const rows = outcomes.filter(item => Math.min(4, Math.floor(item.probability * 5)) === index);
    return { from: index * 20, to: (index + 1) * 20, n: rows.length,
      predicted: rows.length ? rows.reduce((sum, item) => sum + item.probability, 0) / rows.length : null,
      observed: rows.length ? rows.reduce((sum, item) => sum + item.actual, 0) / rows.length : null };
  });
  return { outcomes, n: outcomes.length, accuracy: mean('correct'), brier: mean('brier'), logLoss: mean('logLoss'), mae: mean('error'), bins,
    missing: ascending.filter(record => !record.conflict && (number(record.value) === null || (record.minutes !== undefined && number(record.minutes) <= 0))).length, conflicts: conflicts.length };
}

export function sourceDiscrepancies(samples, logs) {
  const result = [];
  for (const game of samples) for (const player of game.players || []) {
    const opponent = game.home === player.team ? game.away : game.home;
    for (const log of logs) {
      if (log.league !== game.league || log.season !== game.season || Date.parse(log.date) !== Date.parse(game.date) ||
        normalizeName(log.team) !== normalizeName(player.team) || normalizeName(log.opponent) !== normalizeName(opponent) || normalizeName(log.name) !== normalizeName(player.name)) continue;
      const changes = METRICS.filter(metric => metric !== 'pra' && number(player.periods?.ft?.[metric]) !== null && number(log.values?.[metric]) !== null && log.values[metric] !== player.periods.ft[metric]);
      if (changes.length) result.push({ game, player, log, changes });
    }
  }
  return result;
}

export function parsePeriodImport(payload, { rightsConfirmed = false, now = Date.now() } = {}) {
  if (!rightsConfirmed) throw new Error('Confirma que puedes utilizar estos registros.');
  if (payload?.schema !== 1 || typeof payload.license !== 'string' || !payload.license.trim() || payload.license.length > 500 || !Array.isArray(payload.games) || !payload.games.length || payload.games.length > 500) throw new Error('Archivo no valido: schema 1, licencia y entre 1 y 500 partidos.');
  const text = (value, label, maximum = 200) => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Falta o no es valido: ${label}.`); return value.trim(); };
  const value = (input, label, integer = true) => {
    if (input === null || input === undefined || input === '') return null;
    if (number(input) === null || input > 1000 || (integer && !Number.isInteger(input))) throw new Error(`Valor no valido: ${label}. Usa numeros o null.`);
    return input;
  };
  const ids = new Set();
  return payload.games.map(original => {
    const id = text(original.id, 'ID'), league = original.league;
    if (!['nba', 'euroleague', 'endesa'].includes(league) || !/^20\d{2}\/20\d{2}$/.test(original.season) || Number(original.season.slice(5)) !== Number(original.season.slice(0, 4)) + 1) throw new Error('Liga o temporada no valida.');
    if (original.finished !== true || original.preseason !== false || (league === 'nba' && original.phase !== 'regular')) throw new Error('Solo resultados finalizados, sin pretemporada; NBA requiere phase: regular.');
    if (typeof original.date !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(original.date) || !Number.isFinite(Date.parse(original.date)) || Date.parse(original.date) + 4 * 3600_000 >= now) throw new Error('Fecha pasada con zona horaria; espera al menos cuatro horas tras el inicio.');
    const sourceUrl = text(original.sourceUrl, 'URL de la fuente', 2000);
    const url = new URL(sourceUrl); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('URL de fuente no admitida.');
    const game = { id: `personal:${id}`, league, season: original.season, date: new Date(original.date).toISOString(),
      home: text(original.home, 'local'), away: text(original.away, 'visitante'), source: text(original.source, 'fuente'), sourceUrl,
      license: typeof original.license === 'string' ? text(original.license, 'licencia del partido', 500) : payload.license.trim(), finished: true, preseason: false, phase: original.phase || '', overtime: original.overtime === true,
      referenceOnly: false, importedAt: new Date(now).toISOString(), rosterComplete: original.rosterComplete === true, periods: {}, players: [] };
    if (normalizeName(game.home) === normalizeName(game.away)) throw new Error('Los equipos deben ser distintos.');
    for (const side of ['home', 'away']) game.periods[side] = Object.fromEntries([...QUARTERS, 'ht', 'ot', 'ft'].map(q => [q, value(original.periods?.[side]?.[q], `${side} ${q}`)]));
    if (!Array.isArray(original.players || []) || (original.players || []).length > 40) throw new Error('Maximo 40 jugadores por partido.');
    const playerIds = new Set();
    for (const input of original.players || []) {
      const player = { name: text(input.name, 'jugador'), team: text(input.team, 'equipo del jugador'), playerId: text(input.playerId, 'ID del jugador'), periods: {} };
      if (![game.home, game.away].includes(player.team) || playerIds.has(playerKey(player))) throw new Error('Equipo incorrecto o jugador duplicado.');
      playerIds.add(playerKey(player));
      for (const q of [...QUARTERS, 'ot', 'ft']) if (input.periods?.[q]) player.periods[q] = Object.fromEntries(['minutes', ...METRICS].map(metric => [metric, value(input.periods[q][metric], `${player.name}: ${q} ${metric}`, metric !== 'minutes')]));
      game.players.push(player);
    }
    const quality = inspectGame(game);
    if (!admissibleGame(game, now)) throw new Error('Partido fuera de las competiciones o fases admitidas.');
    if (!['home', 'away'].some(side => QUARTERS.some(q => game.periods[side][q] !== null)) && !game.players.some(player => QUARTERS.some(q => player.periods[q] && METRICS.some(metric => number(player.periods[q][metric]) !== null)))) throw new Error('El partido no contiene ningun dato por cuarto.');
    if (!quality.valid) throw new Error(`${id}: ${quality.errors.join('; ')}`);
    if (ids.has(gameKey(game))) throw new Error('Partido duplicado en el archivo.');
    ids.add(gameKey(game)); return game;
  });
}

export function mergePersonalGames(existing, incoming) {
  const merged = [...existing]; let added = 0;
  for (const game of incoming) {
    const original = merged.find(item => item.id === game.id || gameKey(item) === gameKey(game));
    if (original) {
      const comparable = item => JSON.stringify({ ...item, importedAt: null });
      if (comparable(original) !== comparable(game)) throw new Error(`Ya hay otro registro de ${game.home} - ${game.away}. No se sobrescribio.`);
    } else { merged.push(game); added++; }
  }
  if (merged.length > 2000) throw new Error('Limite local: 2.000 partidos. Exporta tu archivo antes de continuar.');
  return { games: merged, added };
}
