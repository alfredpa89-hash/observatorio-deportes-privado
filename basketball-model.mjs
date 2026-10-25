import { buildNbaReport, validMatch } from './nba.mjs';

export const MODEL_VERSION = 'basketball-2026-10-v2';
export const LEAGUES = {
  nba: { name: 'NBA', minutes: 48, total: 220.5, quarter: 55.5, half: 110.5 },
  euroleague: { name: 'Euroliga', minutes: 40, total: 160.5, quarter: 40.5, half: 80.5 },
};
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const variance = values => values.length > 1 ? values.reduce((a, b) => a + (b - mean(values)) ** 2, 0) / (values.length - 1) : null;
const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const round = value => finite(value) ? Math.round(value * 100) / 100 : null;
const clip = (value, min, max) => Math.max(min, Math.min(max, value));
export function cdf(z) {
  const sign = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return clip((1 + sign * erf) / 2, 0, 1);
}
export function availableTime(row) {
  // Historical feeds rarely have a final whistle timestamp. Six hours is a conservative fallback.
  const start = Date.parse(row.date);
  if (!Number.isFinite(start)) return NaN;
  const end = Date.parse(row.availableAfter || new Date(start + 6 * 3600000).toISOString());
  return end >= start ? end : NaN;
}
export function priorGames(matches, cutoff, league = 'nba') {
  const time = Date.parse(cutoff);
  if (!Number.isFinite(time)) throw new Error('Fecha de corte no valida.');
  return [...new Map(matches.filter(match => validMatch(match) && (!match.league || match.league === league) &&
    match.preseason !== true && availableTime(match) < time).map(match => [String(match.id), match])).values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
function scores(game, period = 'ft') {
  const field = period === 'q1' ? 'firstQuarterPoints' : 'halfTimePoints';
  const pair = period === 'ft' ? [game.homePoints, game.awayPoints] : [game.stats?.home?.[field], game.stats?.away?.[field]];
  return pair.every(finite) ? pair.map(Number) : null;
}
function rest(games, team, date) {
  const previous = games.filter(game => [game.home, game.away].includes(team) && Date.parse(game.date) < Date.parse(date)).at(-1);
  return previous ? clip((Date.parse(date) - Date.parse(previous.date)) / 86400000, 0, 4) : null;
}
function possession(stats) {
  const fields = ['fieldGoalsAttempted', 'freeThrowsAttempted', 'offensiveRebounds', 'turnovers'];
  if (!fields.every(field => finite(stats?.[field]))) return null;
  const value = stats.fieldGoalsAttempted + 0.44 * stats.freeThrowsAttempted - stats.offensiveRebounds + stats.turnovers;
  return value > 20 && value < 200 ? value : null;
}
function periodForecast(games, home, away, depth, date, period, neutral) {
  const context = games.slice(-800).filter(game => scores(game, period));
  const homeRows = context.filter(game => [game.home, game.away].includes(home)).slice(-depth);
  const awayRows = context.filter(game => [game.home, game.away].includes(away)).slice(-depth);
  if (context.length < 20 || homeRows.length < 5 || awayRows.length < 5) return null;
  const totals = context.map(game => scores(game, period).reduce((a, b) => a + b));
  const baseline = mean(totals) / 2;
  const homeAdvantage = mean(context.filter(game => !game.neutralSite).map(game => { const [h, a] = scores(game, period); return h - a; })) || 0;
  const teams = [...new Set(context.flatMap(game => [game.home, game.away]))];
  const attack = Object.fromEntries(teams.map(team => [team, 0]));
  const defense = { ...attack };
  // Regularized opponent adjustments are fitted only on the eligible past, separately for each period.
  for (let iteration = 0; iteration < 8; iteration++) {
    for (const team of teams) {
      const rows = context.filter(game => [game.home, game.away].includes(team)).slice(-depth);
      let a = 0, d = 0;
      for (const game of rows) {
        const atHome = game.home === team, pair = scores(game, period), rival = atHome ? game.away : game.home;
        const venue = game.neutralSite ? 0 : (atHome ? 1 : -1) * homeAdvantage / 2;
        a += pair[atHome ? 0 : 1] - baseline - venue - defense[rival];
        d += pair[atHome ? 1 : 0] - baseline + venue - attack[rival];
      }
      attack[team] = a / (rows.length + 8); defense[team] = d / (rows.length + 8);
    }
  }
  let homePoints = baseline + (neutral ? 0 : homeAdvantage / 2) + attack[home] + defense[away];
  let awayPoints = baseline - (neutral ? 0 : homeAdvantage / 2) + attack[away] + defense[home];
  const restHome = rest(games, home, date), restAway = rest(games, away, date);
  let restCoefficient = 0;
  if (period === 'ft') {
    const recentDate = new Map(); let numerator = 0, denominator = 50;
    for (const game of context) {
      const hd = recentDate.get(game.home), ad = recentDate.get(game.away);
      if (hd && ad) {
        const diff = clip((Date.parse(game.date) - hd) / 86400000, 0, 3) - clip((Date.parse(game.date) - ad) / 86400000, 0, 3);
        const residual = game.homePoints - game.awayPoints - (game.neutralSite ? 0 : homeAdvantage) - attack[game.home] - defense[game.away] + attack[game.away] + defense[game.home];
        numerator += diff * residual; denominator += diff * diff;
      }
      recentDate.set(game.home, Date.parse(game.date)); recentDate.set(game.away, Date.parse(game.date));
    }
    restCoefficient = clip(numerator / denominator, -3, 3);
    if (restHome !== null && restAway !== null) {
      const adjustment = restCoefficient * (Math.min(restHome, 3) - Math.min(restAway, 3)) / 2;
      homePoints += adjustment; awayPoints -= adjustment;
    }
  }
  let pace = null;
  if (period === 'ft') {
    const paceRows = rows => rows.flatMap(game => {
      const h = possession(game.stats?.home), a = possession(game.stats?.away);
      if (h === null || a === null || game.overtime) return [];
      const atHome = game.home === (rows === homeRows ? home : away), possessions = (h + a) / 2;
      return [{ possessions, attack: (atHome ? game.homePoints : game.awayPoints) / possessions,
        defense: (atHome ? game.awayPoints : game.homePoints) / possessions }];
    });
    const h = paceRows(homeRows), a = paceRows(awayRows);
    if (h.length >= 10 && a.length >= 10) {
      pace = mean([...h, ...a].map(row => row.possessions));
      const hp = pace * mean([mean(h.map(row => row.attack)), mean(a.map(row => row.defense))]);
      const ap = pace * mean([mean(a.map(row => row.attack)), mean(h.map(row => row.defense))]);
      homePoints = 0.6 * homePoints + 0.4 * hp; awayPoints = 0.6 * awayPoints + 0.4 * ap;
    }
  }
  const floor = period === 'ft' ? 225 : period === 'ht' ? 100 : 49;
  const uncertainty = Math.sqrt(1 + 1 / (homeRows.length + 8) + 1 / (awayRows.length + 8));
  return { home: homePoints, away: awayPoints, total: homePoints + awayPoints, margin: homePoints - awayPoints,
    totalSd: Math.sqrt(Math.max(floor, variance(totals) || floor)) * uncertainty,
    marginSd: Math.sqrt(Math.max(floor / 2, variance(context.map(game => { const [h, a] = scores(game, period); return h - a; })) || floor / 2)) * uncertainty,
    homeN: homeRows.length, awayN: awayRows.length, pace, restHome, restAway, restCoefficient };
}
export function temperatureProbability(probability, temperature = 1) {
  const p = clip(probability, 0.000001, 0.999999);
  return 1 / (1 + Math.exp(-Math.log(p / (1 - p)) / temperature));
}
export function buildBasketballReport(options = {}) {
  const league = options.league || 'nba', config = LEAGUES[league];
  if (!config) throw new Error('Competicion de baloncesto no valida.');
  const lookback = Number(options.lookback ?? 20);
  if (![5, 10, 15, 20, 25, 30].includes(lookback)) throw new Error('Selecciona 5, 10, 15, 20, 25 o 30 partidos.');
  const cutoff = options.cutoff || new Date().toISOString(), date = options.date || cutoff;
  if (Date.parse(date) < Date.parse(cutoff)) throw new Error('El encuentro no puede ser anterior al corte.');
  const games = priorGames((options.matches || []).filter(game => !options.season || !game.season || game.season <= options.season), cutoff, league);
  const totalLine = options.totalLine ?? config.total, spreadLine = options.spreadLine ?? -3.5;
  const quarterLine = options.quarterLine ?? config.quarter, halfLine = options.halfLine ?? config.half;
  for (const line of [totalLine, quarterLine, halfLine]) if (!finite(line) || line <= 0 || line > 500 || Number(line) % 1 !== 0.5) throw new Error('Los totales deben terminar en .5 y estar entre 0 y 500.');
  if (!finite(spreadLine) || Math.abs(spreadLine) > 100 || Number(spreadLine) % 1 !== 0 && Math.abs(Number(spreadLine) % 1) !== 0.5) throw new Error('Handicap no valido.');
  const base = buildNbaReport({ ...options, matches: games, lookback, cutoff, totalLine, spreadLine });
  const predictions = Object.fromEntries(['ft', 'q1', 'ht'].map(period => [period, periodForecast(games, options.home, options.away, lookback, date, period, options.neutralSite)]));
  const markets = [];
  const add = (id, label, group, raw, spec, n, complement = false) => {
    const calibration = options.calibration?.[group];
    const referenceLine = { total: config.total, spread: -3.5, 'q1-total': config.quarter, 'ht-total': config.half }[group];
    const matchesLine = spec.type === 'winner' || (group === 'spread' ? Number(spreadLine) === referenceLine : spec.line === referenceLine);
    const eligible = calibration && calibration.n >= 100 && calibration.lookback === lookback && matchesLine &&
      Date.parse(calibration.trainedThrough) < Date.parse(cutoff) && calibration.version === MODEL_VERSION;
    const p = raw === null ? null : eligible ? temperatureProbability(raw, calibration.temperature) : raw;
    const probability = round(p === null ? null : 100 * (complement ? 1 - p : p));
    markets.push({ id, label, group, probability, rawProbability: round(raw === null ? null : 100 * (complement ? 1 - raw : raw)),
      calibrated: Boolean(eligible && raw !== null), calibrationN: eligible ? calibration.n : 0, n, spec,
      quality: n < 10 ? 'muestra-limitada' : 'experimental' });
  };
  for (const period of ['ft', 'q1', 'ht']) {
    const f = predictions[period], n = f ? Math.min(f.homeN, f.awayN) : 0;
    const suffix = period === 'ft' ? ' (incluye prorroga)' : period === 'q1' ? ' 1Q' : ' al descanso';
    const prefix = period === 'ft' ? '' : `${period}-`;
    if (period === 'ft') {
      const p = f ? cdf(f.margin / f.marginSd) : null;
      add('home-win', 'Gana local' + suffix, 'winner', p, { type: 'winner', period, side: 'home' }, n);
      add('away-win', 'Gana visitante' + suffix, 'winner', p, { type: 'winner', period, side: 'away' }, n, true);
    } else {
      const lower = f ? cdf((-0.5 - f.margin) / f.marginSd) : null, upper = f ? cdf((0.5 - f.margin) / f.marginSd) : null;
      add(`${prefix}home-win`, 'Gana local' + suffix, `${period}-winner`, f ? 1 - upper : null, { type: 'winner', period, side: 'home' }, n);
      add(`${prefix}away-win`, 'Gana visitante' + suffix, `${period}-winner`, lower, { type: 'winner', period, side: 'away' }, n);
      add(`${prefix}draw`, 'Empate' + suffix, `${period}-winner`, f ? upper - lower : null, { type: 'winner', period, side: 'draw' }, n);
    }
    const line = Number(period === 'ft' ? totalLine : period === 'q1' ? quarterLine : halfLine);
    const p = f ? 1 - cdf((line - f.total) / f.totalSd) : null, group = period === 'ft' ? 'total' : `${period}-total`;
    add(`${prefix}total-over`, `Over ${line} puntos${suffix}`, group, p, { type: 'total', period, line, direction: 'over' }, n);
    add(`${prefix}total-under`, `Under ${line} puntos${suffix}`, group, p, { type: 'total', period, line, direction: 'under' }, n, true);
    if (period === 'ft') {
      const boundary = -Number(spreadLine), p = f ? 1 - cdf((Math.floor(boundary) + 0.5 - f.margin) / f.marginSd) : null;
      const push = f && Number.isInteger(Number(spreadLine)) && Number(spreadLine) !== 0 ? cdf((boundary + 0.5 - f.margin) / f.marginSd) - cdf((boundary - 0.5 - f.margin) / f.marginSd) : 0;
      add('spread-home', `Local ${spreadLine >= 0 ? '+' : ''}${spreadLine}${suffix}`, 'spread', p, { type: 'spread', period, side: 'home', line: Number(spreadLine) }, n);
      add('spread-away', `Visitante ${-spreadLine >= 0 ? '+' : ''}${-spreadLine}${suffix}`, 'spread', f ? 1 - p - push : null, { type: 'spread', period, side: 'away', line: -Number(spreadLine) }, n);
      if (push) for (const m of markets.filter(m => m.group === 'spread')) { m.probability = m.rawProbability; m.calibrated = false; m.pushProbability = round(push * 100); }
    }
  }
  const f = predictions.ft;
  base.meta = { ...base.meta, sport: 'basketball', league, competition: config.name, lookback, version: MODEL_VERSION, date,
    expectedHomePoints: round(f?.home), expectedAwayPoints: round(f?.away), expectedTotalPoints: round(f?.total), expectedMargin: round(f?.margin),
    periods: Object.fromEntries(Object.entries(predictions).map(([period, value]) => [period, value && Object.fromEntries(Object.entries(value).map(([key, value]) => [key, round(value)]))])),
    model: 'Ataque/defensa con ajuste por rival y regularizacion; descanso aprendido; ritmo cuando hay posesiones; modelos independientes FT, 1Q y descanso.' };
  for (const market of markets) market.observed = base.markets.find(item => item.id === market.id)?.observed;
  base.markets = markets;
  base.meta.totalStandardDeviation = round(f?.totalSd); base.meta.marginStandardDeviation = round(f?.marginSd);
  base.quality = { level: 'experimental', messages: [
    'Modelo experimental. Frecuencias historicas y probabilidades prepartido son medidas diferentes; no garantiza resultados ni rentabilidad.',
    'Sin feed gratuito verificado de lesiones o alineaciones. Las estimaciones no suponen que todos los jugadores esten disponibles.',
    'El historial puede incluir la temporada anterior; cambios de plantilla y entrenador no se verifican automaticamente.',
    f?.pace ? 'Ritmo estimado de posesiones con FGA, FTA, rebote ofensivo y perdidas; se omiten prorrogas para este ajuste.' : 'Sin suficientes registros completos de posesiones: el ajuste de ritmo no se aplica.',
    'NBA: solo temporada regular. Euroliga se evalua por separado. 1Q y descanso no se calculan como fracciones del marcador final.',
    markets.some(m => m.calibrated) ? 'Calibracion historica limitada a los escenarios con al menos 100 predicciones anteriores; no equivale a validacion futura.' : 'Sin calibracion suficiente. Los porcentajes se mantienen experimentales.',
    'La disponibilidad historica usa hora de finalizacion conocida o margen conservador de seis horas desde el inicio.',
  ] };
  return base;
}

export function forecastPlayer({ records = [], league = 'nba', season, team, player, cutoff, lookback = 20, projectedMinutes, status = 'unknown', line = 20.5, metric = 'points' }) {
  if (!LEAGUES[league] || !['points', 'rebounds', 'assists', 'pra', 'threes'].includes(metric) || ![5, 10, 15, 20, 25, 30].includes(Number(lookback))) throw new Error('Seleccion de jugador no valida.');
  if (!finite(line) || line < 0 || line > 200 || Number(line) % 1 !== 0.5) throw new Error('La linea individual debe terminar en .5.');
  if (!player?.trim()) throw new Error('Selecciona un jugador con historial.');
  if (!Number.isFinite(Date.parse(cutoff))) throw new Error('Fecha de corte no valida.');
  const all = records.filter(row => (row.league || (row.sport === 'nba' ? 'nba' : null)) === league && row.name === player && (!team || row.team === team) &&
    (!season || !row.season || row.season <= season) && availableTime(row) < Date.parse(cutoff) && finite(row.minutes) && row.minutes > 0).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const selected = all.slice(-Number(lookback));
  const usable = selected.filter(row => finite(row.values?.[metric]));
  const recentMinutes = mean(selected.slice(-5).map(row => row.minutes)), overallMinutes = mean(selected.map(row => row.minutes));
  const minutes = projectedMinutes === undefined || projectedMinutes === '' ? selected.length ? 0.65 * recentMinutes + 0.35 * overallMinutes : null : Number(projectedMinutes);
  if (minutes !== null && (!finite(minutes) || minutes < 1 || minutes > LEAGUES[league].minutes + 20)) throw new Error('Minutos proyectados no validos.');
  if (!['unknown', 'active', 'out', 'questionable'].includes(status)) throw new Error('Disponibilidad no valida.');
  const weights = usable.map((row, index) => 0.95 ** (usable.length - 1 - index));
  const rate = usable.length ? usable.reduce((sum, row, index) => sum + weights[index] * row.values[metric], 0) / usable.reduce((sum, row, index) => sum + weights[index] * row.minutes, 0) : null;
  const expected = usable.length >= 5 && status !== 'out' ? rate * minutes : null;
  const deviation = usable.length >= 5 ? Math.sqrt(Math.max(metric === 'threes' ? 1 : 4, variance(usable.map(row => row.values[metric])) || 0)) * Math.sqrt(1 + 1 / usable.length) : null;
  const over = expected === null ? null : round(100 * (1 - cdf((line - expected) / deviation)));
  return { player, team, league, metric, line: Number(line), n: usable.length, history: selected,
    average: round(mean(usable.map(row => row.values[metric]))), averageMinutes: round(mean(selected.map(row => row.minutes))),
    projectedMinutes: round(minutes), expected: round(expected), over, under: over === null ? null : round(100 - over), status,
    conditionalOnPlaying: true, calibrated: false,
    note: status === 'out' ? 'Jugador marcado como baja: sin pronostico.' : 'Probabilidades experimentales condicionadas a jugar; sin alineacion verificada. Minutos proyectados no son minutos confirmados.' };
}

export function marketOutcome(market, game, players = []) {
  const spec = market.spec;
  if (!spec || !game || !validMatch(game)) return null;
  if (spec.type === 'player') {
    const row = players.find(row => String(row.matchId) === String(game.id) && row.name === spec.player && row.team === spec.team);
    if (!row || !finite(row.values?.[spec.metric]) || !finite(row.minutes) || row.minutes <= 0) return null;
    const value = row.values[spec.metric];
    return spec.direction === 'over' ? Number(value > spec.line) : Number(value < spec.line);
  }
  const pair = scores(game, spec.period);
  if (!pair) return null;
  const [h, a] = pair;
  if (spec.type === 'winner') return Number(spec.side === 'home' ? h > a : spec.side === 'away' ? a > h : h === a);
  if (spec.type === 'total') return Number(spec.direction === 'over' ? h + a > spec.line : h + a < spec.line);
  if (spec.type === 'spread') { const margin = (spec.side === 'home' ? h - a : a - h) + spec.line; return margin === 0 ? 'push' : Number(margin > 0); }
  return null;
}
