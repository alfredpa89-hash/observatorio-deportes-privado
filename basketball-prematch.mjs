import { SportsError } from './sports.mjs';
import { priorGames } from './basketball-model.mjs';
import { RESEARCH_LEAGUES, RESEARCH_SEASONS, eligibleNba } from './basketball-research.mjs';
import { localDay } from './basketball-data.mjs';

const count = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
const sample = values => { const valid = values.filter(count); return { n: valid.length, missing: values.length - valid.length, average: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null }; };
const fail = message => { throw new SportsError(400, message); };
const exhibitionTeams = game => /all.?star|rising stars|global stars|young stars|\bOGs\b/i.test(`${game.home} ${game.away}`);
function periodPoints(game, side, period) {
  if (period === 'ft') return game[`${side}Points`];
  const direct = game.periods?.[side]?.[period] ?? game.stats?.[side]?.[period === 'q1' ? 'firstQuarterPoints' : period === 'ht' ? 'halfTimePoints' : 'unavailable'];
  if (count(direct) || period !== 'q2') return direct;
  const q1 = periodPoints(game, side, 'q1'), ht = periodPoints(game, side, 'ht');
  return count(q1) && count(ht) && ht >= q1 ? ht - q1 : null;
}
const teamPair = (game, team, period) => (game.home === team ? ['home', 'away'] : ['away', 'home']).map(side => periodPoints(game, side, period));

export function createBasketballPrematch({ read, playerAnalysis, now = () => new Date() }) {
  function selection(body = {}) {
    const league = body.league || 'nba', season = body.season || RESEARCH_SEASONS[0], lookback = Number(body.lookback ?? 20);
    if (!Object.hasOwn(RESEARCH_LEAGUES, league) || !RESEARCH_SEASONS.includes(season) || ![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Competicion, temporada o historial prepartido no valido.');
    const time = Math.min(Date.parse(body.cutoff || now().toISOString()), now().getTime());
    if (!Number.isFinite(time)) fail('Fecha de corte no valida.');
    return { league, season, lookback, cutoff: new Date(time).toISOString(), time };
  }
  function data(config) {
    const stored = read();
    const games = stored.games.filter(game => game.league === config.league && game.season <= config.season && !game.preseason && !game.referenceOnly &&
      (config.league !== 'nba' || !exhibitionTeams(game) && eligibleNba(game.date, game.season, game.phase || 'Regular Season')));
    const history = priorGames(games, config.cutoff, config.league);
    const fixtures = games.filter(game => game.season === config.season && !game.finished && ['NS', 'Scheduled'].includes(game.status) &&
      game.timeKnown !== false && Date.parse(game.date) > now().getTime() && (!game.fetchedAt || Date.parse(game.fetchedAt) <= config.time))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { history, fixtures, availability: stored.availability || [] };
  }
  function catalog(body) {
    const config = selection(body), stored = data(config);
    return { ...config, competitions: Object.entries(RESEARCH_LEAGUES).map(([key, name]) => ({ key, name })), seasons: RESEARCH_SEASONS,
      teams: unique([...stored.history, ...stored.fixtures].flatMap(game => [game.home, game.away])),
      fixtures: stored.fixtures.slice(0, 60).map(game => ({ id: game.id, home: game.home, away: game.away, date: game.date, source: game.source || 'Guardado' })),
      fixtureCount: stored.fixtures.length, notice: 'Calendario guardado, sujeto a cambios. Ausencia de calendario no significa ausencia de partidos.' };
  }
  function report(body) {
    const config = selection(body), stored = data(config);
    const fixture = body.fixtureId ? stored.fixtures.find(game => game.id === body.fixtureId) : null;
    if (body.fixtureId && !fixture) fail('El encuentro no es futuro admisible de esta competicion y temporada. No se reconstruye un prepartido despues del inicio.');
    const home = fixture?.home || body.home, away = fixture?.away || body.away;
    const teams = unique([...stored.history, ...stored.fixtures].flatMap(game => [game.home, game.away]));
    if (!home || home === away || !teams.includes(home) || !teams.includes(away)) fail('Selecciona dos equipos distintos con datos de esta competicion.');
    const allPlayers = playerAnalysis.records(config);
    const alerts = [], statuses = ['unknown', 'active', 'questionable', 'out', 'minutes_limit'];
    function reports(team) {
      const latest = new Map();
      for (const row of stored.availability.filter(row => row.league === config.league && (!row.season || row.season === config.season) && row.team === team && statuses.includes(row.status) &&
        (!row.fixtureId || fixture && row.fixtureId === fixture.id) && Date.parse(row.recordedAt) <= config.time && Date.parse(row.publishedAt) <= config.time)
        .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt))) latest.set(row.playerKey, row);
      return [...latest.values()].map(row => ({ ...row, current: Date.parse(row.expiresAt) > config.time,
        coversStart: fixture ? Date.parse(row.expiresAt) > Date.parse(fixture.date) : null }));
    }
    function teamSummary(team, venue) {
      const games = stored.history.filter(game => [game.home, game.away].includes(team)).slice(-config.lookback);
      const pair = (game, period) => teamPair(game, team, period);
      const isWin = game => { const [scored, conceded] = pair(game, 'ft'); return scored > conceded; };
      const periods = Object.fromEntries(['ft', 'q1', 'ht', 'q2', 'q3', 'q4'].map(period => {
        const pairs = games.map(game => pair(game, period)).filter(values => values.every(count));
        return [period, { scored: sample(pairs.map(values => values[0])), conceded: sample(pairs.map(values => values[1])), n: pairs.length, missing: games.length - pairs.length }];
      }));
      const split = games.filter(game => (game.home === team ? 'home' : 'away') === venue);
      const last = games.at(-1), ageDays = last ? Math.floor((config.time - Date.parse(last.date)) / 86400000) : null;
      const availability = reports(team), validReports = availability.filter(row => row.current);
      const groups = new Map();
      for (const row of allPlayers.filter(row => row.team === team && row.minutes > 0)) {
        if (!groups.has(row.playerKey)) groups.set(row.playerKey, []);
        groups.get(row.playerKey).push(row);
      }
      const players = [...groups.values()].map(history => {
        const recent = history.slice(0, config.lookback), last = recent[0], report = availability.find(row => row.playerKey === last.playerKey);
        return { playerKey: last.playerKey, name: last.name, team, n: recent.length, latest: last.date, seasons: unique(recent.map(row => row.season)),
          currentSeasonEvidence: recent.some(row => row.season === config.season),
          metrics: Object.fromEntries(['points', 'rebounds', 'assists', 'pra', 'pr', 'pa', 'ra', 'threes'].map(metric => [metric, sample(recent.map(row => row.values[metric]))])),
          availability: report?.current ? report.status : 'unknown', source: unique(recent.map(row => row.source || 'Guardado')) };
      }).sort((a, b) => (b.metrics.points.average ?? -1) - (a.metrics.points.average ?? -1) || a.name.localeCompare(b.name, 'es'));
      const previousCurrent = stored.history.filter(game => game.season === config.season && [game.home, game.away].includes(team)).at(-1);
      let interval = null;
      if (fixture && previousCurrent?.timeKnown !== false && previousCurrent && Date.parse(fixture.date) - Date.parse(previousCurrent.date) <= 7 * 86400000) {
        const calendarDays = Math.round((Date.parse(`${localDay(fixture.date)}T00:00:00Z`) - Date.parse(`${localDay(previousCurrent.date)}T00:00:00Z`)) / 86400000);
        interval = { previousDate: previousCurrent.date, hoursBetweenStarts: (Date.parse(fixture.date) - Date.parse(previousCurrent.date)) / 3600000,
          calendarDays, consecutiveDays: calendarDays === 1 };
      }
      if (games.length < 10) alerts.push(`${team}: muestra de solo ${games.length} partidos guardados.`);
      if (ageDays !== null && ageDays > 45) alerts.push(`${team}: el ultimo resultado guardado tiene ${ageDays} dias; no es forma actual verificada.`);
      if (!validReports.length) alerts.push(`${team}: sin reporte vigente de disponibilidad. No significa que todos esten disponibles.`);
      if (!players.some(player => player.currentSeasonEvidence)) alerts.push(`${team}: sin participaciones individuales de la temporada elegida; las referencias historicas no confirman la plantilla actual.`);
      if (fixture && validReports.some(row => !row.coversStart)) alerts.push(`${team}: algun reporte vence antes del inicio del encuentro.`);
      return { team, venue, n: games.length, currentSeasonGames: games.filter(game => game.season === config.season).length,
        wins: games.filter(isWin).length, losses: games.filter(game => !isWin(game)).length, periods,
        venueSplit: { n: split.length, wins: split.filter(isWin).length, scored: sample(split.map(game => pair(game, 'ft')[0])), conceded: sample(split.map(game => pair(game, 'ft')[1])) },
        form: games.slice(-5).reverse().map(game => ({ id: game.id, date: game.date, opponent: game.home === team ? game.away : game.home, won: isWin(game), scored: pair(game, 'ft')[0], conceded: pair(game, 'ft')[1] })),
        newest: last?.date || null, ageDays, interval,
        recordedGamesLast7Days: fixture ? stored.history.filter(game => [game.home, game.away].includes(team) && Date.parse(game.date) >= Date.parse(fixture.date) - 7 * 86400000).length : null,
        players, availability };
    }
    const summaries = [teamSummary(home, 'home'), teamSummary(away, 'away')];
    if (!fixture) alerts.unshift('Comparacion historica sin encuentro futuro confirmado. No se calculan descansos ni se presume que estos equipos se enfrentaran.');
    alerts.push('Calendario y carga parcial de la misma competicion. No se han verificado viajes, otras competiciones, alineaciones ni lesiones fuera de los reportes guardados.');
    if (config.league === 'endesa') alerts.push('Endesa permanece fuera del modelo predictivo de octubre.');
    return { meta: { ...config, competition: RESEARCH_LEAGUES[config.league], home, away, descriptive: true, modelChanged: false,
      fixture: fixture ? { id: fixture.id, date: fixture.date, source: fixture.source || 'Guardado', fetchedAt: fixture.fetchedAt || null } : null },
      teams: summaries, alerts,
      h2h: stored.history.filter(game => [home, away].includes(game.home) && [home, away].includes(game.away)).slice(-5).reverse()
        .map(game => ({ date: game.date, home: game.home, away: game.away, homePoints: game.homePoints, awayPoints: game.awayPoints, source: game.source || 'Guardado' })),
      note: 'Contexto descriptivo anterior al corte; no es una recomendacion de apuesta ni modifica los pronosticos sellados. FT incluye prorroga. Cada periodo conserva sus faltantes.' };
  }
  function teamSelection(body = {}) {
    const wholeSeason = body.lookback == null || body.lookback === 'season';
    const config = selection({ ...body, lookback: wholeSeason ? 20 : body.lookback }), venue = body.venue || 'all';
    if (!['all', 'home', 'away'].includes(venue)) fail('Localia del equipo no valida.');
    return { ...config, lookback: wholeSeason ? 'season' : config.lookback, venue };
  }
  function teamCatalog(body) {
    const config = teamSelection(body), stored = data({ ...config, season: RESEARCH_SEASONS[0] });
    const history = stored.history.filter(game => game.season <= config.season), fixtures = config.season === RESEARCH_SEASONS[0] ? stored.fixtures : data(config).fixtures;
    return { ...config, competitions: Object.entries(RESEARCH_LEAGUES).map(([key, name]) => ({ key, name })),
      seasons: RESEARCH_SEASONS.map(season => ({ value: season, results: stored.history.filter(game => game.season === season).length })),
      teams: unique([...history, ...fixtures].flatMap(game => [game.home, game.away])).map(name => ({ name,
        seasonGames: history.filter(game => game.season === config.season && [game.home, game.away].includes(name)).length })),
      notice: 'Equipos del archivo; su presencia no confirma participacion actual. Solo se analiza la temporada elegida, sin completar con temporadas anteriores.' };
  }
  function teamReport(body) {
    const config = teamSelection(body), stored = data(config), team = String(body.team || '');
    if (!team || !teamCatalog(config).teams.some(row => row.name === team)) fail('Selecciona un equipo del archivo de esta competicion.');
    const seasonGames = stored.history.filter(game => game.season === config.season && [game.home, game.away].includes(team));
    const available = seasonGames.filter(game => config.venue === 'all' || (game.home === team ? 'home' : 'away') === config.venue);
    const games = config.lookback === 'season' ? available : available.slice(-config.lookback);
    const history = games.map(game => ({ id: game.id, date: game.date, timeKnown: game.timeKnown !== false, team,
      opponent: game.home === team ? game.away : game.home, venue: game.home === team ? 'home' : 'away', source: game.source || 'Guardado',
      periods: Object.fromEntries(['ft', 'q1', 'q2', 'ht', 'q3', 'q4'].map(period => {
        const [scored, conceded] = teamPair(game, team, period);
        return [period, { scored: count(scored) ? scored : null, conceded: count(conceded) ? conceded : null,
          total: count(scored) && count(conceded) ? scored + conceded : null }];
      })) }));
    const summarize = rows => {
      const wins = rows.filter(row => row.periods.ft.scored > row.periods.ft.conceded).length;
      return { n: rows.length, wins, losses: rows.length - wins, winFrequency: rows.length ? wins / rows.length * 100 : null };
    };
    const periods = Object.fromEntries(['ft', 'q1', 'q2', 'ht', 'q3', 'q4'].map(period => {
      const values = history.map(row => row.periods[period]), pairs = values.filter(value => count(value.scored) && count(value.conceded));
      return [period, { scored: sample(values.map(value => value.scored)), conceded: sample(values.map(value => value.conceded)), total: sample(values.map(value => value.total)),
        n: pairs.length, missing: values.length - pairs.length, wins: pairs.filter(value => value.scored > value.conceded).length,
        draws: pairs.filter(value => value.scored === value.conceded).length, losses: pairs.filter(value => value.scored < value.conceded).length }];
    }));
    const newest = games.at(-1)?.date || null, ageDays = newest ? Math.floor((config.time - Date.parse(newest)) / 86400000) : null;
    const warnings = ['Resultados guardados de la temporada elegida, no cobertura completa ni clasificacion oficial. Frecuencias historicas, no probabilidades calibradas del siguiente encuentro.'];
    if (!seasonGames.length) warnings.push('Sin resultados admisibles de esta temporada. No se sustituyen por otra: elige un historico con datos o actualiza una temporada autorizada.');
    else if (!games.length) warnings.push('Sin resultados con esta localia. No se amplian los filtros para completar la muestra.');
    if (config.lookback !== 'season' && games.length < config.lookback) warnings.push(`Solo ${games.length} de ${config.lookback} partidos solicitados con estos filtros.`);
    if (games.length > 0 && games.length < 10) warnings.push('Muestra pequena: menos de diez partidos guardados.');
    if (ageDays !== null && ageDays > 45) warnings.push(`Ultimo resultado hace ${ageDays} dias; no es forma actual verificada.`);
    return { meta: { ...config, team, competition: RESEARCH_LEAGUES[config.league], descriptive: true, modelChanged: false, seasonGames: seasonGames.length,
      available: available.length, newest, ageDays, sources: unique(games.map(game => game.source || 'Guardado')) },
      summary: summarize(history), venueSplits: ['home', 'away'].map(venue => ({ venue, ...summarize(history.filter(row => row.venue === venue)) })),
      periods, form: history.slice(-5).reverse().map(row => ({ date: row.date, opponent: row.opponent, won: row.periods.ft.scored > row.periods.ft.conceded })),
      history: history.reverse(), upcoming: stored.fixtures.filter(game => [game.home, game.away].includes(team) &&
        (config.venue === 'all' || (game.home === team ? 'home' : 'away') === config.venue)).slice(0, 5)
        .map(game => ({ id: game.id, date: game.date, home: game.home, away: game.away, source: game.source || 'Guardado' })), warnings,
      note: 'FT incluye prorroga; cuartos y descanso conservan sus datos reales y faltantes. La localia se filtra antes de tomar los ultimos partidos. No modifica el modelo de octubre.' };
  }
  return { catalog, report, teamCatalog, teamReport };
}
