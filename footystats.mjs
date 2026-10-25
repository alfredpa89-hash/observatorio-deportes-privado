import { FOOTYSTATS_COMPETITIONS, footystatsCompetition, footystatsSeason } from './footystats-competitions.mjs';
import { ensureFootystatsLeagues, importFootystatsSeason } from './footystats-data.mjs';

const BASE = 'https://api.football-data-api.com';
const MATCH_FIELDS = [
  { id: 'goals', label: 'Goles del partido', fields: ['homeGoalCount', 'awayGoalCount'] },
  { id: 'goalsHt', label: 'Goles del primer tiempo', fields: ['ht_goals_team_a', 'ht_goals_team_b'] },
  { id: 'corners', label: 'Corners del partido', fields: ['team_a_corners', 'team_b_corners'] },
  { id: 'cornersHt', label: 'Corners del primer tiempo', fields: ['team_a_fh_corners', 'team_b_fh_corners'], flag: 'corner_timings_recorded' },
  { id: 'yellow', label: 'Tarjetas amarillas', fields: ['team_a_yellow_cards', 'team_b_yellow_cards'] },
  { id: 'red', label: 'Tarjetas rojas', fields: ['team_a_red_cards', 'team_b_red_cards'] },
  { id: 'offsides', label: 'Fueras de juego', fields: ['team_a_offsides', 'team_b_offsides'] },
  { id: 'fouls', label: 'Faltas', fields: ['team_a_fouls', 'team_b_fouls'] },
  { id: 'shots', label: 'Tiros', fields: ['team_a_shots', 'team_b_shots'] },
  { id: 'shotsOnTarget', label: 'Tiros al arco', fields: ['team_a_shotsOnTarget', 'team_b_shotsOnTarget'] },
];
const PLAYER_FIELDS = [
  { id: 'appearances', label: 'Participaciones de temporada', fields: ['appearances_overall'] },
  { id: 'minutes', label: 'Minutos de temporada', fields: ['minutes_played_overall'] },
  { id: 'goals', label: 'Goles de temporada', fields: ['goals_overall'] },
  { id: 'assists', label: 'Asistencias de temporada', fields: ['assists_overall'] },
  { id: 'yellow', label: 'Amarillas de temporada', fields: ['yellow_cards_overall'] },
  { id: 'red', label: 'Rojas de temporada', fields: ['red_cards_overall'] },
  { id: 'shotsAvg', label: 'Tiros: media por partido', fields: ['detailed.shots_per_game_overall', 'shots_per_game_overall'], alternative: true },
  { id: 'shotsOnTargetAvg', label: 'Tiros al arco: media por partido', fields: ['detailed.shots_on_target_per_game_overall', 'shots_on_target_per_game_overall'], alternative: true },
  { id: 'foulsAvg', label: 'Faltas: media por partido', fields: ['detailed.fouls_committed_per_game_overall', 'fouls_committed_per_game_overall'], alternative: true },
  { id: 'savesAvg', label: 'Atajadas: media por partido (porteros)', fields: ['detailed.saves_per_game_overall', 'saves_per_game_overall'], alternative: true, goalkeeper: true },
  { id: 'saves', label: 'Atajadas de temporada (porteros)', fields: ['detailed.saves_total_overall', 'saves_total_overall'], alternative: true, goalkeeper: true },
];

function number(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function at(object, field) {
  return field.split('.').reduce((value, part) => value?.[part], object);
}

function goalkeeper(row) {
  return /^(goalkeeper|gk|g)$/i.test(String(row.position || ''));
}

function values(row, metric) {
  if (metric.flag && !(number(row[metric.flag]) > 0)) return null;
  const found = metric.fields.map(field => number(at(row, field)));
  if (metric.alternative) {
    const value = found.find(item => item !== null);
    return value === undefined ? null : [value];
  }
  return found.every(value => value !== null) ? found : null;
}

function coverage(rows, definitions) {
  return definitions.map(metric => {
    const eligible = metric.goalkeeper ? rows.filter(goalkeeper) : rows;
    const observed = eligible.map(row => values(row, metric)).filter(value => value !== null);
    const zeros = observed.filter(items => items.every(value => value === 0)).length;
    return { id: metric.id, label: metric.label, n: observed.length, total: eligible.length,
      zeros, positive: observed.length - zeros, status: !observed.length ? 'missing' : zeros === observed.length ? 'zeros-only' : 'reported' };
  });
}

export function auditFootystatsMatches(rows) {
  return coverage(rows.filter(row => row && row.status === 'complete'), MATCH_FIELDS);
}

export function auditFootystatsPlayers(rows) {
  return coverage(rows, PLAYER_FIELDS);
}

export function createFootystatsService({ getStore, persist, errorFactory, fetcher = (...args) => fetch(...args), now = () => new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let key = null, busy = false, quota = null, catalog = [], selectedOnly = true, checkedAt = null, lastIssue = null;
  let selectedCatalog = [], restored = false;
  let requests = 0;
  const usage = () => {
    const store = getStore(); store.footystatsResearch ||= { version: 1, audits: [] };
    const meter = (store.footystatsResearch.requestUsage ||= { day: '', used: 0, quota: null, cooldownUntil: null });
    const day = now().toISOString().slice(0, 10);
    if (meter.day !== day) { meter.day = day; meter.used = 0; }
    return meter;
  };
  const currentQuota = () => {
    quota ||= usage().quota;
    if (quota?.resetAt && quota.resetAt <= now().getTime() / 1000) { quota = null; usage().quota = null; }
    return quota;
  };
  const fail = (status, message, code) => {
    const error = errorFactory(status, message); error.code = code; return error;
  };
  const safeText = (value, limit = 150) => {
    let text = String(value ?? '');
    if (key) text = text.replaceAll(key, '[oculta]').replaceAll(encodeURIComponent(key), '[oculta]');
    return text.slice(0, limit);
  };
  const coverageState = () => FOOTYSTATS_COMPETITIONS.map(target => {
    const saved = getStore().footystatsResearch?.coverage?.[target.id];
    const league = getStore().leagues[target.key];
    return { id: target.id, key: target.key, name: target.name, country: target.country, access: saved?.access || 'pending',
      checkedAt: saved?.checkedAt || null, currentSeason: saved?.currentSeason || null, note: saved?.note || null,
      imported: saved?.imported || null, seasons: league?.seasons || [] };
  });
  const state = () => ({ connected: Boolean(key), busy, checkedAt, quota: currentQuota(), requests, dailyUsed: usage().used, cooldownUntil: usage().cooldownUntil, selectedOnly,
    mode: key === 'example' ? 'public-example' : 'own-key', catalog, lastIssue,
    audits: getStore().footystatsResearch?.audits || [], coverage: coverageState(),
    datasets: Object.values(getStore().footystatsResearch?.datasets || {}) });

  async function run(callback) {
    if (busy) throw fail(409, 'Ya hay una consulta de FootyStats en curso.', 'busy');
    busy = true;
    try { return await callback(); }
    catch (error) { lastIssue = { code: error.code || 'provider_error', message: error.message }; throw error; }
    finally { busy = false; }
  }

  async function request(endpoint, params, credential = key) {
    if (!credential) throw fail(401, 'Conecta tu clave de FootyStats en Fuentes de datos.', 'not_connected');
    currentQuota();
    if (usage().cooldownUntil > now().toISOString()) throw fail(429, 'FootyStats esta en pausa. Se conservan las muestras guardadas.', 'quota_exceeded');
    if (quota?.remaining === 0) throw fail(429, 'FootyStats informa cuota agotada. Se conservan las muestras guardadas.', 'quota_exceeded');
    const url = new URL(endpoint, BASE);
    url.searchParams.set('key', credential);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    requests++;
    usage().used++;
    if (quota?.remaining != null) { quota = { ...quota, remaining: Math.max(0, quota.remaining - 1) }; usage().quota = quota; }
    await persist();
    let response, payload;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw fail(502, 'No se pudo contactar con FootyStats. Comprueba tu conexion; la clave no se ha mostrado.', 'network_error'); }
    try { payload = await response.json(); }
    catch { throw fail(502, 'FootyStats devolvio una respuesta no valida.', 'invalid_response'); }
    const metadata = payload?.metadata;
    const nextQuota = metadata ? { limit: number(metadata.request_limit), remaining: number(metadata.request_remaining),
      resetAt: number(metadata.request_limit_refresh_next) } : null;
    if (nextQuota && (nextQuota.limit !== null || nextQuota.remaining !== null)) {
      const samePeriod = quota?.resetAt === nextQuota.resetAt;
      quota = { ...nextQuota, remaining: samePeriod && quota?.remaining != null && nextQuota.remaining != null ? Math.min(quota.remaining, nextQuota.remaining) : nextQuota.remaining };
      usage().quota = quota;
    }
    if (response.status === 429 || /rate.?limit|quota|too many|request limit/i.test(String(payload?.message ?? ''))) {
      const retry = response.headers.get('retry-after'), until = /^\d+$/.test(retry || '') ? now().getTime() + Number(retry) * 1000 : Date.parse(retry);
      usage().cooldownUntil = new Date(Math.max(now().getTime() + 60000, Number.isFinite(until) ? until : quota?.resetAt * 1000 || now().getTime() + 3600000)).toISOString();
    }
    await persist();
    if (!response.ok || payload?.success === false) {
      // Provider messages can echo the credential or a URL. Only return fixed diagnostics.
      const detail = String(payload?.message ?? '');
      if (response.status === 429 || /rate.?limit|quota|too many|request limit/i.test(detail))
        throw fail(429, 'FootyStats alcanzo su limite de consultas. No se reintenta automaticamente.', 'quota_exceeded');
      if (response.status === 401 || /invalid.{0,30}(key|token)|unauthori[sz]ed|authentication|key.{0,30}(invalid|not valid)/i.test(detail))
        throw fail(401, 'FootyStats no acepto esta clave. Usa la clave de su API, no la de API-Football.', 'invalid_key');
      if (response.status === 403 || response.status === 417 || /subscription|upgrade|permission|not.{0,15}(allowed|authorized)|plan|not (selected|chosen)|subscribe|access denied/i.test(detail))
        throw fail(403, 'Tu acceso de FootyStats no permite esta liga, temporada o endpoint. Revisa las ligas elegidas en tu cuenta; no se compro ningun plan.', 'access_restricted');
      throw fail(502, `FootyStats rechazo la consulta (HTTP ${response.status}). El parametro o endpoint puede no estar permitido.`, 'provider_error');
    }
    if (payload?.success !== true || !Object.hasOwn(payload, 'data')) throw fail(502, 'FootyStats no devolvio el formato esperado.', 'invalid_response');
    return { data: payload.data, quota: nextQuota, pager: payload.pager || null };
  }

  function leagues(rows, credential) {
    if (!Array.isArray(rows)) throw fail(502, 'FootyStats no devolvio una lista de ligas.', 'invalid_response');
    const clean = value => String(value ?? '').replaceAll(credential, '[oculta]').slice(0, 150);
    return rows.filter(row => row && typeof row === 'object').map(row => ({ name: clean(row.league_name || row.name), country: clean(row.country),
      seasons: (Array.isArray(row.season) ? row.season : []).filter(season => Number.isSafeInteger(Number(season.id)) && Number(season.id) > 0)
        .map(season => ({ id: Number(season.id), year: clean(season.year) })).sort((a, b) => b.year.localeCompare(a.year))
    })).filter(row => row.name && row.seasons.length);
  }

  async function connect(body) {
    await run(async () => {
      const candidate = String(body.key ?? '').trim();
      if (!candidate) { key = null; quota = null; catalog = []; selectedCatalog = []; checkedAt = null; lastIssue = null; return state(); }
      if (!/^[A-Za-z0-9._-]{7,200}$/.test(candidate)) throw fail(400, 'El formato de la clave de FootyStats no es valido.', 'invalid_key_format');
      const result = await request('/league-list', { chosen_leagues_only: true }, candidate);
      const nextCatalog = leagues(result.data, candidate);
      key = candidate; catalog = nextCatalog; selectedOnly = true;
      selectedCatalog = nextCatalog;
      checkedAt = now().toISOString(); lastIssue = null; restored = false;
      return state();
    });
    return state();
  }

  async function loadCatalog(body = {}) {
    await run(async () => {
      const chosen = body.all !== true;
      const result = await request('/league-list', { chosen_leagues_only: chosen });
      catalog = leagues(result.data, key); selectedOnly = chosen; checkedAt = now().toISOString(); lastIssue = null;
      if (chosen) selectedCatalog = catalog;
      return state();
    });
    return state();
  }

  function sampleMatch(row) {
    const result = { id: number(row.id), date: number(row.date_unix), home: safeText(row.home_name), away: safeText(row.away_name) };
    for (const metric of MATCH_FIELDS) result[metric.id] = values(row, metric);
    return result;
  }

  function samplePlayer(row) {
    const result = { id: number(row.id), name: safeText(row.known_as || row.full_name), position: safeText(row.position), seasonId: number(row.competition_id) };
    for (const metric of PLAYER_FIELDS) result[metric.id] = values(row, metric)?.[0] ?? null;
    return result;
  }

  async function audit(body) {
    return run(async () => {
      if (!key) throw fail(401, 'Conecta primero tu clave de FootyStats.', 'not_connected');
      const seasonId = Number(body.seasonId), page = Number(body.page ?? 1);
      const league = catalog.find(row => row.seasons.some(season => season.id === seasonId));
      if (!league) throw fail(400, 'Selecciona una temporada del catalogo de FootyStats.', 'invalid_season');
      if (!Number.isInteger(page) || page < 1 || page > 100) throw fail(400, 'La pagina debe estar entre 1 y 100.', 'invalid_page');
      const started = requests, timestamp = now().toISOString();
      let stop = false;
      const notes = [], report = { id: `${seasonId}:${timestamp}`, checkedAt: timestamp, league: league.name, country: league.country,
        seasonId, season: league.seasons.find(season => season.id === seasonId).year, page, mode: key === 'example' ? 'public-example' : 'own-key' };
      const probe = async (endpoint, params) => {
        if (stop) return null;
        try { return await request(endpoint, params); }
        catch (error) {
          notes.push({ endpoint, code: error.code, message: error.message });
          if (['quota_exceeded', 'invalid_key', 'network_error', 'invalid_response'].includes(error.code)) stop = true;
          return null;
        }
      };
      const result = await probe('/league-matches', { season_id: seasonId, max_per_page: 20, page });
      const matches = Array.isArray(result?.data) ? result.data.filter(row => row && typeof row === 'object').slice(0, 20) : [];
      if (result && !Array.isArray(result.data)) notes.push({ endpoint: '/league-matches', code: 'invalid_response', message: 'Formato de partidos no reconocido.' });
      const completed = matches.filter(row => row?.status === 'complete').sort((a, b) => (number(b.date_unix) ?? 0) - (number(a.date_unix) ?? 0));
      report.matches = { returned: matches.length, completed: completed.length, page, totalPages: number(result?.pager?.max_page),
        coverage: auditFootystatsMatches(completed), sample: completed.slice(0, 6).map(sampleMatch) };
      if (completed[0] && number(completed[0].id) > 0) {
        const detail = await probe('/match', { match_id: Number(completed[0].id) });
        const row = Array.isArray(detail?.data) ? detail.data[0] : detail?.data;
        if (row && typeof row === 'object') report.matchDetail = { matchId: number(row.id),
          cornerTimingsPresent: ['team_a_corner_timings', 'team_b_corner_timings'].every(field => Array.isArray(row[field]) || typeof row[field] === 'string' && row[field].trim().length > 0),
          lineupPresent: Boolean(row.lineups && typeof row.lineups === 'object'),
          individualGameLogs: 'not-verified' };
      }
      const playersResult = await probe('/league-players', { season_id: seasonId, include: 'stats', page: 1 });
      const players = Array.isArray(playersResult?.data) ? playersResult.data.filter(row => row && Number(row.competition_id) === seasonId).slice(0, 200) : [];
      if (playersResult && !Array.isArray(playersResult.data)) notes.push({ endpoint: '/league-players', code: 'invalid_response', message: 'Formato de jugadores no reconocido.' });
      const preferred = [...players.filter(goalkeeper), ...players.filter(row => !goalkeeper(row))];
      report.players = { returned: players.length, page: 1, totalPages: number(playersResult?.pager?.max_page), scope: 'season-aggregates',
        coverage: auditFootystatsPlayers(players), sample: preferred.slice(0, 6).map(samplePlayer) };
      if (preferred[0] && number(preferred[0].id) > 0) {
        const individual = await probe('/player-stats', { player_id: Number(preferred[0].id) });
        const rows = Array.isArray(individual?.data) ? individual.data : individual?.data && typeof individual.data === 'object' ? [individual.data] : [];
        const selected = rows.filter(row => Number(row.competition_id) === seasonId);
        if (selected.length) report.individual = { scope: 'season-aggregates', sample: selected.map(samplePlayer).slice(0, 1), coverage: auditFootystatsPlayers(selected) };
      }
      report.requests = requests - started; report.notes = notes;
      report.limits = ['Muestra de una pagina: no certifica toda la liga, temporada ni otras competiciones.',
        'Valores informados no equivalen a recogida completa. Una columna con solo ceros requiere verificar cobertura.',
        'Los agregados de temporada no son un historial individual por partido. No verifican ventanas de 5, 10, 15 o 20 actuaciones.',
        'Sin importacion al modelo, compras ni consultas automaticas. Maximo cuatro consultas por prueba.'];
      const store = getStore();
      store.footystatsResearch = { ...store.footystatsResearch, version: 1, audits: [report, ...(store.footystatsResearch?.audits || [])].slice(0, 12) };
      await persist(); lastIssue = notes.at(-1) || null;
      return { report, state: { ...state(), busy: false } };
    });
  }

  async function sync(body = {}) {
    return run(async () => {
      if (!key) throw fail(401, 'Conecta tu clave de FootyStats para cargar las ligas.', 'not_connected');
      const max = Number(body.maxLeagues ?? 3);
      if (!Number.isInteger(max) || max < 1 || max > 3) throw fail(400, 'La carga admite de una a tres ligas por accion.', 'invalid_batch');
      const store = getStore(), started = requests, timestamp = now().toISOString();
      store.footystatsResearch ||= { version: 1, audits: [] };
      store.footystatsResearch.coverage ||= {}; store.footystatsResearch.datasets ||= {};
      ensureFootystatsLeagues(store);
      if (restored) {
        const result = await request('/league-list', { chosen_leagues_only: true });
        catalog = leagues(result.data, key); selectedCatalog = catalog; selectedOnly = true;
        checkedAt = now().toISOString(); restored = false;
      }
      if (selectedOnly) {
        const result = await request('/league-list', { chosen_leagues_only: false });
        catalog = leagues(result.data, key); selectedOnly = false;
      }
      const eligible = target => {
        const prior = store.footystatsResearch.coverage[target.id];
        if (!body.background || prior?.access !== 'restricted') return true;
        const chosen = selectedCatalog.find(row => footystatsCompetition(row)?.id === target.id), found = catalog.find(row => footystatsCompetition(row)?.id === target.id);
        const signature = (chosen?.seasons || []).map(row => row.id).sort((a, b) => a - b).join(',');
        return prior.catalogAccess !== undefined && prior.catalogAccess !== signature && chosen?.seasons.some(season => season.id === found?.seasons[0]?.id) === true;
      };
      const targets = FOOTYSTATS_COMPETITIONS.filter(eligible).filter(target => body.id ? target.id === body.id : body.refresh === true ||
        !store.footystatsResearch.coverage[target.id]?.checkedAt ||
        Date.parse(store.footystatsResearch.coverage[target.id].checkedAt) < now().getTime() - (body.freshness ? 15 * 60000 : 6 * 3600000)).slice(0, max);
      if (body.id && !FOOTYSTATS_COMPETITIONS.some(target => target.id === body.id)) throw fail(400, 'Competicion FootyStats no reconocida.', 'invalid_competition');
      let stopped = false;
      const updated = [];
      const fetchPage = async (endpoint, params) => {
        if (stopped) return null;
        await pause(1100);
        try { return await request(endpoint, params); }
        catch (error) {
          if (['quota_exceeded', 'invalid_key', 'network_error', 'invalid_response'].includes(error.code)) stopped = true;
          return { error: { code: error.code, message: error.message } };
        }
      };
      for (const target of targets) {
        if (stopped) break;
        const found = catalog.find(league => footystatsCompetition(league)?.id === target.id);
        const chosen = selectedCatalog.find(league => footystatsCompetition(league)?.id === target.id);
        const latest = found?.seasons[0];
        const entry = { id: target.id, key: target.key, name: target.name, checkedAt: timestamp,
          catalogAccess: (chosen?.seasons || []).map(row => row.id).sort((a, b) => a - b).join(','),
          currentSeason: latest ? footystatsSeason(latest.year) : null, access: 'not-in-catalog', note: null,
          imported: store.footystatsResearch.coverage[target.id]?.imported || null };
        if (!latest) { store.footystatsResearch.coverage[target.id] = entry; updated.push(entry); continue; }
        const current = await fetchPage('/league-matches', { season_id: latest.id, max_per_page: 1000, page: 1 });
        entry.access = current?.error ? current.error.code === 'access_restricted' ? 'restricted' : 'error' : Array.isArray(current?.data) ? current.data.length ? 'available' : 'empty' : 'error';
        entry.note = current?.error?.message || null;
        let response = current, season = latest;
        // Only fall back to a season explicitly returned in the user's chosen catalog.
        if (!stopped && current?.error && chosen?.seasons[0] && chosen.seasons[0].id !== latest.id) {
          season = chosen.seasons[0];
          response = await fetchPage('/league-matches', { season_id: season.id, max_per_page: 1000, page: 1 });
        }
        if (Array.isArray(response?.data)) {
          const rows = response.data.filter(row => row && typeof row === 'object').slice(0, 1000);
          const players = []; let playersPartial = false;
          for (let page = 1; page <= 4 && !stopped; page++) {
            const result = await fetchPage('/league-players', { season_id: season.id, include: 'stats', page });
            if (!Array.isArray(result?.data)) { playersPartial = true; break; }
            for (const row of result.data.filter(row => row && Number(row.competition_id) === season.id && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0).slice(0, 200)) players.push({
              ...samplePlayer(row), teamId: number(row.club_team_id), team2Id: number(row.club_team_2_id) });
            if (page >= Number(result.pager?.max_page || 1)) break;
            if (page === 4) playersPartial = true;
          }
          const unique = [...new Map(players.map(player => [player.id, player])).values()];
          const imported = importFootystatsSeason(store, target, season, rows, unique, { now: now(), clean: safeText });
          entry.imported = { ...imported, checkedAt: timestamp, seasonId: season.id, source: 'FootyStats', mode: key === 'example' ? 'public-example' : 'own-key',
            matchesPartial: Number(response.pager?.max_page || 1) > 1, playersPartial, fields: auditFootystatsMatches(rows), playerFields: auditFootystatsPlayers(unique.map(player => ({
              position: player.position, appearances_overall: player.appearances, minutes_played_overall: player.minutes,
              goals_overall: player.goals, assists_overall: player.assists, yellow_cards_overall: player.yellow, red_cards_overall: player.red,
              saves_per_game_overall: player.savesAvg, saves_total_overall: player.saves,
              detailed: { shots_per_game_overall: player.shotsAvg, shots_on_target_per_game_overall: player.shotsOnTargetAvg, fouls_committed_per_game_overall: player.foulsAvg } }))) };
          const teamNames = new Map(store.matches.filter(row => row.leagueKey === target.key && row.season === imported.season)
            .flatMap(row => [[row.homeId, row.home], [row.awayId, row.away]]));
          for (const player of unique) player.team = teamNames.get(player.teamId) || null;
          store.footystatsResearch.datasets[`${target.key}:${season.id}`] = { leagueKey: target.key, league: target.name, country: target.country,
            season: imported.season, seasonId: season.id, downloadedAt: timestamp, source: 'FootyStats', scope: 'season-aggregates',
            playerCount: unique.length, playersPartial, players: unique.sort((a, b) => (b.goals ?? -1) - (a.goals ?? -1)) };
        } else if (response?.error && !entry.note) entry.note = response.error.message;
        store.footystatsResearch.coverage[target.id] = entry;
        store.leagues[target.key].coverageNote = entry.imported ? store.leagues[target.key].coverageNote :
          `Solo FootyStats / ${entry.currentSeason} / ${entry.note || 'sin resultados autorizados'}. No se completa con otras fuentes.`;
        updated.push(entry); await persist();
      }
      await persist();
      const pending = FOOTYSTATS_COMPETITIONS.filter(eligible).filter(target => !store.footystatsResearch.coverage[target.id]?.checkedAt || body.freshness && Date.parse(store.footystatsResearch.coverage[target.id].checkedAt) < now().getTime() - 15 * 60000).length;
      return { state: { ...state(), busy: false }, updated, requests: requests - started, pending, stopped,
        ...(stopped ? { warning: 'FootyStats detuvo el lote por cuota o acceso; se conserva lo guardado.' } : {}) };
    });
  }

  function restoreKey(value) {
    if (value && !/^[A-Za-z0-9._-]{7,200}$/.test(value)) throw fail(400, 'Formato de clave guardada no valido.', 'invalid_key_format');
    key = value || null; quota = null; catalog = []; selectedCatalog = []; selectedOnly = true; checkedAt = null; lastIssue = null; restored = Boolean(value);
  }
  return { state, connect, restoreKey, loadCatalog, audit, sync };
}
