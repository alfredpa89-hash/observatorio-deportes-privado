import { handicapDefinitions, settleHandicap, settlementSummary, SETTLEMENTS, roundedShares } from './public/football-handicap.js';

const DEFAULT_LINES = {
  goals: [1.5, 2.5, 3.5, 4.5],
  corners: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  fouls: [21.5, 24.5, 27.5],
  cards: [2.5, 3.5, 4.5, 5.5, 6.5],
  yellow: [2.5, 3.5, 4.5, 5.5, 6.5],
  red: [0.5, 1.5, 2.5],
  offsides: [1.5, 2.5, 3.5, 4.5],
  shotsOnTarget: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  halfTimeGoals: [0.5, 1.5, 2.5],
  halfTimeCorners: [1.5, 2.5, 3.5, 4.5],
};

const MARKET_GROUPS = {
  goals: { group: 'goles', id: 'goals', label: 'goles' },
  corners: { group: 'corners', id: 'corners', label: 'córners' },
  halfTimeGoals: { group: 'goles-1t', id: 'half-time-goals', label: 'goles en el primer tiempo' },
  halfTimeCorners: { group: 'corners-1t', id: 'half-time-corners', label: 'córners en el primer tiempo' },
  fouls: { group: 'faltas', id: 'fouls', label: 'faltas' },
  cards: { group: 'tarjetas', id: 'cards', label: 'tarjetas' },
  yellow: { group: 'tarjetas-amarillas', id: 'yellow-cards', label: 'tarjetas amarillas' },
  red: { group: 'tarjetas-rojas', id: 'red-cards', label: 'tarjetas rojas', overOnly: true },
  offsides: { group: 'fuera-de-juego', id: 'offsides', label: 'fueras de juego' },
  shotsOnTarget: {
    group: 'tiros-al-arco',
    id: 'shots-on-target',
    label: 'tiros al arco',
  },
};

const PRIOR_MATCHES = 8;
const MIN_LEAGUE_MATCHES = 10;
const MIN_TEAM_MATCHES = 3;
const ADEQUATE_LEAGUE_MATCHES = 100;
const ADEQUATE_TEAM_MATCHES = 10;

function nonNegativeInteger(value) {
  if (value === null || value === undefined ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function dateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function teamKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es');
}

function seasonYears(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const years = [...text.matchAll(/(?:19|20)\d{2}/g)].map(match => Number(match[0]));
  if (!years.length) return null;
  let end = years[1] ?? years[0];
  if (years.length === 1) {
    const shortEnd = text.match(/(?:19|20)\d{2}\s*[-/]\s*(\d{2})(?!\d)/);
    if (shortEnd) {
      end = Math.floor(years[0] / 100) * 100 + Number(shortEnd[1]);
      if (end < years[0]) end += 100;
    }
  }
  return { start: years[0], end };
}

export function belongsToSelectedHistory(match, selectedSeason) {
  if (selectedSeason === null || selectedSeason === undefined || selectedSeason === '') return true;
  const target = seasonYears(selectedSeason);
  const matchSeason = seasonYears(match.season);
  if (target && matchSeason) return matchSeason.start <= target.start;
  if (target) return new Date(match.date).getUTCFullYear() <= target.end;
  return String(match.season) === String(selectedSeason);
}

export function isFinished(match) {
  if (match.finished === false) return false;
  const status = match.status?.short ?? match.status;
  if (status !== null && status !== undefined && status !== '') {
    const finalStatus = /^(ft|aet|pen|final|finished|completed|match finished|after extra time|after penalties)$/i;
    if (!finalStatus.test(String(status).trim())) return false;
  }
  return nonNegativeInteger(match.homeGoals) !== null &&
    nonNegativeInteger(match.awayGoals) !== null;
}

export function metricPair(match, metric) {
  if (metric === 'halfTimeGoals' || metric === 'halfTimeCorners') {
    const field = metric === 'halfTimeGoals' ? 'Goals' : 'Corners';
    const pair = [nonNegativeInteger(match.halfTime?.[`home${field}`]), nonNegativeInteger(match.halfTime?.[`away${field}`])];
    const totals = metric === 'halfTimeGoals'
      ? [nonNegativeInteger(match.homeGoals), nonNegativeInteger(match.awayGoals)]
      : [nonNegativeInteger(match.stats?.home?.corners), nonNegativeInteger(match.stats?.away?.corners)];
    if (pair.some((value, index) => value !== null && totals[index] !== null && value > totals[index])) return [null, null];
    return pair;
  }
  if (metric === 'goals') {
    return [nonNegativeInteger(match.homeGoals), nonNegativeInteger(match.awayGoals)];
  }
  const home = match.stats?.home;
  const away = match.stats?.away;
  if (metric === 'cards') {
    const homeYellow = nonNegativeInteger(home?.yellow);
    const homeRed = nonNegativeInteger(home?.red);
    const awayYellow = nonNegativeInteger(away?.yellow);
    const awayRed = nonNegativeInteger(away?.red);
    if ([homeYellow, homeRed, awayYellow, awayRed].some(value => value === null)) {
      return [null, null];
    }
    return [homeYellow + homeRed, awayYellow + awayRed];
  }
  return [nonNegativeInteger(home?.[metric]), nonNegativeInteger(away?.[metric])];
}

function metricTotal(match, metric) {
  const [home, away] = metricPair(match, metric);
  return home === null || away === null ? null : home + away;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, places = 2) {
  return value === null ? null : Number(value.toFixed(places));
}

function linesFor(metric, thresholds) {
  const requested = Array.isArray(thresholds?.[metric]) ? thresholds[metric] : [];
  const lines = [...DEFAULT_LINES[metric], ...requested.map(Number)]
    .filter(value => Number.isFinite(value) && value > 0 && value <= 100 &&
      Number.isInteger(value * 2) && !Number.isInteger(value));
  return [...new Set(lines)].sort((a, b) => a - b);
}

export function footballCountMarkets(thresholds = {}) {
  return Object.entries(MARKET_GROUPS).flatMap(([metric, config]) => linesFor(metric, thresholds).flatMap(line =>
    (config.overOnly ? ['over'] : ['over', 'under']).map(direction => ({
      metric, group: config.group, baseId: config.id, metricLabel: config.label,
      period: metric === 'halfTimeGoals' || metric === 'halfTimeCorners' ? 'ht' : 'ft',
      overOnly: Boolean(config.overOnly), line, direction,
      id: `${config.id}-${direction}-${line}`,
      label: `${direction === 'over' ? 'Más' : 'Menos'} de ${line} ${config.label}`,
    }))));
}

function leagueRates(matches, metric) {
  const pairs = matches.map(match => metricPair(match, metric))
    .filter(([home, away]) => home !== null && away !== null);
  return {
    home: mean(pairs.map(pair => pair[0])),
    away: mean(pairs.map(pair => pair[1])),
    totals: pairs.map(([home, away]) => home + away),
    n: pairs.length,
  };
}

function teamRateRatio(history, team, metric, role, rates) {
  const key = teamKey(team);
  const priorMean = (rates.home + rates.away) / 2;
  let observed = 0;
  let expected = 0;
  let count = 0;
  for (const match of history) {
    const [home, away] = metricPair(match, metric);
    if (home === null || away === null) continue;
    const teamAtHome = teamKey(match.home) === key;
    observed += role === 'for'
      ? (teamAtHome ? home : away)
      : (teamAtHome ? away : home);
    expected += role === 'for'
      ? (teamAtHome ? rates.home : rates.away)
      : (teamAtHome ? rates.away : rates.home);
    count += 1;
  }
  if (!count || priorMean <= 0) return 1;
  const ratio = (observed + PRIOR_MATCHES * priorMean) /
    (expected + PRIOR_MATCHES * priorMean);
  return Math.max(0.35, Math.min(2.8, ratio));
}

function projectedRates(metric, league, homeHistory, awayHistory, home, away) {
  const rates = leagueRates(league, metric);
  if (!rates.n || rates.home === null || rates.away === null) {
    return { ...rates, home: null, away: null, total: null };
  }
  const homeAttack = teamRateRatio(homeHistory, home, metric, 'for', rates);
  const awayDefense = teamRateRatio(awayHistory, away, metric, 'against', rates);
  const awayAttack = teamRateRatio(awayHistory, away, metric, 'for', rates);
  const homeDefense = teamRateRatio(homeHistory, home, metric, 'against', rates);
  const homeRate = Math.max(0, Math.min(5 * rates.home, rates.home * homeAttack * awayDefense));
  const awayRate = Math.max(0, Math.min(5 * rates.away, rates.away * awayAttack * homeDefense));
  return { ...rates, home: homeRate, away: awayRate, total: homeRate + awayRate };
}

function poissonMass(mean, max) {
  const values = [Math.exp(-mean)];
  for (let count = 1; count <= max; count += 1) {
    values.push(values[count - 1] * mean / count);
  }
  return values;
}

function scoreDistribution(homeMean, awayMean) {
  if (homeMean === null || awayMean === null) return null;
  const homeMass = poissonMass(homeMean, 18);
  const awayMass = poissonMass(awayMean, 18);
  const cells = [];
  let totalMass = 0;
  for (let home = 0; home < homeMass.length; home += 1) {
    for (let away = 0; away < awayMass.length; away += 1) {
      const mass = homeMass[home] * awayMass[away];
      cells.push({ home, away, mass });
      totalMass += mass;
    }
  }
  return cells.map(cell => ({ ...cell, mass: cell.mass / totalMass }));
}

function scoreProbability(cells, predicate) {
  return cells === null ? null : cells.reduce((sum, cell) =>
    sum + (predicate(cell.home, cell.away) ? cell.mass : 0), 0);
}

function countDispersion(totals) {
  if (totals.length < 30) return 0;
  const average = mean(totals);
  if (average === null || average <= 0) return 0;
  const variance = mean(totals.map(value => (value - average) ** 2));
  const raw = Math.max(0, (variance - average) / (average ** 2));
  return Math.min(1, raw * totals.length / (totals.length + 100));
}

function countUnderProbability(meanCount, line, dispersion) {
  if (meanCount === null) return null;
  const lastCount = Math.floor(line);
  if (meanCount === 0) return 1;
  if (dispersion < 0.0001) {
    return Math.min(1, poissonMass(meanCount, lastCount)
      .reduce((sum, mass) => sum + mass, 0));
  }
  const shape = 1 / dispersion;
  const success = shape / (shape + meanCount);
  let mass = success ** shape;
  let cumulative = mass;
  for (let count = 1; count <= lastCount; count += 1) {
    mass *= ((count - 1 + shape) / count) * (1 - success);
    cumulative += mass;
  }
  return Math.min(1, cumulative);
}

function percentage(probability) {
  return probability === null ? null : Math.round(100 * Math.max(0, Math.min(1, probability)));
}

function roundedOutcomePercentages(probabilities) {
  if (probabilities.some(value => value === null)) return [null, null, null];
  const raw = probabilities.map(value => value * 100);
  const rounded = raw.map(Math.floor);
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fractional: value - rounded[index] }))
    .sort((a, b) => b.fractional - a.fractional);
  for (let index = 0; index < remainder; index += 1) rounded[order[index].index] += 1;
  return rounded;
}

function outcomeFor(match, team, metric = 'goals') {
  const key = teamKey(team);
  const teamAtHome = teamKey(match.home) === key;
  const [home, away] = metricPair(match, metric);
  if (home === null || away === null) return null;
  const goalsFor = teamAtHome ? home : away;
  const goalsAgainst = teamAtHome ? away : home;
  return goalsFor > goalsAgainst ? 'win' : goalsFor < goalsAgainst ? 'loss' : 'draw';
}

export function observed(history, predicate) {
  let hits = 0;
  let n = 0;
  for (const match of history) {
    const event = predicate(match);
    if (event === null) continue;
    n += 1;
    if (event) hits += 1;
  }
  if (!n) return { hits, n, rate: null, interval95: null };
  const z = 1.959963984540054;
  const proportion = hits / n;
  const denominator = 1 + z ** 2 / n;
  const center = (proportion + z ** 2 / (2 * n)) / denominator;
  const halfWidth = z * Math.sqrt(proportion * (1 - proportion) / n + z ** 2 / (4 * n ** 2)) / denominator;
  return {
    hits,
    n,
    rate: round(proportion * 100, 1),
    interval95: {
      low: round(Math.max(0, center - halfWidth) * 100, 1),
      high: round(Math.min(1, center + halfWidth) * 100, 1),
    },
  };
}

function marketQuality(samples) {
  if (samples.league < MIN_LEAGUE_MATCHES ||
      samples.home < MIN_TEAM_MATCHES || samples.away < MIN_TEAM_MATCHES) {
    return 'unavailable';
  }
  if (samples.league < ADEQUATE_LEAGUE_MATCHES ||
      samples.home < ADEQUATE_TEAM_MATCHES || samples.away < ADEQUATE_TEAM_MATCHES) {
    return 'limited';
  }
  return 'adequate';
}

function createMarket({ group, id, label, probability, homeObserved, awayObserved, leagueN }) {
  const samples = { home: homeObserved.n, away: awayObserved.n, league: leagueN };
  const quality = marketQuality(samples);
  return {
    group,
    id,
    label,
    probability: quality === 'unavailable' ? null : percentage(probability),
    observed: { home: homeObserved, away: awayObserved },
    n: Math.min(samples.home, samples.away),
    samples,
    quality,
  };
}

function teamSummary(history, team) {
  const outcomes = history.map(match => outcomeFor(match, team));
  const key = teamKey(team);
  const forAndAgainst = metric => {
    const values = history.flatMap(match => {
      const [home, away] = metricPair(match, metric);
      if (home === null || away === null) return [];
      return [teamKey(match.home) === key ? [home, away] : [away, home]];
    });
    return {
      for: round(mean(values.map(pair => pair[0]))),
      against: round(mean(values.map(pair => pair[1]))),
      n: values.length,
    };
  };
  return {
    team,
    played: history.length,
    wins: outcomes.filter(value => value === 'win').length,
    draws: outcomes.filter(value => value === 'draw').length,
    losses: outcomes.filter(value => value === 'loss').length,
    homePlayed: history.filter(match => teamKey(match.home) === key).length,
    awayPlayed: history.filter(match => teamKey(match.away) === key).length,
    averages: {
      goals: forAndAgainst('goals'),
      shots: forAndAgainst('shots'),
      shotsOnTarget: forAndAgainst('shotsOnTarget'),
      corners: forAndAgainst('corners'),
      fouls: forAndAgainst('fouls'),
      cards: forAndAgainst('cards'),
      yellow: forAndAgainst('yellow'),
      red: forAndAgainst('red'),
      offsides: forAndAgainst('offsides'),
      halfTimeGoals: forAndAgainst('halfTimeGoals'),
      halfTimeCorners: forAndAgainst('halfTimeCorners'),
    },
  };
}

export function buildReport({
  matches,
  leagueKey,
  leagueName = null,
  season = null,
  home,
  away,
  lookback = 10,
  cutoff = null,
  thresholds = {},
}) {
  if (!Array.isArray(matches)) throw new TypeError('matches debe ser un arreglo');
  if (!leagueKey || !home || !away || teamKey(home) === teamKey(away)) {
    throw new TypeError('Liga y dos equipos distintos son obligatorios');
  }
  const sampleSize = Number(lookback);
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 100) {
    throw new RangeError('lookback debe ser un entero entre 1 y 100');
  }
  const cutoffTime = cutoff === null ? Date.now() : dateValue(cutoff);
  if (cutoffTime === null) throw new RangeError('cutoff debe ser una fecha válida');

  const league = matches.filter(match =>
    String(match.leagueKey) === String(leagueKey) &&
    isFinished(match) &&
    dateValue(match.date) !== null &&
    dateValue(match.date) < cutoffTime &&
    belongsToSelectedHistory(match, season))
    .sort((a, b) => dateValue(b.date) - dateValue(a.date));
  const homeKey = teamKey(home);
  const awayKey = teamKey(away);
  const homeHistory = league.filter(match =>
    teamKey(match.home) === homeKey || teamKey(match.away) === homeKey)
    .slice(0, sampleSize);
  const awayHistory = league.filter(match =>
    teamKey(match.home) === awayKey || teamKey(match.away) === awayKey)
    .slice(0, sampleSize);
  const h2h = league.filter(match =>
    (teamKey(match.home) === homeKey && teamKey(match.away) === awayKey) ||
    (teamKey(match.home) === awayKey && teamKey(match.away) === homeKey))
    .slice(0, sampleSize);
  const leagueReference = league.slice(0, 500);
  const leagueAverages = {};
  for (const metric of ['goals', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'cards', 'yellow', 'red', 'offsides', 'halfTimeGoals', 'halfTimeCorners']) {
    const rates = leagueRates(leagueReference, metric);
    leagueAverages[metric] = {
      home: round(rates.home),
      away: round(rates.away),
      total: rates.n ? round(rates.home + rates.away) : null,
      n: rates.n,
    };
  }
  const goals = projectedRates('goals', leagueReference, homeHistory, awayHistory, home, away);
  const score = scoreDistribution(goals.home, goals.away);
  const halfGoals = projectedRates('halfTimeGoals', leagueReference, homeHistory, awayHistory, home, away);
  const halfScore = scoreDistribution(halfGoals.home, halfGoals.away);
  const markets = [];

  const outcomes = [
    { id: 'result-home', label: `Gana ${home}`, event: (h, a) => h > a, homeOutcome: 'win', awayOutcome: 'loss' },
    { id: 'result-draw', label: 'Empate', event: (h, a) => h === a, homeOutcome: 'draw', awayOutcome: 'draw' },
    { id: 'result-away', label: `Gana ${away}`, event: (h, a) => h < a, homeOutcome: 'loss', awayOutcome: 'win' },
  ];
  const outcomeRaw = outcomes.map(item => scoreProbability(score, item.event));
  const outcomeRounded = roundedOutcomePercentages(outcomeRaw);
  outcomes.forEach((item, index) => {
    const market = createMarket({
      group: 'resultado', id: item.id, label: item.label,
      probability: outcomeRaw[index],
      homeObserved: observed(homeHistory, match => outcomeFor(match, home) === item.homeOutcome),
      awayObserved: observed(awayHistory, match => outcomeFor(match, away) === item.awayOutcome),
      leagueN: goals.n,
    });
    if (market.probability !== null) market.probability = outcomeRounded[index];
    markets.push(market);
  });

  const halfOutcomeRaw = outcomes.map(item => scoreProbability(halfScore, item.event));
  const halfOutcomeRounded = roundedOutcomePercentages(halfOutcomeRaw);
  outcomes.forEach((item, index) => {
    const frequency = (history, team, expected) => observed(history, match => {
      const outcome = outcomeFor(match, team, 'halfTimeGoals');
      return outcome === null ? null : outcome === expected;
    });
    const market = createMarket({
      group: 'resultado-1t', id: item.id.replace('result-', 'half-time-result-'),
      label: `${index === 0 ? 'Gana local' : index === 1 ? 'Empate' : 'Gana visitante'} en el primer tiempo`,
      probability: halfOutcomeRaw[index],
      homeObserved: frequency(homeHistory, home, item.homeOutcome),
      awayObserved: frequency(awayHistory, away, item.awayOutcome), leagueN: halfGoals.n,
    });
    if (market.probability !== null) market.probability = halfOutcomeRounded[index];
    markets.push(market);
  });

  for (const [id, label, excludedIndex, homeExcluded, awayExcluded] of [
    ['double-chance-1x', '1X · Local o empate', 2, 'loss', 'win'],
    ['double-chance-x2', 'X2 · Visitante o empate', 0, 'win', 'loss'],
    ['double-chance-12', '12 · Local o visitante', 1, 'draw', 'draw'],
  ]) {
    const market = createMarket({
      group: 'doble-oportunidad', id, label,
      probability: outcomeRaw[excludedIndex] === null ? null : 1 - outcomeRaw[excludedIndex],
      homeObserved: observed(homeHistory, match => outcomeFor(match, home) !== homeExcluded),
      awayObserved: observed(awayHistory, match => outcomeFor(match, away) !== awayExcluded),
      leagueN: goals.n,
    });
    if (market.probability !== null) market.probability = 100 - outcomeRounded[excludedIndex];
    markets.push(market);
  }

  const bttsYes = scoreProbability(score, (h, a) => h > 0 && a > 0);
  for (const [id, label, yes] of [
    ['btts-yes', 'Ambos marcan: Sí', true],
    ['btts-no', 'Ambos marcan: No', false],
  ]) {
    markets.push(createMarket({
      group: 'ambos-marcan', id, label,
      probability: bttsYes === null ? null : yes ? bttsYes : 1 - bttsYes,
      homeObserved: observed(homeHistory, match =>
        yes ? match.homeGoals > 0 && match.awayGoals > 0 :
          !(match.homeGoals > 0 && match.awayGoals > 0)),
      awayObserved: observed(awayHistory, match =>
        yes ? match.homeGoals > 0 && match.awayGoals > 0 :
          !(match.homeGoals > 0 && match.awayGoals > 0)),
      leagueN: goals.n,
    }));
  }

  for (const metric of Object.keys(DEFAULT_LINES)) {
    const config = MARKET_GROUPS[metric];
    const rates = metric === 'goals' ? goals : metric === 'halfTimeGoals' ? halfGoals :
      projectedRates(metric, leagueReference, homeHistory, awayHistory, home, away);
    const isGoalMetric = metric === 'goals' || metric === 'halfTimeGoals';
    const metricScore = metric === 'goals' ? score : metric === 'halfTimeGoals' ? halfScore : null;
    const dispersion = isGoalMetric ? 0 : countDispersion(rates.totals);
    const probabilityUnder = line => isGoalMetric
      ? scoreProbability(metricScore, (h, a) => h + a < line)
      : countUnderProbability(rates.total, line, dispersion);
    const appendThreshold = (line, over) => {
      const event = match => {
        const total = metricTotal(match, metric);
        return total === null ? null : over ? total > line : total < line;
      };
      const under = probabilityUnder(line);
      const probability = under === null ? null : over ? 1 - under : under;
      markets.push(createMarket({
        group: config.group,
        id: `${config.id}-${over ? 'over' : 'under'}-${line}`,
        label: `${over ? 'Más' : 'Menos'} de ${line} ${config.label}`,
        probability,
        homeObserved: observed(homeHistory, event),
        awayObserved: observed(awayHistory, event),
        leagueN: rates.n,
      }));
    };
    for (const line of linesFor(metric, thresholds)) {
      appendThreshold(line, true);
      if (!config.overOnly) appendThreshold(line, false);
    }
  }

  function historicalHandicap(history, team, definition, teamIsHome) {
    const metric = definition.period === 'ht' ? 'halfTimeGoals' : 'goals';
    return history.map(match => {
      const pair = metricPair(match, metric);
      const forTeam = teamKey(match.home) === teamKey(team) ? pair : [pair[1], pair[0]];
      const homePair = teamIsHome ? forTeam : [forTeam[1], forTeam[0]];
      const oriented = definition.handicapKind === 'asian' && definition.side === 'away' ? [homePair[1], homePair[0]] : homePair;
      return settleHandicap(...oriented, definition.line, definition.handicapKind);
    });
  }
  for (const definition of handicapDefinitions(thresholds, { home, away })) {
    const cells = definition.period === 'ht' ? halfScore : score, rates = definition.period === 'ht' ? halfGoals : goals;
    const homeEvents = historicalHandicap(homeHistory, home, definition, true), awayEvents = historicalHandicap(awayHistory, away, definition, false);
    const keys = definition.handicapKind === 'asian' ? Object.keys(SETTLEMENTS) : ['home', 'draw', 'away'];
    const weights = Object.fromEntries(keys.map(key => [key, 0]));
    if (cells) for (const cell of cells) {
      const pair = definition.handicapKind === 'asian' && definition.side === 'away' ? [cell.away, cell.home] : [cell.home, cell.away];
      weights[settleHandicap(...pair, definition.line, definition.handicapKind)] += cell.mass;
    }
    const shares = roundedShares(Object.values(weights)), distribution = Object.fromEntries(keys.map((key, i) => [key, shares[i]]));
    const outcome = definition.handicapKind === 'asian' ? 'fullWin' : definition.side;
    const market = createMarket({ ...definition, probability: distribution[outcome] === null ? null : distribution[outcome] / 100,
      homeObserved: observed(homeEvents, value => value === null ? null : value === outcome),
      awayObserved: observed(awayEvents, value => value === null ? null : value === outcome), leagueN: rates.n });
    markets.push({ ...market, ...definition,
      probability: market.quality === 'unavailable' ? null : distribution[outcome],
      ...(definition.handicapKind === 'asian' ? { settlement: market.quality === 'unavailable' ? null : distribution,
        historicalSettlement: { home: settlementSummary(homeEvents), away: settlementSummary(awayEvents) } } : {}) });
  }

  const coverage = {};
  for (const metric of Object.keys(DEFAULT_LINES)) {
    const leagueN = leagueReference.filter(match => metricTotal(match, metric) !== null).length;
    coverage[metric] = {
      league: leagueN,
      home: homeHistory.filter(match => metricTotal(match, metric) !== null).length,
      away: awayHistory.filter(match => metricTotal(match, metric) !== null).length,
    };
  }
  const statuses = markets.map(market => market.quality);
  const status = statuses.every(value => value === 'unavailable') ? 'unavailable' :
    statuses.some(value => value !== 'adequate') ? 'limited' : 'adequate';
  const messages = [];
  if (!league.length) messages.push('No hay partidos finalizados antes de la fecha de corte.');
  if (homeHistory.length < sampleSize || awayHistory.length < sampleSize) {
    messages.push('Uno o ambos equipos tienen menos partidos que la muestra solicitada.');
  }
  for (const metric of Object.keys(DEFAULT_LINES)) {
    if (marketQuality(coverage[metric]) === 'unavailable') {
      messages.push(`Datos insuficientes para ${MARKET_GROUPS[metric].label}.`);
    }
  }
  return {
    meta: {
      leagueKey,
      leagueName,
      season,
      home,
      away,
      lookback: sampleSize,
      cutoff: new Date(cutoffTime).toISOString(),
      leagueReferenceMatches: leagueReference.length,
      model: 'Conteos suavizados por liga y localía; matriz de goles Poisson',
    },
    summary: {
      home: teamSummary(homeHistory, home),
      away: teamSummary(awayHistory, away),
      leagueAverages,
      expectedGoals: goals.home === null ? null : {
        home: round(goals.home), away: round(goals.away), total: round(goals.total),
      },
    },
    markets,
    history: { home: homeHistory, away: awayHistory, h2h },
    quality: { status, messages, coverage },
  };
}
