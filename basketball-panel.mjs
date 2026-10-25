import { SportsError } from './sports.mjs';
import { RESEARCH_SEASONS } from './basketball-research.mjs';
import { availableTime, priorGames, mean } from './basketball-model.mjs';
import { buildWeekReport } from './basketball-week.mjs';

const NAME = 'Liga Endesa / ACB';
const NOTICE = 'Endesa: consulta descriptiva del historial guardado. Modelo predictivo independiente pendiente; no se asignan probabilidades ni se incluye en la prueba de octubre.';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const names = games => [...new Set(games.flatMap(game => [game.home, game.away]))].sort((a, b) => a.localeCompare(b, 'es'));
const average = values => mean(values.filter(finite));

// Endesa shares the navigation and stored archive, not the frozen NBA/Euro model.
export function createBasketballPanel({ basketball, research, now = () => new Date() }) {
  const records = () => {
    const saved = research.dailyData();
    return { games: saved.games.filter(game => game.league === 'endesa'), players: saved.players.filter(player => player.league === 'endesa') };
  };
  function selection(body = {}) {
    const season = body.season || RESEARCH_SEASONS[0], lookback = Number(body.lookback ?? 20);
    if (!RESEARCH_SEASONS.includes(season) || ![5, 10, 15, 20, 25, 30].includes(lookback)) throw new SportsError(400, 'Temporada o historial de Endesa no valido.');
    const time = Math.min(Date.parse(body.cutoff || now().toISOString()), now().getTime());
    if (!Number.isFinite(time)) throw new SportsError(400, 'Fecha de corte no valida.');
    return { season, lookback, cutoff: new Date(time).toISOString(), time };
  }
  function state() {
    const result = basketball.state(), saved = records(), clock = now().toISOString();
    const games = saved.games.filter(game => game.finished && game.date < clock);
    const datasets = RESEARCH_SEASONS.map(season => {
      const history = games.filter(game => game.season <= season), current = history.filter(game => game.season === season);
      const fixtures = saved.games.filter(game => !game.finished && game.season === season && game.date > clock);
      const players = saved.players.filter(player => player.season <= season && player.minutes > 0 && player.date < clock);
      return { season, matches: current.length, history: history.length, fixtures: fixtures.length, teams: names([...history, ...fixtures]),
        players: players.length, playerNames: [...new Set(players.map(player => player.name))].sort(), paceGames: 0,
        source: history.length ? 'Historial guardado de Endesa; no acredita la temporada actual' : 'Sin historial guardado',
        loadedAt: null, coverage: null };
    });
    return { ...result, leagues: [...result.leagues, { key: 'endesa', name: NAME, seasons: RESEARCH_SEASONS,
      predictionSupported: false, datasets, total: null, quarter: null, half: null, note: NOTICE }] };
  }
  function report(body) {
    if (body.league !== 'endesa') return basketball.report(body);
    const config = selection(body), saved = records();
    const games = priorGames(saved.games.filter(game => game.season <= config.season), config.cutoff, 'endesa');
    const teams = names([...games, ...saved.games.filter(game => game.season === config.season && !game.finished)]);
    if (!teams.includes(body.home) || !teams.includes(body.away) || body.home === body.away) throw new SportsError(400, 'Selecciona dos equipos distintos de Endesa con datos guardados.');
    const histories = [body.home, body.away].map(team => games.filter(game => [game.home, game.away].includes(team)).slice(-config.lookback));
    const periods = Object.fromEntries(['ft', 'q1', 'ht'].map(period => {
      const values = histories.map((history, index) => history.map(game => {
        const side = game.home === [body.home, body.away][index] ? 'home' : 'away';
        return period === 'ft' ? game[`${side}Points`] : game.periods?.[side]?.[period] ?? game.stats?.[side]?.[period === 'q1' ? 'firstQuarterPoints' : 'halfTimePoints'];
      }).filter(finite));
      const [home, away] = values.map(average);
      return [period, { home, away, total: home !== null && away !== null ? home + away : null, homeN: values[0].length, awayN: values[1].length }];
    }));
    return { meta: { ...config, league: 'endesa', competition: NAME, home: body.home, away: body.away, descriptive: true,
      model: NOTICE, periods }, markets: [], history: { home: histories[0], away: histories[1] },
      quality: { messages: [NOTICE, 'Las medias son descriptivas, no puntos esperados para un encuentro futuro. La muestra puede incluir temporadas anteriores.'] } };
  }
  function list(body) {
    if (body.league !== 'endesa') return basketball.list(body);
    const config = selection(body);
    const fixtures = records().games.filter(game => !game.finished && game.season === config.season && game.date > config.cutoff && ['NS', 'Scheduled'].includes(game.status))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60).map(game => ({ ...game, report: null }));
    return { league: 'endesa', fixtures, predictionSupported: false, note: fixtures.length ? NOTICE : 'Sin calendario futuro guardado de Endesa para esta temporada y corte. No significa que no haya partidos. ' + NOTICE };
  }
  function player(body) {
    if (body.league !== 'endesa') return basketball.player(body);
    const config = selection(body), metric = body.metric || 'points';
    if (!body.player || !['points', 'rebounds', 'assists', 'pra', 'threes'].includes(metric)) throw new SportsError(400, 'Selecciona un jugador y una estadistica valida.');
    const history = records().players.filter(row => row.name === body.player && row.season <= config.season && row.minutes > 0 && availableTime(row) < config.time)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, config.lookback);
    const values = history.map(row => row.values?.[metric]).filter(finite);
    return { descriptive: true, player: body.player, history, n: values.length, average: average(values), expected: null,
      projectedMinutes: null, over: null, under: null, note: NOTICE + ' Las frecuencias del historial no son pronosticos; los faltantes no cuentan como cero.' };
  }
  function week(body) {
    if (body.league !== 'endesa') return basketball.week(body);
    const config = selection(body), saved = records();
    return buildWeekReport({ ...body, ...config, league: 'endesa', now: now().toISOString(),
      matches: saved.games.filter(game => game.finished), fixtures: saved.games.filter(game => !game.finished), players: saved.players });
  }
  async function refresh(body = {}) {
    if (body.league !== 'endesa') { const result = await basketball.refresh(body); return { ...result, state: state() }; }
    const config = selection(body), result = await research.sync({ league: 'endesa', season: config.season, lookback: config.lookback });
    return { ...result, state: state(), warning: [result.warning, NOTICE].filter(Boolean).join(' ') };
  }
  const unavailable = () => ({ league: 'endesa', unavailable: true, n: 0, summary: {}, note: NOTICE });
  function backtest(body) {
    if (body.league === 'endesa') throw new SportsError(400, NOTICE);
    return basketball.backtest(body);
  }
  function importCsv(body) {
    if (body.league === 'endesa') throw new SportsError(400, 'Para Endesa usa Cargar temporada mediante API-Basketball. No se importan datos en el modelo de octubre.');
    return basketball.importCsv(body).then(result => ({ ...result, state: state() }));
  }
  return { state, report, list, player, week, refresh, backtest, importCsv,
    evaluation: key => key === 'endesa' ? unavailable() : basketball.evaluation(key) };
}
