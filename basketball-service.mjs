import { createHash } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { buildBasketballReport, forecastPlayer, priorGames, MODEL_VERSION, LEAGUES, availableTime, mean } from './basketball-model.mjs';
import { historicalEvaluation, prospectiveEvaluation } from './basketball-evaluation.mjs';
import { parseBasketballGames, attachTeamStats, parsePlayerStats, gameKey, localDay, count, regularNba, basketballSeason } from './basketball-data.mjs';
import { buildWeekReport } from './basketball-week.mjs';
import { createRequestBudget } from './request-budget.mjs';
import { basketballFocus, focusedTeams, focusedHistory } from './basketball-focus.mjs';

const SEASONS = ['2026/2027', '2025/2026'];
const API = 'https://v1.basketball.api-sports.io';
const TRIAL_END = '2026-11-01T05:00:00.000Z';
const NBA_START = '2026-10-20T05:00:00.000Z';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const names = rows => [...new Set(rows.flatMap(row => [row.home, row.away]))].sort((a, b) => a.localeCompare(b, 'es'));
const dedup = rows => [...new Map(rows.map(row => [String(row.id), row])).values()];

export function createBasketballService({ getStore, persist, getApiKey = () => null, sports, parseCsvRows, parseCsvDateTime, now = () => new Date(), references = {} }) {
  let operation = null;
  const clock = () => now().toISOString();
  function data() {
    const store = getStore();
    store.basketball ||= { datasets: {}, players: [], evaluations: {}, inputs: {}, detailCache: {}, quota: {} };
    for (const field of ['datasets', 'evaluations', 'inputs', 'detailCache', 'quota']) store.basketball[field] ||= {};
    store.basketball.players ||= [];
    return store.basketball;
  }
  const budget = createRequestBudget({ getStore, getQuota: () => data().quota, persist, name: 'basketball', now });
  function league(value = 'euroleague') {
    if (!LEAGUES[value]) throw new SportsError(400, 'Selecciona NBA o Euroliga.');
    return value;
  }
  function season(value = SEASONS[0]) {
    if (!SEASONS.includes(value)) throw new SportsError(400, 'Temporada no disponible.');
    return value;
  }
  function matches(key) {
    const base = key === 'nba' ? Object.entries(getStore().sports?.nba?.datasets || {}).flatMap(([season, dataset]) =>
      (dataset.matches || []).map(game => ({ ...game, league: 'nba', season: game.season || season }))) : [];
    const extra = Object.values(data().datasets[key] || {}).flatMap(dataset => dataset.matches || []);
    const byIdentity = new Map(base.map(game => [gameKey(game), game]));
    for (const game of extra) { const previous = byIdentity.get(gameKey(game));
      byIdentity.set(gameKey(game), previous ? { ...previous, apiId: game.apiId, homeId: game.homeId, awayId: game.awayId,
        stats: Object.fromEntries(['home', 'away'].map(side => [side, { ...previous.stats?.[side], ...Object.fromEntries(Object.entries(game.stats?.[side] || {}).filter(([, value]) => value != null)) }])) } : game); }
    return [...byIdentity.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function fixtures(key, selectedSeason) {
    const extra = data().datasets[key]?.[selectedSeason]?.fixtures || [];
    const base = key === 'nba' ? getStore().sports?.nba?.datasets?.[selectedSeason]?.fixtures || [] : [];
    const completed = new Set(matches(key).map(gameKey));
    return [...new Map([...base.map(game => ({ ...game, league: key })), ...extra].map(game => [gameKey(game), game])).values()]
      .filter(game => !completed.has(gameKey(game))).sort((a, b) => a.date.localeCompare(b.date));
  }
  function players(key) {
    const allGames = matches(key), byApi = new Map(allGames.filter(game => game.apiId).map(game => [String(game.apiId), game.id]));
    const extra = data().players.filter(row => row.league === key).map(row => ({ ...row, matchId: byApi.get(String(row.apiMatchId)) || row.matchId }));
    const base = key === 'nba' ? (getStore().playerLogs || []).filter(row => row.sport === 'nba').map(row => ({ ...row, league: key })) : [];
    return [...new Map([...extra, ...base].map(row => [`${row.matchId}:${row.team}:${row.name}`, row])).values()];
  }
  function state() {
    return { connected: Boolean(getApiKey()), cost: 0, modelVersion: MODEL_VERSION, trial: trialSummary(),
      quota: data().quota, requestPolicy: budget.policy(), leagues: Object.entries(LEAGUES).map(([key, config]) => ({ key, ...config, seasons: SEASONS,
        datasets: SEASONS.map(selected => {
          const history = matches(key).filter(game => game.season <= selected), dataset = data().datasets[key]?.[selected];
          const current = history.filter(game => game.season === selected);
          const savedPlayers = players(key).filter(row => row.season <= selected);
          return { season: selected, matches: current.length, history: history.length, fixtures: fixtures(key, selected).length,
            teams: names([...history, ...fixtures(key, selected)]), players: savedPlayers.length,
            playerNames: [...new Set(savedPlayers.map(row => row.name))].sort(), loadedAt: dataset?.loadedAt || (key === 'nba' ? getStore().sports?.nba?.datasets?.[selected]?.loadedAt : null) || null,
            coverage: dataset?.coverage || null, source: dataset?.source || (key === 'nba' && history.length ? 'ESPN guardado' : 'Sin datos'),
            paceGames: history.filter(game => ['home', 'away'].every(side => ['fieldGoalsAttempted', 'freeThrowsAttempted', 'offensiveRebounds', 'turnovers'].every(field => game.stats?.[side]?.[field] != null))).length };
        }) })),
      notice: 'Uso personal. Cuota ajustada solo a un plan verificado en esta sesion. No se contratan servicios ni se extraen masivamente fuentes restringidas.' };
  }
  async function exclusive(action) {
    if (operation) throw new SportsError(409, 'Hay una actualizacion en curso. Espera a que termine.');
    operation = Promise.resolve().then(action);
    try { return await operation; } finally { operation = null; }
  }
  async function provider(endpoint, params = {}) {
    const key = getApiKey();
    if (!key) throw new SportsError(400, 'Conecta la clave gratuita de API-Sports en este panel.');
    const detail = /^games\/statistics\/(players|teams)$/.test(endpoint) && /^\d+$/.test(String(params.id));
    const cacheKey = detail && Object.keys(params).every(name => name === 'id') ? `${endpoint}:${params.id}` : null;
    const cache = data().sharedDetails || {};
    const saved = cacheKey && cache[cacheKey];
    if (saved && Date.parse(saved.at) <= now().getTime() && now().getTime() - Date.parse(saved.at) < 86400000) {
      return { response: structuredClone(saved.response) };
    }
    await budget.before(endpoint, params);
    let response;
    try { response = await fetch(`${API}/${endpoint}?${new URLSearchParams(params)}`, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(25000) }); }
    catch { throw new SportsError(502, 'No se pudo conectar a API-Basketball; se conservan los datos.'); }
    await budget.observe(response);
    if (response.status === 401) budget.reset();
    if (!response.ok) throw new SportsError(response.status === 429 ? 429 : 502, `API-Basketball respondio ${response.status}.`);
    let body; try { body = await response.json(); } catch { throw new SportsError(502, 'Respuesta JSON no valida.'); }
    if (body.errors && Object.keys(body.errors).length) {
      const detail = Object.values(body.errors).join(' ').replaceAll(key, '[clave protegida]');
      const restricted = /access.*season|season.*access|free plan|subscription/i.test(detail);
      throw Object.assign(new SportsError(restricted ? 403 : /rate|quota|limit/i.test(detail) ? 429 : 502, `API-Basketball: ${detail.slice(0, 180)}`), { code: restricted ? 'season_restricted' : 'provider_error' });
    }
    if (endpoint === 'status' ? !body.response?.subscription : !Array.isArray(body.response)) throw new SportsError(502, 'Lista de datos no valida.');
    if (endpoint === 'status') budget.verify(body.response);
    // Both connectors reuse the same native game response; errors and empty/wrong-game replies are never cached.
    if (cacheKey && body.response.length && body.response.every(row => String(row.game?.id) === String(params.id) && row.team?.id != null) &&
      Buffer.byteLength(JSON.stringify(body.response)) <= 128 * 1024) {
      cache[cacheKey] = { at: clock(), response: structuredClone(body.response) };
      data().sharedDetails = Object.fromEntries(Object.entries(cache).filter(([, row]) => now().getTime() - Date.parse(row.at) < 86400000)
        .sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, 64));
      await persist();
    }
    return body;
  }
  async function discover() {
    if (!data().catalog || Date.parse(clock()) - Date.parse(data().catalogAt || 0) > 30 * 86400000) {
      const result = await provider('leagues'); data().catalog = result.response; data().catalogAt = clock(); await persist();
    }
    return data().catalog;
  }
  async function syncLeague(key, selectedSeason, warnings, detailLimit = 8) {
    if (!getApiKey()) {
      if (key === 'nba') { try { await sports.load({ sport: 'nba', season: selectedSeason }); } catch (error) { warnings.push(error.message); } }
      else warnings.push('Euroliga pendiente: conecta la clave gratuita o importa un CSV personal.');
      return;
    }
    const paid = budget.policy().paid;
    const start = now().getUTCMonth() >= 8 ? now().getUTCFullYear() : now().getUTCFullYear() - 1;
    if (paid && selectedSeason !== `${start}/${start + 1}`) {
      warnings.push('Cuota Pro enfocada en hoy y manana: no se actualizan archivos generales de temporadas antiguas. Se conserva el historial guardado.'); return;
    }
    const catalog = await discover();
    const competition = catalog.find(item => key === 'nba' ? item.name === 'NBA' : /^euroleague$/i.test(item.name) && !/women/i.test(item.name));
    if (!competition) throw new SportsError(404, `No se encontro ${LEAGUES[key].name} en el catalogo del proveedor.`);
    for (const selected of [selectedSeason, SEASONS[SEASONS.indexOf(selectedSeason) + 1]].filter(Boolean)) {
      if (paid && selected !== selectedSeason && !focusedTeams([...matches(key), ...fixtures(key, selectedSeason)].map(game => ({ ...game, league: key })), now()).size) continue;
      const details = competition.seasons?.find(item => basketballSeason(item.season) === selected);
      if (!details) { warnings.push(`${LEAGUES[key].name} ${selected}: temporada no disponible.`); continue; }
      const previous = data().datasets[key]?.[selected];
      const ttl = selected === SEASONS[0] ? 45 * 60000 : 30 * 86400000;
      if (previous && Date.parse(clock()) - Date.parse(previous.loadedAt) < ttl && previous.source === 'API-Basketball' && (!paid || selected !== selectedSeason || previous.focusDay === basketballFocus(now()).today)) continue;
      try {
        const payload = await provider('games', { league: String(competition.id), season: details.season });
        const parsed = parseBasketballGames(payload, { league: key, season: selected, leagueId: competition.id, now: clock() });
        if (!parsed.matches.length && !parsed.fixtures.length) { warnings.push(`${selected}: sin encuentros utilizables; se conserva lo guardado.`); continue; }
        data().datasets[key] ||= {};
        const merged = dedup([...(previous?.matches || []), ...parsed.matches.map(game => {
          const old = previous?.matches?.find(item => item.id === game.id);
          return { ...game, stats: Object.fromEntries(['home', 'away'].map(side => [side, { ...old?.stats?.[side], ...game.stats?.[side] }])) };
        })]);
        data().datasets[key][selected] = { matches: merged, fixtures: parsed.fixtures, loadedAt: clock(), source: 'API-Basketball', coverage: details.coverage,
          ...(paid && selected === selectedSeason ? { focusDay: basketballFocus(now()).today } : {}),
          skipped: parsed.skipped, note: 'Sin pretemporada NBA. Cobertura de estadisticas comprobada por temporada; la ausencia no se rellena con cero.' };
        await persist();
      } catch (error) { warnings.push(`${key} ${selected}: ${error.message}`); }
    }
    const candidates = [], targetTeams = paid ? focusedTeams([...matches(key), ...fixtures(key, selectedSeason)].map(game => ({ ...game, league: key })), now()) : null;
    if (paid) candidates.push(...focusedHistory(matches(key), targetTeams, now(), 20).filter(game => game.apiId));
    else for (const team of names(matches(key))) candidates.push(...matches(key).filter(game => [game.home, game.away].includes(team) && game.apiId).slice(-20));
    const pending = dedup(candidates).sort((a, b) => b.date.localeCompare(a.date));
    let calls = 0;
    for (const game of pending) {
      if (calls >= detailLimit || (data().quota.day === clock().slice(0, 10) && data().quota.detailUsed >= budget.policy().detailLimit)) break;
      const coverage = data().datasets[key]?.[game.season]?.coverage?.games?.statistics;
      for (const type of ['players', 'teams']) {
        if (calls >= detailLimit || (data().quota.day === clock().slice(0, 10) && data().quota.detailUsed >= budget.policy().detailLimit)) break;
        const cacheKey = `${key}:${type}:${game.apiId}`;
        if (!coverage?.[type] || data().detailCache[cacheKey]) continue;
        calls++;
        try {
          const payload = await provider(`games/statistics/${type}`, { id: String(game.apiId) });
          if (type === 'players') {
            const records = parsePlayerStats(payload, game).map(row => ({ ...row, apiMatchId: game.apiId }));
            if (!records.length) throw new Error('Sin registros completos de jugadores.');
            data().players = dedup([...data().players, ...records]); data().detailCache[cacheKey] = clock();
          } else {
            if (attachTeamStats(payload, game) !== 2) throw new Error('Faltan estadisticas de uno de los equipos.');
            const stored = data().datasets[key]?.[game.season]?.matches?.find(item => item.apiId === game.apiId);
            if (stored) stored.stats = game.stats;
            data().detailCache[cacheKey] = clock();
          }
          await persist();
        } catch (error) { warnings.push(`${game.home} - ${game.away}: ${error.message}`); }
      }
    }
  }
  function report(body) {
    const key = league(body.league), selected = season(body.season);
    const cutoff = body.cutoff || clock();
    if (!Number.isFinite(Date.parse(cutoff))) throw new SportsError(400, 'Fecha de corte no valida.');
    const history = matches(key).filter(game => game.season <= selected);
    const available = names([...history, ...fixtures(key, selected)]);
    if (!available.includes(body.home) || !available.includes(body.away) || body.home === body.away) throw new SportsError(400, 'Selecciona dos equipos distintos del historial.');
    try { return buildBasketballReport({ ...body, league: key, season: selected, matches: history, cutoff,
      calibration: data().evaluations[key]?.calibration }); }
    catch (error) { throw new SportsError(400, error.message); }
  }
  function list(body) {
    const key = league(body.league), selected = season(body.season), cutoff = body.cutoff || clock();
    const upcoming = fixtures(key, selected).filter(game => game.date > cutoff).slice(0, 60);
    return { fixtures: upcoming.map(game => ({ ...game, report: report({ ...body, ...game, cutoff, league: key }) })), note: 'Calendario guardado. Las estimaciones exploratorias no quedan selladas hasta iniciar/actualizar la prueba.' };
  }
  function week(body = {}) {
    const key = league(body.league), selected = season(body.season);
    try { return buildWeekReport({ league: key, season: selected, startDate: body.startDate, endDate: body.endDate,
      now: clock(), matches: matches(key), fixtures: fixtures(key, selected), players: players(key), references }); }
    catch (error) { throw new SportsError(400, error.message); }
  }
  function player(body) {
    const key = league(body.league), selected = season(body.season);
    try { return forecastPlayer({ ...body, league: key, season: selected, cutoff: body.cutoff || clock(), records: players(key) }); }
    catch (error) { throw new SportsError(400, error.message); }
  }
  function trialSummary() {
    const trial = data().trial;
    if (!trial) return { active: false, snapshots: [], perLeague: {}, end: TRIAL_END };
    const snapshots = trial.snapshots || [];
    const perLeague = Object.fromEntries(Object.keys(LEAGUES).map(key => {
      const saved = snapshots.filter(row => row.league === key), valid = saved.filter(validSnapshot);
      return [key, { ...prospectiveEvaluation(valid, matches(key), players(key)), invalid: saved.length - valid.length }];
    }));
    return { active: trial.active && clock() < TRIAL_END, startedAt: trial.startedAt, end: trial.end, version: trial.version,
      lastRun: trial.lastRun || null, warning: trial.warning || null, perLeague,
      snapshots: snapshots.map(({ inputHash, id, league, fixture, createdAt, markets, version }) => ({ inputHash, id, league, fixture, createdAt, markets, version })),
      exclusions: trial.exclusions || [], rule: 'Se sella una vez, al menos cinco minutos antes del inicio. Sin pretemporada ni partidos ya empezados. Lineas de investigacion fijadas, no cuotas de casas.' };
  }
  async function seal() {
    const trial = data().trial;
    if (!trial?.active || clock() >= TRIAL_END) return;
    if (trial.version !== MODEL_VERSION) throw new SportsError(409, 'La version del modelo difiere del protocolo sellado. No se generan nuevos pronosticos.');
    const time = Date.parse(clock()), last = time + 36 * 3600000;
    for (const key of Object.keys(LEAGUES)) {
      const saved = new Set(trial.snapshots.filter(row => row.league === key).flatMap(row => [String(row.fixture.id), gameKey(row.fixture)]));
      for (const fixture of fixtures(key, SEASONS[0])) {
        if (saved.has(String(fixture.id)) || saved.has(gameKey(fixture)) || fixture.status && !['NS', 'Scheduled', 'STATUS_SCHEDULED'].includes(fixture.status) || Date.parse(fixture.date) <= time + 5 * 60000 || Date.parse(fixture.date) > last || fixture.date >= TRIAL_END ||
          fixture.date < trial.startedAt || key === 'nba' && fixture.date < NBA_START) continue;
        const context = priorGames(matches(key).filter(game => game.season <= SEASONS[0]), clock(), key).slice(-800);
        const result = buildBasketballReport({ ...fixture, league: key, matches: context, cutoff: clock(), lookback: 20, calibration: trial.calibration[key] });
        if (result.markets[0].probability === null) {
          const id = `${key}:${fixture.id}`;
          if (!trial.exclusions.some(row => row.id === id)) trial.exclusions.push({ id, league: key, date: fixture.date, reason: 'Sin al menos cinco resultados por equipo y veinte de liga.' });
          continue;
        }
        trial.exclusions = trial.exclusions.filter(row => row.id !== `${key}:${fixture.id}`);
        const records = players(key).filter(row => [fixture.home, fixture.away].includes(row.team) && availableTime(row) < time);
        const selectedRecords = [];
        for (const team of [fixture.home, fixture.away]) {
          const recent = records.filter(row => row.team === team).sort((a, b) => a.date.localeCompare(b.date));
          const latestDate = recent.at(-1)?.date;
          // Old rosters do not establish availability in a new season.
          const roster = [...new Set(recent.filter(row => row.date === latestDate && row.season === fixture.season).map(row => row.name))];
          const ranked = roster.map(name => { const rows = recent.filter(row => row.name === name).slice(-20); return { name, average: rows.reduce((sum, row) => sum + (row.values?.points || 0), 0) / rows.length }; }).sort((a, b) => b.average - a.average).slice(0, 3);
          for (const { name } of ranked) {
            selectedRecords.push(...recent.filter(row => row.name === name).slice(-20));
            for (const [metric, line] of Object.entries(key === 'nba' ? { points: 20.5, rebounds: 5.5, assists: 4.5, pra: 30.5, threes: 1.5 } : { points: 15.5, rebounds: 5.5, assists: 4.5, pra: 25.5, threes: 1.5 })) {
              const forecast = forecastPlayer({ records, league: key, team, player: name, cutoff: clock(), metric, line });
              if (forecast.over === null) continue;
              result.markets.push({ id: `player-over:${team}:${name}:${metric}`, label: `${name}: over ${line} ${metric}`, group: `player-${metric}`,
                probability: forecast.over, calibrated: false, n: forecast.n, conditionalOnPlaying: true, projectedMinutes: forecast.projectedMinutes,
                spec: { type: 'player', player: name, team, metric, line, direction: 'over' } });
            }
          }
        }
        const evidence = structuredClone({ games: context.map(({ homeLogo, awayLogo, ...game }) => game), players: dedup(selectedRecords), calibration: trial.calibration[key] });
        const inputHash = hash(evidence); data().inputs[inputHash] ||= evidence;
        const snapshot = structuredClone({ id: `${key}:${fixture.id}`, league: key, fixture, createdAt: clock(), version: trial.version, inputHash,
          markets: result.markets, predictions: result.meta.periods, assumptions: result.quality.messages, lookback: 20,
          baseline: { probability: fixture.neutralSite ? 0.5 : mean(context.filter(game => !game.neutralSite).map(game => Number(game.homePoints > game.awayPoints))) ?? 0.5,
            total: mean(context.map(game => game.homePoints + game.awayPoints)) } });
        snapshot.integrity = hash(snapshot); trial.snapshots.push(snapshot);
      }
    }
    await persist();
  }
  async function backtest(body) {
    return exclusive(async () => {
      const key = league(body.league), selected = season(body.season || '2025/2026');
      let result; try { result = historicalEvaluation({ matches: matches(key), league: key, season: selected, lookback: Number(body.lookback || 20) }); }
      catch (error) { throw new SportsError(400, error.message); }
      data().evaluations[key] = { ...result, computedAt: clock() }; await persist(); return result;
    });
  }
  async function refresh(body = {}) {
    return exclusive(async () => {
      const keys = body.league ? [league(body.league)] : ['euroleague', 'nba'], warnings = [];
      for (const key of keys) { try { await syncLeague(key, season(body.season), warnings, body.details === false ? 0 : 8); } catch (error) { warnings.push(error.message); } }
      await seal();
      if (data().trial) { data().trial.lastRun = clock(); data().trial.warning = warnings.join(' ') || null;
        if (clock() >= TRIAL_END) data().trial.active = false; }
      await persist(); return { state: state(), warning: warnings.join(' ') || null };
    });
  }
  async function startTrial() {
    return exclusive(async () => {
      if (clock() >= TRIAL_END) throw new SportsError(400, 'La prueba de octubre ha terminado; sus registros se conservan.');
      if (!data().trial) data().trial = { active: true, startedAt: clock(), end: TRIAL_END, version: MODEL_VERSION,
        calibration: Object.fromEntries(Object.keys(LEAGUES).map(key => [key, structuredClone(data().evaluations[key]?.calibration || {})])),
        snapshots: [], exclusions: [], protocol: { lookback: 20, horizonHours: 36, leadMinutes: 5, nbaStart: NBA_START, lines: LEAGUES, odds: false } };
      await seal(); await persist(); return trialSummary();
    });
  }
  async function stopTrial() {
    return exclusive(async () => {
      if (data().trial?.active) { data().trial.active = false; await persist(); }
      return trialSummary();
    });
  }
  async function importCsv(body) {
    return exclusive(async () => {
      const key = league(body.league), selected = season(body.season);
      if (typeof body.csv !== 'string' || body.csv.length > 10 * 1024 * 1024) throw new SportsError(400, 'CSV no valido, maximo 10 MB.');
      const rows = parseCsvRows(body.csv), header = rows.shift()?.map(value => value.trim().toLowerCase());
      if (!header || !['date', 'home', 'away', 'home_points', 'away_points'].every(field => header.includes(field))) throw new SportsError(400, 'Usa las columnas de la plantilla de baloncesto.');
      const results = [], upcoming = []; let skipped = 0;
      for (const row of rows) {
        const v = Object.fromEntries(header.map((field, index) => [field, row[index] || '']));
        const date = parseCsvDateTime(v.date, v.time, 'America/Guayaquil'), home = v.home.trim(), away = v.away.trim();
        if (!date || !home || !away || home === away || key === 'nba' && !regularNba(date, selected, v.phase)) { skipped++; continue; }
        const game = { id: v.id || `personal:${key}:${date}:${home}:${away}`, league: key, season: selected, date, home, away, seasonType: 2, source: 'CSV personal', stats: {} };
        const hp = count(v.home_points), ap = count(v.away_points);
        if (v.home_points === '' && v.away_points === '' && date > clock()) { game.status = 'NS'; upcoming.push(game); continue; }
        if (!hp || !ap || hp === ap || date >= clock()) { skipped++; continue; }
        Object.assign(game, { homePoints: hp, awayPoints: ap, finished: true, status: 'Final', overtime: v.overtime === 'true' });
        for (const side of ['home', 'away']) {
          const fields = { firstQuarterPoints: 'q1_points', halfTimePoints: 'ht_points', rebounds: 'rebounds', assists: 'assists', threePointersMade: 'threes',
            fieldGoalsAttempted: 'fga', freeThrowsAttempted: 'fta', offensiveRebounds: 'oreb', turnovers: 'turnovers' };
          game.stats[side] = Object.fromEntries(Object.entries(fields).map(([field, column]) => [field, count(v[`${side}_${column}`])]));
          if (game.stats[side].firstQuarterPoints > game[`${side}Points`] || game.stats[side].halfTimePoints > game[`${side}Points`] ||
            game.stats[side].firstQuarterPoints != null && game.stats[side].halfTimePoints != null && game.stats[side].halfTimePoints < game.stats[side].firstQuarterPoints) {
            game.stats[side].firstQuarterPoints = null; game.stats[side].halfTimePoints = null;
          }
        }
        results.push(game);
      }
      if (!results.length && !upcoming.length) throw new SportsError(400, 'No hay resultados o calendario validos.');
      data().datasets[key] ||= {}; const previous = data().datasets[key][selected];
      data().datasets[key][selected] = { matches: dedup([...(previous?.matches || []), ...results]), fixtures: dedup([...(previous?.fixtures || []), ...upcoming]),
        loadedAt: clock(), source: 'CSV personal', note: 'Archivo personal; la importacion no acredita licencia del contenido.' };
      await persist(); return { imported: results.length, fixtures: upcoming.length, skipped, state: state() };
    });
  }
  function validSnapshot({ integrity, ...snapshot }) {
    return integrity === hash(snapshot) && snapshot.inputHash === hash(data().inputs[snapshot.inputHash]) && snapshot.createdAt < snapshot.fixture.date;
  }
  function audit() {
    const trial = data().trial;
    return { version: MODEL_VERSION, inputs: Object.keys(data().inputs).length, snapshots: trial?.snapshots.length || 0,
      valid: !trial || trial.snapshots.every(validSnapshot) };
  }
  return { state, report, list, week, player, refresh, backtest, startTrial, stopTrial, importCsv, audit, trialSummary,
    requestPolicy: budget.policy, resetAccess: budget.reset, verifiedAccess: budget.access, isUpdating: () => Boolean(operation),
    withProvider: action => exclusive(() => action({ request: provider, catalog: discover })),
    evaluation: key => data().evaluations[league(key)] || null,
    tick: async () => { if (data().trial?.active && !operation) return refresh(); } };
}
