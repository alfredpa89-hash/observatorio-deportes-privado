import { buildBasketballReport, MODEL_VERSION, LEAGUES, priorGames, marketOutcome, temperatureProbability, mean } from './basketball-model.mjs';
import { gameKey } from './basketball-data.mjs';

const round = value => Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
export function evaluate(records) {
  const usable = records.filter(row => [0, 1].includes(row.outcome) && Number.isFinite(row.probability));
  const n = usable.length;
  const bins = Array.from({ length: 10 }, (_, index) => {
    const selected = usable.filter(row => Math.min(9, Math.floor(row.probability * 10)) === index);
    const hits = selected.reduce((sum, row) => sum + row.outcome, 0), count = selected.length;
    const p = count ? hits / count : null, z = 1.96, denominator = 1 + z * z / (count || 1);
    const center = p === null ? null : (p + z * z / (2 * count)) / denominator;
    const radius = p === null ? null : z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
    return { from: index * 10, to: (index + 1) * 10, n: count, predicted: count ? round(mean(selected.map(row => row.probability)) * 100) : null,
      observed: p === null ? null : round(p * 100), low: center === null ? null : round(100 * (center - radius)), high: center === null ? null : round(100 * (center + radius)) };
  });
  return { n, correct: usable.filter(row => Number(row.probability >= 0.5) === row.outcome).length,
    accuracy: n ? round(100 * usable.filter(row => Number(row.probability >= 0.5) === row.outcome).length / n) : null,
    brier: n ? round(mean(usable.map(row => (row.probability - row.outcome) ** 2))) : null,
    logLoss: n ? round(mean(usable.map(row => { const p = Math.max(0.000001, Math.min(0.999999, row.probability)); return -(row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p)); }))) : null,
    bins, pushes: records.filter(row => row.outcome === 'push').length, missing: records.filter(row => row.outcome === null).length,
    note: n < 100 ? 'Muestra insuficiente para concluir eficacia.' : 'Validar estabilidad en otras fechas y temporadas; no implica rentabilidad.' };
}
export function fitCalibration(rows, trainedThrough, lookback = 20) {
  const calibration = {};
  for (const group of ['winner', 'total', 'spread', 'q1-total', 'ht-total']) {
    const selected = rows.filter(row => row.group === group && [0, 1].includes(row.outcome) && Number.isFinite(row.probability));
    if (selected.length < 100) continue;
    let best = 1, loss = Infinity;
    for (let t = 0.5; t <= 3.001; t += 0.1) {
      const score = mean(selected.map(row => { const p = temperatureProbability(row.probability, t); return -(row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p)); }));
      if (score < loss) { best = Math.round(t * 10) / 10; loss = score; }
    }
    calibration[group] = { temperature: best, n: selected.length, trainedThrough, version: MODEL_VERSION, lookback };
  }
  return calibration;
}

const selectedMarkets = report => report.markets.filter(market => ['home-win', 'total-over', 'spread-home', 'q1-total-over', 'ht-total-over'].includes(market.id));
export function historicalEvaluation({ matches, league = 'nba', lookback = 20, season }) {
  const config = LEAGUES[league];
  if (!config) throw new Error('Liga no valida.');
  const all = priorGames(matches, '2100-01-01T00:00:00Z', league);
  const selected = all.filter(game => !season || game.season === season);
  if (selected.length < 100) throw new Error('Se requieren al menos 100 resultados para separar aprendizaje y comprobacion historica.');
  const boundary = Math.floor(selected.length * 0.7), calibrationRows = [], validationRows = [], predictions = [];
  const trainedThrough = new Date(Date.parse(selected[boundary].date) - 1).toISOString();
  let calibration = {}, skipped = 0;
  for (let index = 0; index < selected.length; index++) {
    const game = selected[index];
    if (index === boundary) calibration = fitCalibration(calibrationRows.filter(row => row.availableAt < Date.parse(trainedThrough)), trainedThrough, lookback);
    const report = buildBasketballReport({ matches: all, league, season: game.season, home: game.home, away: game.away,
      cutoff: game.date, date: game.date, lookback, neutralSite: game.neutralSite, calibration: index >= boundary ? calibration : undefined });
    const ft = report.meta.periods.ft;
    if (!ft || ft.homeN < lookback || ft.awayN < lookback) { skipped++; continue; }
    const rows = selectedMarkets(report).filter(market => market.probability !== null).map(market => ({ group: market.group,
      probability: market.probability / 100, outcome: marketOutcome(market, game), gameId: game.id,
      availableAt: Date.parse(game.availableAfter || new Date(Date.parse(game.date) + 6 * 3600000).toISOString()) }));
    if (index < boundary) calibrationRows.push(...rows);
    else {
      validationRows.push(...rows);
      const prior = priorGames(all.filter(item => !item.season || item.season <= game.season), game.date, league).slice(-800);
      const homeRate = mean(prior.filter(item => !item.neutralSite).map(item => Number(item.homePoints > item.awayPoints))) ?? 0.5;
      predictions.push({ gameId: game.id, date: game.date, predictedTotal: report.meta.expectedTotalPoints,
        total: game.homePoints + game.awayPoints, baselineTotal: mean(prior.map(item => item.homePoints + item.awayPoints)),
        baselineProbability: game.neutralSite ? 0.5 : homeRate, homeWin: Number(game.homePoints > game.awayPoints),
        expectedPeriods: report.meta.periods, actualPeriods: Object.fromEntries(['q1', 'ht'].map(period => {
          const field = period === 'q1' ? 'firstQuarterPoints' : 'halfTimePoints', h = game.stats?.home?.[field], a = game.stats?.away?.[field];
          return [period, h != null && a != null ? h + a : null];
        })) });
    }
  }
  const summary = Object.fromEntries(['winner', 'total', 'spread', 'q1-total', 'ht-total'].map(group => [group, evaluate(validationRows.filter(row => row.group === group))]));
  const mae = field => { const rows = predictions.filter(row => field === 'ft' || row.actualPeriods[field] !== null && row.expectedPeriods[field]);
    return round(mean(rows.map(row => Math.abs((field === 'ft' ? row.predictedTotal : row.expectedPeriods[field].total) - (field === 'ft' ? row.total : row.actualPeriods[field]))))); };
  return { league, season, lookback, version: MODEL_VERSION, calibration, summary, skipped, n: predictions.length,
    first: predictions[0]?.date || null, last: predictions.at(-1)?.date || null,
    mae: { ft: mae('ft'), q1: mae('q1'), ht: mae('ht'), baseline: round(mean(predictions.map(row => Math.abs(row.baselineTotal - row.total)))) },
    baseline: evaluate(predictions.map(row => ({ probability: row.baselineProbability, outcome: row.homeWin }))),
    method: 'Comprobacion cronologica: 70% inicial para calibracion y 30% final para validacion. Cada prediccion utiliza solo partidos finalizados antes del inicio. Modelo y ventana fijados antes de la prueba futura.',
    lines: { total: config.total, quarter: config.quarter, half: config.half, spread: -3.5 },
    note: 'Lineas de investigacion, no cuotas historicas de casas. No prueba rentabilidad. Lesiones historicas no reconstruidas. Datos pueden haber sido corregidos por el proveedor.' };
}

export function prospectiveEvaluation(snapshots, games, players = []) {
  const byId = new Map(games.map(game => [String(game.id), game]));
  const byIdentity = new Map(games.map(game => [gameKey(game), game]));
  const groups = {};
  let completed = 0, pending = 0, missingMarkets = 0, rescheduled = 0;
  const outcomes = [], baselineRows = [], baselineErrors = [], pointErrors = { ft: [], q1: [], ht: [] };
  for (const snapshot of snapshots) {
    const game = byId.get(String(snapshot.fixture.id)) || byIdentity.get(gameKey(snapshot.fixture));
    if (game && Math.abs(Date.parse(game.date) - Date.parse(snapshot.fixture.date)) > 6 * 3600000) { rescheduled++; continue; }
    if (!game || !game.finished || Date.parse(snapshot.createdAt) >= Date.parse(snapshot.fixture.date)) { pending++; continue; }
    completed++;
    if (snapshot.baseline?.probability != null) baselineRows.push({ probability: snapshot.baseline.probability, outcome: Number(game.homePoints > game.awayPoints) });
    if (snapshot.baseline?.total != null) baselineErrors.push(Math.abs(snapshot.baseline.total - game.homePoints - game.awayPoints));
    for (const market of snapshot.markets) {
      if (market.probability === null) continue;
      const outcome = marketOutcome(market, game, players), key = market.group;
      const record = { probability: market.probability / 100, outcome };
      // Complementary sides are the same trial, not two independent observations.
      const canonical = market.spec.type === 'total' || market.spec.type === 'player' ? market.spec.direction === 'over' : market.spec.side === 'home';
      if (canonical) (groups[key] ||= []).push(record);
      if (outcome === null) missingMarkets++;
      outcomes.push({ snapshotId: snapshot.id, marketId: market.id, outcome });
    }
    for (const period of ['ft', 'q1', 'ht']) {
      const expected = snapshot.predictions?.[period]?.total;
      const field = period === 'q1' ? 'firstQuarterPoints' : 'halfTimePoints';
      const h = period === 'ft' ? game.homePoints : game.stats?.home?.[field], a = period === 'ft' ? game.awayPoints : game.stats?.away?.[field];
      if (expected != null && h != null && a != null) pointErrors[period].push(Math.abs(expected - h - a));
    }
  }
  return { frozen: snapshots.length, completed, pending, missingMarkets, rescheduled,
    summary: Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group, evaluate(rows)])),
    mae: Object.fromEntries(Object.entries(pointErrors).map(([period, rows]) => [period, { n: rows.length, value: round(mean(rows)) }])),
    baseline: { ...evaluate(baselineRows), totalMae: round(mean(baselineErrors)), totalN: baselineErrors.length }, outcomes,
    note: 'Solo pronosticos sellados antes del inicio. Resultados faltantes y DNP no cuentan como fallos ni como ceros. Octubre es una prueba exploratoria, no una garantia de eficacia.' };
}
