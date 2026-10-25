export const NBA_SOURCE = {
  id: 'espn-nba',
  name: 'ESPN NBA',
  url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  sourcePage: 'https://www.espn.com/nba/scoreboard',
  seasonType: 2,
  parserVersion: 3,
  coverage: 'Temporada regular NBA; resultados y calendario. Puntos incluyen prorrogas.',
  note: 'Fuente publica de ESPN sin garantia de disponibilidad; no es un API contratado ni un modelo calibrado.',
};

const MIN_TEAM_MATCHES = 3;
const MIN_LEAGUE_MATCHES = 20;
const PRIOR_MATCHES = 8;

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function instant(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function key(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en');
}

function startYear(value) {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function normalizeSeason(value) {
  const year = startYear(value);
  if (!year) return null;
  return `${year}/${year + 1}`;
}

function espnSeason(value) {
  const year = integer(value);
  return year >= 1947 && year <= 2100 ? `${year - 1}/${year}` : null;
}

function teamStats(competitor) {
  const fields = {
    rebounds: 'rebounds',
    assists: 'assists',
    threePointFieldGoalsMade: 'threePointersMade',
  };
  const result = {};
  for (const statistic of competitor?.statistics ?? []) {
    const field = fields[statistic.name];
    if (!field) continue;
    result[field] = integer(statistic.value ?? statistic.displayValue);
  }
  const quarters = new Map((competitor?.linescores ?? []).map((score, index) =>
    [integer(score.period) ?? index + 1, integer(score.value ?? score.displayValue)]));
  if (quarters.size) Object.assign(result, normalizeNbaPeriods({
    firstQuarterPoints: quarters.get(1),
    halfTimePoints: quarters.get(1) != null && quarters.get(2) != null ? quarters.get(1) + quarters.get(2) : null,
  }, competitor.score));
  return result;
}

export function normalizeNbaPeriods(stats = {}, finalPoints) {
  const final = integer(finalPoints);
  let firstQuarterPoints = integer(stats.firstQuarterPoints);
  let halfTimePoints = integer(stats.halfTimePoints);
  if (final === null || firstQuarterPoints > final) firstQuarterPoints = null;
  if (final === null || halfTimePoints > final || (firstQuarterPoints !== null && halfTimePoints !== null && halfTimePoints < firstQuarterPoints)) halfTimePoints = null;
  return { firstQuarterPoints, halfTimePoints };
}

export function parseNbaPlayerBoxscore(payload, match) {
  const competition = payload?.header?.competitions?.[0];
  if (!validMatch(match) || String(payload?.header?.id) !== String(match.id) ||
    payload.header.season?.type !== NBA_SOURCE.seasonType || competition?.status?.type?.completed !== true ||
    instant(competition.date) !== instant(match.date)) throw new Error('El box score no corresponde a un resultado NBA final guardado.');
  for (const side of ['home', 'away']) {
    const competitor = competition.competitors?.find(item => item.homeAway === side);
    if (key(competitor?.team?.displayName) !== key(match[side]) || integer(competitor?.score) !== match[`${side}Points`])
      throw new Error('Equipos o marcador del box score no coinciden.');
  }
  const records = [];
  for (const team of payload.boxscore?.players ?? []) {
    const name = team.team?.displayName;
    const side = key(name) === key(match.home) ? 'home' : key(name) === key(match.away) ? 'away' : null;
    if (!side) continue;
    for (const group of team.statistics ?? []) {
      const labels = (group.labels ?? group.names ?? []).map(label => String(label).toUpperCase());
      for (const player of group.athletes ?? []) {
        if (player.didNotPlay === true || !player.athlete?.displayName || !Array.isArray(player.stats)) continue;
        const stat = label => player.stats[labels.indexOf(label)];
        const minutesText = String(stat('MIN') ?? '');
        const time = minutesText.match(/^(\d+):(\d{2})$/);
        const minutes = time && Number(time[2]) < 60 ? Number(time[1]) + Number(time[2]) / 60 : number(minutesText);
        if (minutes === null || minutes <= 0) continue;
        const three = String(stat('3PT') ?? '').match(/^(\d+)-(\d+)$/);
        const values = { points: integer(stat('PTS')), rebounds: integer(stat('REB')), assists: integer(stat('AST')),
          threes: three && Number(three[1]) <= Number(three[2]) ? Number(three[1]) : null };
        values.pra = [values.points, values.rebounds, values.assists].every(value => value !== null)
          ? values.points + values.rebounds + values.assists : null;
        if (Object.values(values).every(value => value === null)) continue;
        const opponent = side === 'home' ? match.away : match.home;
        records.push({ id: `player:nba:nba:${match.season}:${match.date}:${key(player.athlete.displayName)}:${key(name)}:${key(opponent)}`,
          sport: 'nba', leagueKey: null, season: match.season, date: match.date, name: player.athlete.displayName,
          team: name, opponent, venue: side, minutes, values, source: 'ESPN box score', eventId: match.id });
      }
    }
  }
  return [...new Map(records.map(record => [record.id, record])).values()];
}

function safeLogo(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseNbaSchedule(payload, { season: requestedSeason } = {}) {
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error('El calendario NBA de ESPN no contiene una lista de eventos valida.');
  }
  const selectedSeason = normalizeSeason(requestedSeason);
  const matches = new Map();
  const fixtures = new Map();
  const teams = new Set();
  const seasons = new Set();
  let invalidResults = 0;
  for (const event of payload.events) {
    const competition = event.competitions?.[0];
    if (!competition || Number(event.season?.type) !== NBA_SOURCE.seasonType) continue;
    if (/allstar/i.test(String(competition.type?.abbreviation)) || competition.notes?.some(note => /all[- ]star/i.test(String(note.headline)))) continue;
    // The Cup final is tagged type 2 by ESPN but does not count in regular-season records.
    if (competition.notes?.some(note => /nba cup.*championship/i.test(String(note.headline)))) continue;
    const season = espnSeason(event.season?.year) ?? selectedSeason;
    if (!season || (selectedSeason && season !== selectedSeason)) continue;
    const home = competition.competitors?.find(team => team.homeAway === 'home');
    const away = competition.competitors?.find(team => team.homeAway === 'away');
    const homeName = String(home?.team?.displayName ?? '').trim();
    const awayName = String(away?.team?.displayName ?? '').trim();
    const date = instant(competition.date ?? event.date);
    if (!homeName || !awayName || key(homeName) === key(awayName) || date === null) continue;
    const status = competition.status?.type ?? event.status?.type ?? {};
    if (/cancel|postpon/i.test(String(status.name ?? ''))) continue;
    const id = String(event.id ?? competition.id ?? `${date}:${homeName}:${awayName}`);
    const common = {
      id, date: new Date(date).toISOString(), season,
      home: homeName, away: awayName,
      homeLogo: safeLogo(home.team.logo), awayLogo: safeLogo(away.team.logo),
      neutralSite: competition.neutralSite === true,
      seasonType: NBA_SOURCE.seasonType, source: NBA_SOURCE.id,
    };
    teams.add(homeName);
    teams.add(awayName);
    seasons.add(season);
    if (status.completed === true) {
      const homePoints = integer(home.score);
      const awayPoints = integer(away.score);
      if (homePoints === null || awayPoints === null || homePoints <= 0 || awayPoints <= 0 || homePoints === awayPoints) {
        invalidResults += 1;
        continue;
      }
      const period = integer(competition.status?.period ?? event.status?.period);
      matches.set(id, {
        ...common, homePoints, awayPoints, finished: true, status: 'Final',
        overtime: period === null ? null : period > 4,
        stats: { home: teamStats(home), away: teamStats(away) },
      });
      fixtures.delete(id);
    } else if (!matches.has(id)) {
      fixtures.set(id, { ...common, finished: false, status: status.description ?? 'Programado' });
    }
  }
  const chronological = (a, b) => instant(a.date) - instant(b.date);
  return {
    season: selectedSeason ?? [...seasons].sort().at(-1) ?? espnSeason(payload.season?.year),
    matches: [...matches.values()].sort(chronological),
    fixtures: [...fixtures.values()].sort(chronological),
    teams: [...teams].sort((a, b) => a.localeCompare(b)),
    warning: invalidResults ? `${invalidResults} resultados NBA omitidos por marcador incompleto o invalido.` : null,
  };
}

export const parseNbaEspn = parseNbaSchedule;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function variance(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

function round(value, digits = 1) {
  return value === null ? null : Number(value.toFixed(digits));
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, (1 + sign * erf) / 2));
}

function percentage(probability) {
  return probability === null ? null : round(100 * Math.max(0, Math.min(1, probability)));
}

export function validMatch(match) {
  if (!match || match.finished === false || instant(match.date) === null) return false;
  if (match.seasonType !== undefined && Number(match.seasonType) !== NBA_SOURCE.seasonType) return false;
  if (match.status && !/^(final|finished|completed|ft)$/i.test(String(match.status))) return false;
  const home = integer(match.homePoints);
  const away = integer(match.awayPoints);
  return home !== null && away !== null && home > 0 && away > 0 && home !== away && key(match.home) !== key(match.away);
}

export function teamRow(match, team) {
  const atHome = key(match.home) === key(team);
  const pointsFor = atHome ? match.homePoints : match.awayPoints;
  const pointsAgainst = atHome ? match.awayPoints : match.homePoints;
  return {
    ...match, atHome, opponent: atHome ? match.away : match.home,
    pointsFor, pointsAgainst, totalPoints: pointsFor + pointsAgainst,
    margin: pointsFor - pointsAgainst, result: pointsFor > pointsAgainst ? 'W' : 'L',
    teamStats: { ...(atHome ? match.stats?.home : match.stats?.away),
      ...normalizeNbaPeriods(atHome ? match.stats?.home : match.stats?.away, pointsFor) },
    opponentStats: normalizeNbaPeriods(atHome ? match.stats?.away : match.stats?.home, pointsAgainst),
  };
}

function summarize(history, team) {
  const statistic = field => {
    const values = history.map(match => integer(match.teamStats?.[field])).filter(value => value !== null);
    return { average: round(mean(values)), n: values.length };
  };
  const pointsFor = round(mean(history.map(match => match.pointsFor)));
  const pointsAgainst = round(mean(history.map(match => match.pointsAgainst)));
  return {
    team, matches: history.length,
    wins: history.filter(match => match.margin > 0).length,
    losses: history.filter(match => match.margin < 0).length,
    pointsFor, pointsAgainst, averagePointsFor: pointsFor, averagePointsAgainst: pointsAgainst,
    averageTotalPoints: round(mean(history.map(match => match.totalPoints))),
    averageMargin: round(mean(history.map(match => match.margin))),
    homeMatches: history.filter(match => match.atHome).length,
    awayMatches: history.filter(match => !match.atHome).length,
    rebounds: statistic('rebounds'), assists: statistic('assists'), threePointersMade: statistic('threePointersMade'),
    firstQuarterPoints: statistic('firstQuarterPoints'), halfTimePoints: statistic('halfTimePoints'),
  };
}

function residual(history, role, homeMean, awayMean) {
  const total = history.reduce((sum, match) => {
    const baseline = role === 'for'
      ? (match.neutralSite ? (homeMean + awayMean) / 2 : match.atHome ? homeMean : awayMean)
      : (match.neutralSite ? (homeMean + awayMean) / 2 : match.atHome ? awayMean : homeMean);
    return sum + (role === 'for' ? match.pointsFor : match.pointsAgainst) - baseline;
  }, 0);
  return total / (history.length + PRIOR_MATCHES);
}

function observed(history, predicate) {
  return { hits: history.filter(predicate).length, n: history.length };
}

function validateLine(value, fallback, min, max, label) {
  const parsed = value === undefined ? fallback : number(value);
  if (parsed === null || parsed < min || parsed > max || !Number.isInteger(parsed * 2)) {
    throw new Error(`La linea de ${label} debe ser un numero en pasos de 0.5 entre ${min} y ${max}.`);
  }
  return parsed;
}

export function buildNbaReport({ matches = [], season, home, away, lookback = 10, cutoff, totalLine = 220.5, spreadLine = 0, neutralSite = false } = {}) {
  if (!String(home ?? '').trim() || !String(away ?? '').trim() || key(home) === key(away)) {
    throw new Error('Selecciona dos equipos NBA diferentes.');
  }
  const cutoffTime = instant(cutoff);
  if (cutoffTime === null) throw new Error('Indica una fecha de corte NBA valida.');
  const selectedYear = startYear(season);
  if (selectedYear === null) throw new Error('Selecciona una temporada NBA valida.');
  const historyLength = Math.max(3, Math.min(30, Math.trunc(number(lookback) ?? 10)));
  totalLine = validateLine(totalLine, 220.5, 1, 500, 'puntos');
  spreadLine = validateLine(spreadLine, 0, -100, 100, 'handicap');
  const eligible = matches.filter(match => validMatch(match) && instant(match.date) < cutoffTime &&
    startYear(match.season) !== null && startYear(match.season) <= selectedYear)
    .map(match => ({ ...match, homePoints: integer(match.homePoints), awayPoints: integer(match.awayPoints) }))
    .sort((a, b) => instant(b.date) - instant(a.date));
  const unique = [...new Map(eligible.map(match => [String(match.id ?? `${match.date}:${key(match.home)}:${key(match.away)}`), match])).values()];
  const league = unique.slice(0, 800);
  const teamHistory = team => unique.filter(match => key(match.home) === key(team) || key(match.away) === key(team))
    .slice(0, historyLength).map(match => teamRow(match, team));
  const homeHistory = teamHistory(home);
  const awayHistory = teamHistory(away);
  const homeAtHome = league.filter(match => !match.neutralSite).map(match => match.homePoints);
  const awayAtAway = league.filter(match => !match.neutralSite).map(match => match.awayPoints);
  const overallPoints = mean(league.flatMap(match => [match.homePoints, match.awayPoints]));
  const homeMean = mean(homeAtHome) ?? overallPoints;
  const awayMean = mean(awayAtAway) ?? overallPoints;
  const enough = homeHistory.length >= MIN_TEAM_MATCHES && awayHistory.length >= MIN_TEAM_MATCHES && league.length >= MIN_LEAGUE_MATCHES;
  const baseHome = neutralSite ? (homeMean + awayMean) / 2 : homeMean;
  const baseAway = neutralSite ? (homeMean + awayMean) / 2 : awayMean;
  const predictedHome = enough ? baseHome + 0.5 * (residual(homeHistory, 'for', homeMean, awayMean) + residual(awayHistory, 'against', homeMean, awayMean)) : null;
  const predictedAway = enough ? baseAway + 0.5 * (residual(awayHistory, 'for', homeMean, awayMean) + residual(homeHistory, 'against', homeMean, awayMean)) : null;
  const totalMean = enough ? predictedHome + predictedAway : null;
  const marginMean = enough ? predictedHome - predictedAway : null;
  const recent = [...new Map([...homeHistory, ...awayHistory].map(match => [String(match.id ?? `${match.date}:${match.home}:${match.away}`), match])).values()];
  const pooledVariance = metric => {
    const values = metric === 'total' ? match => match.homePoints + match.awayPoints : match => match.homePoints - match.awayPoints;
    const prior = variance(league.map(values));
    const local = variance(recent.map(values)) ?? prior;
    // A league prior and variance floor avoid spurious certainty from a short winning streak.
    return Math.max(metric === 'total' ? 225 : 100, ((prior ?? 0) * 30 + (local ?? 0) * recent.length) / (30 + recent.length));
  };
  const uncertainty = Math.sqrt(1 + 1 / (homeHistory.length + PRIOR_MATCHES) + 1 / (awayHistory.length + PRIOR_MATCHES));
  const totalScale = enough ? Math.sqrt(pooledVariance('total')) * uncertainty : null;
  const marginScale = enough ? Math.sqrt(pooledVariance('margin')) * uncertainty : null;
  const qualityLevel = !enough ? 'sin-datos' : Math.min(homeHistory.length, awayHistory.length) < 10 || league.length < 100 ? 'muestra-limitada' : 'exploratoria';
  const messages = [
    'Estimacion exploratoria no calibrada: no garantiza el resultado ni incorpora lesiones, alineaciones, descanso o cuotas.',
    'Los puntos y ganadores incluyen prorrogas. Solo temporada regular; sin pretemporada, playoffs ni final de la NBA Cup.',
  ];
  if (!enough) messages.unshift(`Se requieren al menos ${MIN_TEAM_MATCHES} partidos de cada equipo y ${MIN_LEAGUE_MATCHES} resultados de liga anteriores al corte.`);
  else if (qualityLevel === 'muestra-limitada') messages.unshift('Muestra limitada: interpreta los porcentajes con cautela.');
  if (homeHistory.some(match => startYear(match.season) < selectedYear) || awayHistory.some(match => startYear(match.season) < selectedYear)) {
    messages.push('El historial incluye partidos de temporadas anteriores para completar la muestra; no refleja cambios de plantilla automaticamente.');
  }
  const markets = [];
  const append = (id, label, group, probability, homePredicate, awayPredicate, extra = {}) => markets.push({
    id, label, group, probability, quality: qualityLevel,
    observed: { home: observed(homeHistory, homePredicate), away: observed(awayHistory, awayPredicate) }, ...extra,
  });
  const homeWin = enough ? percentage(normalCdf(marginMean / marginScale)) : null;
  append('home-win', 'Gana local (incluye prorroga)', 'resultado', homeWin, match => match.margin > 0, match => match.margin < 0);
  append('away-win', 'Gana visitante (incluye prorroga)', 'resultado', homeWin === null ? null : round(100 - homeWin), match => match.margin < 0, match => match.margin > 0);
  const totalBoundary = Math.floor(totalLine) + 0.5;
  const totalOver = enough ? percentage(1 - normalCdf((totalBoundary - totalMean) / totalScale)) : null;
  const totalPush = enough && Number.isInteger(totalLine)
    ? percentage(normalCdf((totalLine + 0.5 - totalMean) / totalScale) - normalCdf((totalLine - 0.5 - totalMean) / totalScale)) : enough ? 0 : null;
  const totalUnder = enough ? round(Math.max(0, 100 - totalOver - totalPush)) : null;
  append('total-over', `Over ${totalLine} puntos (incluye prorroga)`, 'puntos', totalOver, match => match.totalPoints > totalLine, match => match.totalPoints > totalLine, { line: totalLine, pushProbability: totalPush });
  append('total-under', `Under ${totalLine} puntos (incluye prorroga)`, 'puntos', totalUnder, match => match.totalPoints < totalLine, match => match.totalPoints < totalLine, { line: totalLine, pushProbability: totalPush });
  const spreadThreshold = -spreadLine;
  const spreadHome = enough ? spreadLine === 0 ? homeWin : percentage(1 - normalCdf((Math.floor(spreadThreshold) + 0.5 - marginMean) / marginScale)) : null;
  const spreadPush = enough && spreadLine !== 0 && Number.isInteger(spreadLine)
    ? percentage(normalCdf((spreadThreshold + 0.5 - marginMean) / marginScale) - normalCdf((spreadThreshold - 0.5 - marginMean) / marginScale)) : enough ? 0 : null;
  const spreadAway = enough ? round(Math.max(0, 100 - spreadHome - spreadPush)) : null;
  const spreadLabel = spreadLine >= 0 ? `+${spreadLine}` : String(spreadLine);
  append('spread-home', `Local ${spreadLabel} puntos (incluye prorroga)`, 'handicap', spreadHome, match => match.margin + spreadLine > 0, match => -match.margin + spreadLine > 0, { line: spreadLine, pushProbability: spreadPush });
  append('spread-away', `Visitante ${spreadLine <= 0 ? '+' : ''}${-spreadLine} puntos (incluye prorroga)`, 'handicap', spreadAway, match => match.margin + spreadLine < 0, match => -match.margin + spreadLine < 0, { line: -spreadLine, pushProbability: spreadPush });
  return {
    meta: {
      sport: 'nba', source: NBA_SOURCE.name, season: normalizeSeason(season), home, away,
      cutoff: new Date(cutoffTime).toISOString(), lookback: historyLength, leagueMatches: league.length,
      totalLine, spreadLine, neutralSite,
      expectedHomePoints: round(predictedHome), expectedAwayPoints: round(predictedAway),
      expectedTotalPoints: round(totalMean), expectedMargin: round(marginMean),
      totalStandardDeviation: round(totalScale), marginStandardDeviation: round(marginScale),
      model: 'Medias ataque/defensa regularizadas, varianza empirica y aproximacion normal con incertidumbre de muestra; no calibrado.',
    },
    summary: { home: summarize(homeHistory, home), away: summarize(awayHistory, away) },
    history: {
      home: homeHistory, away: awayHistory,
      h2h: unique.filter(match => [key(match.home), key(match.away)].includes(key(home)) &&
        [key(match.home), key(match.away)].includes(key(away))).slice(0, 20),
    },
    markets, quality: { level: qualityLevel, messages },
  };
}
