import { createHash, randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { basketballSeason, count, teamName, parsePlayerStats, attachTeamStats, gameKey, localDay, regularNba } from './basketball-data.mjs';
import { buildBasketballReport, forecastPlayer, priorGames, availableTime, mean, cdf, MODEL_VERSION } from './basketball-model.mjs';
import { evaluate, prospectiveEvaluation, historicalEvaluation } from './basketball-evaluation.mjs';
import { basketballFocus, focusedTeams, focusedHistory } from './basketball-focus.mjs';

export const RESEARCH_VERSION = `${MODEL_VERSION}+research-v1`;
export const RESEARCH_LEAGUES = { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa / ACB' };
export const RESEARCH_SEASONS = ['2026/2027', '2025/2026', '2024/2025', '2023/2024', '2022/2023'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => finite(value) ? Math.round(value * 10000) / 10000 : null;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const fail = message => { throw new SportsError(400, message); };
const predict = action => { try { return action(); } catch (error) { fail(error.message); } };
const validDate = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const identity = game => `${game.league}:${gameKey(game)}`;
const entity = row => row.apiPlayerId ? `API-Basketball:${row.apiPlayerId}` : `${row.source || 'Guardado'}:${row.playerId || row.name}`;
const dedup = rows => [...new Map(rows.map(row => [row.id, row])).values()];
const freshAt = (record, cutoff) => record && record.publishedAt <= cutoff && record.recordedAt <= cutoff && record.expiresAt > cutoff;
const competitionFor = (catalog, league) => catalog.find(row => league === 'nba' ? row.name === 'NBA' : league === 'euroleague' ? /^euroleague$/i.test(row.name) : row.name === 'ACB' && row.country?.name === 'Spain');
// Some historical responses omit the exhibition stage. Team labels still
// identify these games; they must not become regular-season observations.
const nbaExhibition = game => game.league === 'nba' && /all[\s-]?stars?|rising[\s-]?stars?|global[\s-]?stars?|young[\s-]?stars?|\bOGs\b/i.test(`${game.phase || ''} ${game.home || ''} ${game.away || ''}`);

export function eligibleNba(date, season, phase) {
  if (season === '2024/2025') return date >= '2024-10-22T05:00:00Z' && date < '2025-04-14T05:00:00Z' && localDay(date) !== '2024-12-17' && !/pre.?season|play.?in|playoff|all.?star|cup.*final|final.*cup/i.test(phase);
  if (['2025/2026', '2026/2027'].includes(season)) return regularNba(date, season, phase);
  return /regular/i.test(phase) && !/pre.?season|playoff|all.?star|cup.*final/i.test(phase);
}

export function parseResearchGames(payload, { league, season, leagueId, now }) {
  if (!Array.isArray(payload.response)) fail('Lista de encuentros no valida.');
  const games = []; let skipped = 0;
  for (const row of payload.response) {
    const home = teamName(row.teams?.home?.name, league), away = teamName(row.teams?.away?.name, league);
    const date = validDate(row.date) ? new Date(row.date).toISOString() : null;
    const phase = typeof row.stage === 'string' ? row.stage : row.stage?.name || '';
    const finished = ['FT', 'AOT'].includes(row.status?.short);
    if (!date || !row.id || row.league?.id !== leagueId || basketballSeason(row.league?.season) !== season || !home || !away || home === away ||
      league === 'nba' && (!eligibleNba(date, season, phase) || nbaExhibition({ league, phase, home, away })) || /pre.?season|friendly/i.test(phase) || !finished && !(row.status?.short === 'NS' && date > now) || finished && date >= now) { skipped++; continue; }
    const game = { id: `api-basketball:${row.id}`, apiId: row.id, league, season, date, home, away, homeId: row.teams.home.id, awayId: row.teams.away.id,
      finished, preseason: false, seasonType: 2, status: finished ? 'Final' : 'NS', overtime: row.status.short === 'AOT', phase, source: 'API-Basketball', fetchedAt: now, stats: {}, periods: {}, issues: [] };
    if (finished) {
      const scores = ['home', 'away'].map(side => count(row.scores?.[side]?.total));
      if (scores.some(score => score === null || score <= 0) || scores[0] === scores[1]) { skipped++; continue; }
      [game.homePoints, game.awayPoints] = scores;
      for (const [index, side] of ['home', 'away'].entries()) {
        const raw = row.scores[side], quarters = [1, 2, 3, 4].map(q => count(raw[`quarter_${q}`]));
        const overtime = count(raw.over_time);
        const sum = quarters.every(finite) ? quarters.reduce((a, b) => a + b, 0) : null;
        const invalid = quarters.filter(finite).reduce((a, b) => a + b, 0) > scores[index] || sum !== null && (sum > scores[index] || (overtime !== null || !game.overtime) && sum + (overtime ?? 0) !== scores[index]);
        if (invalid) { quarters.fill(null); game.issues.push(`${side}: periodos inconsistentes con el total`); }
        const ht = quarters[0] !== null && quarters[1] !== null ? quarters[0] + quarters[1] : null;
        game.periods[side] = { q1: quarters[0], q2: quarters[1], q3: quarters[2], q4: quarters[3], ht, ot: invalid ? null : overtime, ft: scores[index] };
        game.stats[side] = { firstQuarterPoints: quarters[0], halfTimePoints: ht };
      }
    }
    games.push(game);
  }
  return { games, skipped };
}

export function parseResearchPlayers(payload, game, now) {
  const played = new Map(parsePlayerStats(payload, game).map(row => [String(row.apiPlayerId), row]));
  return (payload.response || []).flatMap(raw => {
    const side = ['home', 'away'].find(side => raw.team?.id === game[`${side}Id`]);
    if (!side || String(raw.game?.id) !== String(game.apiId) || !raw.player?.id || !text(raw.player.name)) return [];
    const existing = played.get(String(raw.player.id)), zero = raw.minutes === 0 || /^0+(?::00)?$/.test(String(raw.minutes));
    return [{ ...existing, id: `research:${game.league}:${game.id}:${raw.player.id}`, matchId: game.id, apiPlayerId: raw.player.id,
      league: game.league, season: game.season, date: game.date, name: text(raw.player.name), team: game[side], teamId: game[`${side}Id`],
      opponent: game[side === 'home' ? 'away' : 'home'], minutes: existing?.minutes ?? (zero ? 0 : null), starter: raw.type === 'starters',
      participation: existing ? 'played' : zero ? 'did_not_play' : 'unknown', source: 'API-Basketball', fetchedAt: now,
      values: existing?.values || { points: null, rebounds: null, assists: null, pra: null, threes: null } }];
  });
}

export function createBasketballResearch({ getStore, persist, basketball, externalAvailability = () => [], now = () => new Date() }) {
  const clock = () => now().toISOString();
  const read = () => getStore().basketballResearch || { schema: 1, games: [], players: [], availability: [], forecasts: [], inputs: {}, details: {} };
  const data = () => (getStore().basketballResearch ||= read());
  function selection(body = {}) {
    const league = body.league || 'euroleague', season = body.season || RESEARCH_SEASONS[0];
    if (!RESEARCH_LEAGUES[league] || !RESEARCH_SEASONS.includes(season)) fail('Competicion o temporada de investigacion no valida.');
    return { league, season };
  }
  function games() {
    const store = getStore(), old = [];
    for (const [season, dataset] of Object.entries(store.sports?.nba?.datasets || {})) old.push(...[...(dataset.matches || []), ...(dataset.fixtures || [])].map(game => ({ ...game, league: 'nba', season: game.season || season })));
    for (const [league, seasons] of Object.entries(store.basketball?.datasets || {})) for (const [season, dataset] of Object.entries(seasons)) old.push(...[...(dataset.matches || []), ...(dataset.fixtures || [])].map(game => ({ ...game, league, season })));
    const map = new Map();
    for (const game of [...old, ...read().games]) {
      if (!RESEARCH_LEAGUES[game.league] || !validDate(game.date) || game.preseason || nbaExhibition(game) || game.league === 'nba' && !eligibleNba(game.date, game.season, game.phase || 'Regular Season')) continue;
      const key = identity(game);
      if (map.get(key)?.finished && !game.finished) continue;
      map.set(key, game);
    }
    return [...map.values()].map(game => ({ ...game, periods: game.periods || Object.fromEntries(['home', 'away'].map(side => [side, { ft: game[`${side}Points`] ?? null,
      q1: game.stats?.[side]?.firstQuarterPoints ?? null, q2: null, q3: null, q4: null, ot: null, ht: game.stats?.[side]?.halfTimePoints ?? null }])) })).sort((a, b) => a.date.localeCompare(b.date));
  }
  const playerSource = () => [...(getStore().playerLogs || []).filter(row => row.sport === 'nba').map(row => ({ ...row, league: 'nba' })), ...(getStore().basketball?.players || []), ...read().players];
  function players() {
    const source = playerSource();
    const exhibitionIds = new Set([...Object.values(getStore().sports?.nba?.datasets || {}).flatMap(dataset => [...(dataset.matches || []), ...(dataset.fixtures || [])].map(game => ({ ...game, league: 'nba' }))),
      ...Object.values(getStore().basketball?.datasets?.nba || {}).flatMap(dataset => [...(dataset.matches || []), ...(dataset.fixtures || [])].map(game => ({ ...game, league: 'nba' }))), ...read().games].filter(nbaExhibition).map(game => game.id));
    const map = new Map();
    for (const record of source) if (RESEARCH_LEAGUES[record.league] && !(record.league === 'nba' && (exhibitionIds.has(record.matchId) || nbaExhibition({ league: 'nba', home: record.team, away: record.opponent })))) map.set(`${record.league}:${record.matchId}:${record.team}:${entity(record)}`, { ...record, playerKey: entity(record) });
    return [...map.values()];
  }
  const availabilityReports = () => [...read().availability, ...externalAvailability(), ...(getStore().contextReports || []).filter(row => row.sport === 'basketball' && row.playerKey)
    .map(row => ({ ...row, league: row.key, fixtureId: null }))];
  function availabilityAt(league, team, playerKey, fixtureId, cutoff, season) {
    const latest = availabilityReports().filter(row => row.league === league && (!row.season || row.season === season) && row.team === team && row.playerKey === playerKey && (!row.fixtureId || row.fixtureId === fixtureId) && row.recordedAt <= cutoff && row.publishedAt <= cutoff).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
    return freshAt(latest, cutoff) ? latest : null;
  }
  function state(body = {}) {
    const { league, season } = selection(body), all = games().filter(row => row.league === league && row.season === season), logs = players().filter(row => row.league === league && row.season === season);
    const depth = Number(body.lookback || 20);
    if (![5, 10, 15, 20, 25, 30].includes(depth)) fail('Ventana de historial no valida.');
    const grouped = new Map();
    for (const record of logs.sort((a, b) => a.date.localeCompare(b.date))) { const key = `${record.team}:${record.playerKey}`; (grouped.get(key) || (grouped.set(key, []), grouped.get(key))).push(record); }
    const profiles = [...grouped.values()].map(history => {
      const last = history.at(-1), recent = history.filter(row => row.minutes > 0).slice(-depth);
      const avg = field => { const values = recent.map(row => field === 'minutes' ? row.minutes : row.values?.[field]).filter(finite); return { value: round(mean(values)), n: values.length, missing: recent.length - values.length }; };
      return { playerKey: last.playerKey, name: last.name, team: last.team, latest: last.date, games: recent.length,
        averages: Object.fromEntries(['minutes', 'points', 'rebounds', 'assists', 'pra', 'threes'].map(field => [field, avg(field)])) };
    });
    const catalog = getStore().basketball?.catalog || [];
    const teams = [...new Set(all.filter(game => game.finished).flatMap(game => [game.home, game.away]))].sort().map(team => {
      const recent = all.filter(game => game.finished && [game.home, game.away].includes(team)).slice(-depth);
      return { team, n: recent.length, wins: recent.filter(game => (game.home === team ? game.homePoints > game.awayPoints : game.awayPoints > game.homePoints)).length,
        periods: Object.fromEntries(['ft', 'q1', 'ht'].map(period => {
          const pairs = recent.map(game => { const side = game.home === team ? 'home' : 'away', opponent = side === 'home' ? 'away' : 'home'; return [game.periods[side][period], game.periods[opponent][period]]; }).filter(pair => pair.every(finite));
          return [period, { n: pairs.length, missing: recent.length - pairs.length, scored: round(mean(pairs.map(pair => pair[0]))), conceded: round(mean(pairs.map(pair => pair[1]))) }];
        })) };
    });
    return { version: RESEARCH_VERSION, league, season, lookback: depth, connected: basketball.state().connected, access: read().access || null,
      quota: getStore().basketball?.quota || {}, requestPolicy: basketball.requestPolicy?.() || null, seasons: RESEARCH_SEASONS, competitions: Object.entries(RESEARCH_LEAGUES).map(([key, name]) => {
        const competition = competitionFor(catalog, key), coverage = competition?.seasons?.find(row => basketballSeason(row.season) === season);
        return { key, name, providerName: competition?.name || null, id: competition?.id || null, coverage: coverage?.coverage || null, catalogAt: getStore().basketball?.catalogAt || null };
      }), counts: { games: all.filter(row => row.finished).length, fixtures: all.filter(row => !row.finished && row.date > clock()).length, players: logs.length,
        completeQuarters: all.filter(row => row.finished && ['home', 'away'].every(side => ['q1', 'q2', 'q3', 'q4'].every(q => finite(row.periods?.[side]?.[q])))).length },
      games: all.filter(row => row.finished).slice(-100).reverse(), fixtures: all.filter(row => !row.finished && row.date > clock()).slice(0, 60), players: profiles, teams,
      lastSync: read().lastSync || null, historical: read().backtests?.[`${league}:${season}:${depth}`] || null,
      availability: availabilityReports().filter(row => row.league === league && (!row.season || row.season === season)).slice(-100).reverse().map(row => ({ ...row, stale: !freshAt(row, clock()) })),
      forecasts: read().forecasts.filter(row => row.league === league && row.fixture.season === season).map(({ inputHash, integrity, ...row }) => ({ ...row, inputHash, valid: validForecast(read().forecasts.find(saved => saved.id === row.id)) })),
      evaluation: evaluation(league), notice: 'Archivo privado independiente. No modifica el protocolo, calibracion ni pronosticos de octubre. Endesa: datos disponibles para investigar, modelo predictivo independiente pendiente.' };
  }
  async function verify() {
    const current = basketball.verifiedAccess?.();
    if (current && now().getTime() - Date.parse(current.verifiedAt) < 60000) return { api: 'API-Basketball', ...current };
    return basketball.withProvider(async ({ request }) => {
      const body = await request('status'), response = body.response;
      data().access = { api: 'API-Basketball', plan: text(response.subscription.plan, 30), active: response.subscription.active === true,
        end: validDate(response.subscription.end) ? response.subscription.end : null, dailyLimit: count(response.requests?.limit_day ?? response.requests?.limit), verifiedAt: clock() };
      await persist(); return data().access;
    });
  }
  async function sync(body = {}) {
    const { league, season } = selection(body), paid = basketball.requestPolicy?.().paid === true;
    return basketball.withProvider(async ({ request, catalog }) => {
      const competition = competitionFor(await catalog(), league), scope = competition?.seasons?.find(row => basketballSeason(row.season) === season);
      if (!scope) fail('Temporada no encontrada en el catalogo; no se presume cobertura.');
      const warnings = [], source = data(), key = `${league}:${season}`;
      if (source.lastSync?.key === key && (!paid || source.lastSync.focusDay === basketballFocus(now()).today) && Date.parse(clock()) - Date.parse(source.lastSync.at) < 15 * 60000) return { cached: true, warning: source.lastSync.warning, state: state(body) };
      let imported = 0, details = 0;
      try {
        const parsed = parseResearchGames(await request('games', { league: String(competition.id), season: scope.season }), { league, season, leagueId: competition.id, now: clock() });
        source.games = dedup([...source.games, ...parsed.games.map(game => { const previous = source.games.find(row => row.id === game.id && row.league === league); game.stats = Object.fromEntries(['home', 'away'].map(side => [side, { ...previous?.stats?.[side], ...game.stats[side] }])); return game; })]);
        imported = parsed.games.length;
        if (parsed.skipped) warnings.push(`${parsed.skipped} encuentros no admisibles o incompletos.`);
        await persist();
        if (paid) {
          const saved = games().filter(game => game.league === league), participants = focusedTeams(saved, now());
          const previousYear = Number(season.slice(0, 4)) - 1, previousSeason = `${previousYear}/${previousYear + 1}`;
          const previousScope = competition.seasons?.find(row => basketballSeason(row.season) === previousSeason);
          const indexKey = `${league}:${previousSeason}`, checked = source.historyCalendars?.[indexKey];
          const needsHistory = [...participants].some(team => saved.filter(game => game.finished && game.season === season && [game.home, game.away].includes(team) && availableTime(game) < now().getTime()).length < 30);
          // A cached season index supplies game IDs, not a general player-statistics backfill.
          if (needsHistory && previousScope && (!checked || now().getTime() - Date.parse(checked) >= 30 * 86400000)) {
            const history = parseResearchGames(await request('games', { league: String(competition.id), season: previousScope.season }),
              { league, season: previousSeason, leagueId: competition.id, now: clock() });
            source.games = dedup([...source.games, ...history.games.filter(game => game.finished).map(game => {
              const previous = source.games.find(row => row.id === game.id && row.league === league);
              return { ...game, stats: Object.fromEntries(['home', 'away'].map(side => [side, { ...previous?.stats?.[side], ...game.stats[side] }])) };
            })]);
            (source.historyCalendars ||= {})[indexKey] = clock(); await persist();
          }
        }
        const all = games().filter(game => game.league === league), teams = focusedTeams(all, now());
        const eligible = paid ? new Set(focusedHistory(all, teams, now()).map(game => game.id)) : null;
        for (const game of parsed.games.filter(row => row.finished && (!eligible || eligible.has(row.id))).sort((a, b) => b.date.localeCompare(a.date))) {
          for (const type of ['teams', 'players']) {
            const detailKey = `${league}:${type}:${game.apiId}`;
            if (details >= (body.details === false ? 0 : 8) || !scope.coverage?.games?.statistics?.[type] || source.details[detailKey]) continue;
            details++;
            try {
              const payload = await request(`games/statistics/${type}`, { id: String(game.apiId) });
              if (type === 'players') {
                const rows = parseResearchPlayers(payload, game, clock());
                if (!rows.length) throw new Error('Sin registros individuales utilizables.');
                source.players = dedup([...source.players, ...rows]);
              (source.playerSchemas ||= {})[detailKey] = 1;
              } else if (attachTeamStats(payload, game) !== 2) throw new Error('Faltan estadisticas de un equipo.');
              source.details[detailKey] = clock();
              const saved = source.games.find(row => row.id === game.id && row.league === league); saved.stats = game.stats;
              await persist();
            } catch (error) { warnings.push(error.message); }
          }
          if (details >= (body.details === false ? 0 : 8)) break;
        }
      } catch (error) { warnings.push(error.message); }
      source.lastSync = { key, at: clock(), imported, details, ...(paid ? { focusDay: basketballFocus(now()).today } : {}), warning: warnings.join(' ') || null };
      await persist(); return { imported, details, warning: source.lastSync.warning, state: state(body) };
    });
  }
  async function syncPlayers(body = {}) {
    const { league, season } = selection(body), team = text(body.team), lookback = Number(body.lookback ?? 20);
    const maxGames=body.maxGames==null?4:Number(body.maxGames);
    if(!Number.isInteger(maxGames)||maxGames<1||maxGames>4) fail('El lote individual debe contener de uno a cuatro encuentros.');
    if (!team || ![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Selecciona un equipo y una ventana de historial valida.');
    if (basketball.requestPolicy?.().paid && !focusedTeams(games().filter(game => game.league === league), now()).has(team)) {
      throw new SportsError(409, 'Cuota Pro enfocada en hoy y manana de Guayaquil: este equipo no tiene un encuentro admisible guardado en esa ventana. Puedes consultar su historial ya guardado sin consumir API.');
    }
    const cutoff = Math.min(Date.parse(body.cutoff || clock()), now().getTime());
    if (!Number.isFinite(cutoff)) fail('Fecha de corte no valida.');
    const selected = games().filter(game => game.league === league && game.season === season && game.finished && [game.home, game.away].includes(team) && availableTime(game) < cutoff).slice(-lookback);
    if (!selected.length) fail('No hay partidos admisibles de este equipo en la temporada elegida. Carga primero una temporada autorizada.');
    return basketball.withProvider(async ({ request, catalog }) => {
      const competition = competitionFor(await catalog(), league), scope = competition?.seasons?.find(row => basketballSeason(row.season) === season);
      if (scope?.coverage?.games?.statistics?.players !== true) fail('El catalogo no anuncia estadisticas individuales para esta temporada.');
      const source = data(), loadKey = `${league}:${season}:${team}:${lookback}:${body.cutoff || clock().slice(0, 10)}`;
      const recent = source.playerLoads?.[loadKey];
      if (recent && now().getTime() - Date.parse(recent.at) < 15 * 60000 && !body.resume) return { ...recent, cached: true };
      const schema = source.playerSchemas || {}, pending = selected.filter(game => game.apiId && schema[`${league}:players:${game.apiId}`] !== 1)
        .sort((a, b) => Number(Boolean(source.details[`${league}:players:${a.apiId}`])) - Number(Boolean(source.details[`${league}:players:${b.apiId}`])) || b.date.localeCompare(a.date));
      let calls = 0, records = 0, completed = 0;
      const warnings = [];
      for (const game of pending.slice(0, maxGames)) {
        if ((getStore().basketball?.quota?.detailUsed || 0) >= (basketball.requestPolicy?.().detailLimit ?? 24) && getStore().basketball?.quota?.day === clock().slice(0, 10)) { warnings.push('Lote diario de estadisticas completo; se conserva el historial.'); break; }
        calls++;
        try {
          const rows = parseResearchPlayers(await request('games/statistics/players', { id: String(game.apiId) }), game, clock());
          if (!rows.length) { warnings.push('Un encuentro no devolvio registros individuales utilizables.'); continue; }
          const previous = new Map(source.players.map(row => [row.id, row]));
          source.players = dedup([...source.players, ...rows.map(row => {
            const old = previous.get(row.id);
            return { ...row, shooting: { ...old?.shooting, ...Object.fromEntries(Object.entries(row.shooting || {}).filter(([, value]) => value != null)) } };
          })]);
          const key = `${league}:players:${game.apiId}`;
          source.details[key] = clock(); (source.playerSchemas ||= {})[key] = 1;
          records += rows.length; completed++;
          await persist();
        } catch (error) { warnings.push(error.message); break; }
      }
      const result = { at: clock(), league, season, team, calls, records, completed, pending: Math.max(0, pending.length - completed),
        windowGames: selected.length, withoutApi: selected.filter(game => !game.apiId).length, warning: [...new Set(warnings)].join(' ') || null };
      (source.playerLoads ||= {})[loadKey] = result; await persist(); return result;
    });
  }
  async function saveAvailability(body) {
    const { league, season } = selection(body), team = text(body.team), playerKey = text(body.playerKey), name = text(body.name), createdAt = clock();
    if (!team || !playerKey || !name || !['unknown', 'active', 'questionable', 'out', 'minutes_limit'].includes(body.status)) fail('Completa jugador, equipo y estado de disponibilidad.');
    let url; try { url = new URL(body.sourceUrl); } catch { fail('Incluye un enlace a la fuente del reporte.'); }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname) || /(?:localhost|\.local)$/i.test(url.hostname)) fail('La fuente debe ser un enlace HTTPS publico sin credenciales.');
    if (/[?&](?:api[_-]?key|key|token|secret|password|authorization)=/i.test(url.href)) fail('El enlace no debe contener claves ni tokens.');
    if (!validDate(body.publishedAt) || !validDate(body.expiresAt)) fail('Indica fecha y hora con zona para publicacion y vigencia.');
    const publishedAt = new Date(body.publishedAt).toISOString(), expiresAt = new Date(body.expiresAt).toISOString();
    if (publishedAt > createdAt || expiresAt <= createdAt || Date.parse(expiresAt) - Date.parse(publishedAt) > 7 * 86400000) fail('Publicacion no futura y vigencia vigente, de hasta siete dias.');
    const minutesLimit = body.minutesLimit === '' || body.minutesLimit == null ? null : Number(body.minutesLimit);
    if (minutesLimit !== null && (!finite(minutesLimit) || minutesLimit < 0 || minutesLimit > (league === 'nba' ? 68 : 60)) || body.status === 'minutes_limit' && minutesLimit === null) fail('Limite de minutos no valido.');
    const fixture = body.fixtureId ? games().find(row => row.id === body.fixtureId && row.league === league && [row.home, row.away].includes(team)) : null;
    if (body.fixtureId && !fixture) fail('El encuentro no corresponde al equipo o competicion.');
    const report = { id: randomUUID(), league, season, team, playerKey, name, fixtureId: fixture?.id || null, status: body.status, minutesLimit,
      sourceUrl: url.href, publishedAt, recordedAt: createdAt, expiresAt, note: text(body.note, 500), verification: 'manual' };
    data().availability.push(report); await persist(); return report;
  }
  async function syncBalanced(body = {}) {
    const { league, season } = selection(body), lookback = 30, paid = basketball.requestPolicy?.().paid === true;
    const focus = basketballFocus(now()), focusTeams = focusedTeams(games().filter(game => game.league === league), now());
    if (paid && !focusTeams.size) return { calls: 0, completed: 0, pending: 0, teams: 0, focus,
      warning: 'Sin participantes admisibles guardados para hoy o manana; no se consumen detalles Pro ni se supone que el calendario este completo.' };
    return basketball.withProvider(async ({ request, catalog }) => {
      const competition = competitionFor(await catalog(), league), scope = competition?.seasons?.find(row => basketballSeason(row.season) === season);
      if (!scope) throw new SportsError(403, 'Temporada no anunciada por el proveedor.');
      const source = data(), all = games().filter(game => game.league === league && (paid || game.season === season));
      const finished = all.filter(game => game.finished && availableTime(game) < now().getTime()).sort((a, b) => b.date.localeCompare(a.date));
      const teams = paid ? [...focusTeams] : [...new Set(finished.flatMap(game => [game.home, game.away]))];
      const windows = new Map(teams.map(team => [team, finished.filter(game => [game.home, game.away].includes(team)).slice(0, lookback)]));
      const selected = [...new Map([...windows.values()].flat().filter(game => game.apiId).map(game => [game.id, game])).values()];
      const upcoming = paid ? focusTeams : new Set(all.filter(game => !game.finished && game.date > clock() && Date.parse(game.date) < now().getTime() + 7 * 86400000).flatMap(game => [game.home, game.away]));
      const supported = (type, game) => !paid || competition.seasons?.find(row => basketballSeason(row.season) === game.season)?.coverage?.games?.statistics?.[type] === true;
      const types = ['players', 'teams'].filter(type => scope.coverage?.games?.statistics?.[type] === true || paid && selected.some(game => supported(type, game)));
      const done = (type, game) => type === 'players' ? source.playerSchemas?.[`${league}:players:${game.apiId}`] === 1 : Boolean(source.details[`${league}:teams:${game.apiId}`]);
      const pending = selected.flatMap(game => types.filter(type => supported(type, game) && !done(type, game)).map(type => ({ game, type })));
      const max = basketball.requestPolicy?.().paid ? 12 : 2;
      let calls = 0, completed = 0, empty = 0;
      for (let index = 0; index < max && pending.length; index++) {
        const counts = new Map(teams.map(team => [team, (windows.get(team) || []).filter(game => done('players', game)).length]));
        const priority = ({ game, type }) => [game.home, game.away].reduce((n, team) => n + (upcoming.has(team) ? 100 : 0) + 30 - (counts.get(team) || 0), 0) + (type === 'players' ? 20 : 0);
        pending.sort((a, b) => priority(b) - priority(a) || b.game.date.localeCompare(a.game.date));
        const { game, type } = pending.shift(), key = `${league}:${type}:${game.apiId}`;
        if (Date.parse(source.emptyDetails?.[key]) > now().getTime() - 86400000) { empty++; continue; }
        calls++;
        const payload = await request(`games/statistics/${type}`, { id: String(game.apiId) });
        let useful = false;
        if (type === 'players') {
          const rows = parseResearchPlayers(payload, game, clock());
          if (rows.some(row => row.minutes > 0)) { source.players = dedup([...source.players, ...rows]); (source.playerSchemas ||= {})[key] = 1; useful = true; }
        } else if (attachTeamStats(payload, game) === 2) {
          const saved = source.games.find(row => row.league === league && row.id === game.id);
          if (saved) saved.stats = game.stats;
          else source.games.push(game);
          useful = true;
        }
        if (useful) { source.details[key] = clock(); completed++; }
        else { (source.emptyDetails ||= {})[key] = clock(); empty++; }
        await persist();
      }
      return { calls, completed, empty, pending: pending.length + empty, teams: teams.length, coverageTypes: types, ...(paid ? { focus } : {}),
        warning: !types.length ? 'El catalogo no anuncia detalles de jugadores ni equipos.' : empty ? 'Detalles vacios en pausa durante 24 horas; no son ceros.' : null };
    });
  }
  function validForecast(snapshot) {
    try {
      const { integrity, ...row } = snapshot, input = read().inputs[row.inputHash];
      return Boolean(input && integrity === hash(row) && row.inputHash === hash(input) && validDate(row.createdAt) && validDate(row.fixture.date) && row.createdAt < row.fixture.date);
    } catch { return false; }
  }
  async function seal(body) {
    const { league, season } = selection(body), createdAt = clock();
    if (league === 'endesa') fail('Endesa esta disponible para datos; su modelo independiente aun no esta validado.');
    const fixture = games().find(row => row.id === body.fixtureId && row.league === league && row.season === season && !row.finished);
    if (!fixture || fixture.timeKnown === false || Date.parse(fixture.date) < Date.parse(createdAt) + 5 * 60000) fail('Selecciona un encuentro futuro con hora confirmada y al menos cinco minutos antes del inicio.');
    const lookback = Number(body.lookback || 20);
    if (![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Ventana de historial no valida.');
    const previousSeason = `${Number(season.slice(0, 4)) - 1}/${season.slice(0, 4)}`;
    const context = priorGames(games().filter(row => row.league === league && [season, previousSeason].includes(row.season)), createdAt, league).slice(-800);
    const reports = availabilityReports().filter(row => row.league === league && (!row.season || row.season === season) && [fixture.home, fixture.away].includes(row.team) && (!row.fixtureId || row.fixtureId === fixture.id) && freshAt(row, createdAt));
    let markets, predictions, playerProjection = null, evidencePlayers = [], target = 'match';
    if (body.playerKey) {
      target = `player:${body.team}:${body.playerKey}:${body.metric}:${body.line}`;
      if (![fixture.home, fixture.away].includes(body.team)) fail('Jugador fuera de los equipos del encuentro.');
      evidencePlayers = players().filter(row => row.league === league && row.team === body.team && row.playerKey === body.playerKey && [season, previousSeason].includes(row.season) && availableTime(row) < Date.parse(createdAt));
      if (!evidencePlayers.some(row => row.season === season && row.minutes > 0)) fail('Falta una aparicion del jugador con este equipo en la temporada actual.');
      const latestTeams = players().filter(row => row.league === league && row.season === season && row.playerKey === body.playerKey && row.minutes > 0 && availableTime(row) < Date.parse(createdAt))
        .sort((a, b) => b.date.localeCompare(a.date));
      if (latestTeams.some(row => row.date === latestTeams[0]?.date && row.team !== body.team)) fail('La participacion mas reciente vincula este jugador con otro equipo; revisa su identidad y plantilla.');
      const report = availabilityAt(league, body.team, body.playerKey, fixture.id, createdAt, season), status = report?.status === 'minutes_limit' ? 'active' : report?.status || 'unknown';
      const proposed = body.projectedMinutes === '' || body.projectedMinutes == null ? undefined : Number(body.projectedMinutes);
      if (proposed !== undefined && (!finite(proposed) || proposed < 1)) fail('Minutos proyectados no validos.');
      const records = evidencePlayers.map(row => ({ ...row, name: 'selected-player' }));
      playerProjection = predict(() => forecastPlayer({ records, player: 'selected-player', team: body.team, league, season, cutoff: createdAt,
        metric: body.metric, line: Number(body.line), lookback, projectedMinutes: proposed, status }));
      if (report?.minutesLimit != null && playerProjection.projectedMinutes > report.minutesLimit) {
        if (report.minutesLimit === 0) fail('Limite declarado de cero minutos: no se sella pronostico individual.');
        playerProjection = predict(() => forecastPlayer({ records, player: 'selected-player', team: body.team, league, season, cutoff: createdAt,
          metric: body.metric, line: Number(body.line), lookback, projectedMinutes: report.minutesLimit, status }));
      }
      const record = evidencePlayers.toSorted((a, b) => a.date.localeCompare(b.date)).at(-1);
      if (playerProjection.over === null) fail('Sin muestra suficiente o jugador marcado como baja.');
      playerProjection.player = record.name;
      markets = [{ id: 'player-over', group: `player-${body.metric}`, label: `${record.name}: over ${body.line} ${body.metric}`,
        probability: playerProjection.over, spec: { type: 'player', period: 'ft', player: record.name, playerKey: body.playerKey, team: body.team, metric: body.metric, line: Number(body.line), direction: 'over' } }];
      predictions = {};
    } else {
      const report = predict(() => buildBasketballReport({ matches: context, league, season, home: fixture.home, away: fixture.away, cutoff: createdAt, date: fixture.date, lookback,
        totalLine: Number(body.totalLine), spreadLine: Number(body.spreadLine), quarterLine: Number(body.quarterLine), halfLine: Number(body.halfLine) }));
      if (!report.meta.periods.ft) fail('Falta historial suficiente para sellar un pronostico.');
      markets = report.markets; predictions = report.meta.periods;
      if (body.teamTotalLine !== '' && body.teamTotalLine != null) {
        const line = Number(body.teamTotalLine), side = body.teamTotalSide || 'home', ft = predictions.ft;
        if (!['home', 'away'].includes(side) || !finite(line) || line <= 0 || line > 300 || line % 1 !== 0.5) fail('Total de equipo no valido.');
        const sd = Math.sqrt((ft.totalSd ** 2 + ft.marginSd ** 2) / 4);
        markets.push({ id: 'team-total-over', group: `team-total-${side}`, label: `${fixture[side]}: over ${line} puntos`, probability: round(100 * (1 - cdf((line - ft[side]) / sd))),
          calibrated: false, spec: { type: 'team-total', period: 'ft', side, line, direction: 'over' } });
      }
    }
    if (read().forecasts.some(row => row.league === league && row.fixture.id === fixture.id && row.target === target)) fail('Ya existe un pronostico sellado de este escenario. No se sobrescribe.');
    const evidence = structuredClone({ games: context, players: evidencePlayers, availability: reports }), inputHash = hash(evidence);
    const snapshot = { id: randomUUID(), league, target, fixture: structuredClone(fixture), createdAt, version: RESEARCH_VERSION, modelVersion: MODEL_VERSION,
      inputHash, lookback, markets, predictions, playerProjection, baseline: { probability: mean(context.filter(game => !game.neutralSite).map(game => Number(game.homePoints > game.awayPoints))), total: mean(context.map(game => game.homePoints + game.awayPoints)) },
      availabilityCount: reports.length, assumptions: ['Investigacion manual separada de octubre. Sin calibracion nueva.', 'Solo historial de la temporada elegida y su anterior para equipos.', 'Las bajas no ajustan automaticamente el modelo de equipos.', 'Total de equipo: aproximacion normal; covarianza entre total y margen no estimada.', 'Estadisticas individuales condicionadas a jugar. Disponibilidad introducida manualmente; fuente no certificada.'] };
    data().inputs[inputHash] = evidence; data().forecasts.push({ ...snapshot, integrity: hash(snapshot) }); await persist(); return data().forecasts.at(-1);
  }
  function evaluation(league) {
    const saved = read().forecasts.filter(row => row.league === league), valid = saved.filter(validForecast), all = games().filter(row => row.league === league && row.finished);
    const result = prospectiveEvaluation(valid.filter(row => row.target === 'match').map(row => ({ ...row, markets: row.markets.filter(market => market.spec.type !== 'player' && market.spec.type !== 'team-total') })), all);
    let completed = 0, pending = 0, rescheduled = 0;
    for (const snapshot of valid) {
      const game = all.find(row => row.id === snapshot.fixture.id || identity(row) === identity(snapshot.fixture));
      if (!game) pending++;
      else if (Math.abs(Date.parse(game.date) - Date.parse(snapshot.fixture.date)) > 6 * 3600000) rescheduled++;
      else completed++;
    }
    const custom = {}, minutes = [], individualErrors = {}, outcomeRows = [];
    for (const snapshot of valid) {
      const game = all.find(row => row.id === snapshot.fixture.id || identity(row) === identity(snapshot.fixture));
      if (!game || Math.abs(Date.parse(game.date) - Date.parse(snapshot.fixture.date)) > 6 * 3600000) continue;
      for (const market of snapshot.markets.filter(row => ['player', 'team-total'].includes(row.spec.type))) {
        let outcome = null;
        if (market.spec.type === 'team-total') { const value = game[`${market.spec.side}Points`]; if (finite(value)) outcome = Number(value > market.spec.line); }
        else {
          const record = players().find(row => row.league === league && row.matchId === game.id && row.team === market.spec.team && row.playerKey === market.spec.playerKey);
          if (record?.minutes > 0 && finite(record.values?.[market.spec.metric])) {
            const value = record.values[market.spec.metric]; outcome = Number(value > market.spec.line);
            if (snapshot.playerProjection) { minutes.push(Math.abs(record.minutes - snapshot.playerProjection.projectedMinutes)); (individualErrors[market.spec.metric] ||= []).push(Math.abs(value - snapshot.playerProjection.expected)); }
          }
        }
        (custom[market.group] ||= []).push({ outcome, probability: market.probability / 100 }); outcomeRows.push({ snapshotId: snapshot.id, marketId: market.id, outcome });
      }
    }
    return { ...result, frozen: valid.length, completed, pending, rescheduled, summary: { ...result.summary, ...Object.fromEntries(Object.entries(custom).map(([group, rows]) => [group, evaluate(rows)])) },
      invalid: saved.length - valid.length, minutesMae: { n: minutes.length, value: round(mean(minutes)) }, individualMae: Object.fromEntries(Object.entries(individualErrors).map(([metric, rows]) => [metric, { n: rows.length, value: round(mean(rows)) }])),
      outcomes: [...result.outcomes, ...outcomeRows], version: RESEARCH_VERSION, note: 'Muestra experimental, separada por competicion y escenario. DNP/faltantes no son cero. No implica rentabilidad ni eficacia demostrada.' };
  }
  async function backtest(body) {
    const { league, season } = selection(body), lookback = Number(body.lookback || 20);
    if (league === 'endesa') fail('Endesa: modelo independiente pendiente; no se extrapola el de Euroliga.');
    if (![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Ventana de historial no valida.');
    const result = predict(() => historicalEvaluation({ matches: games().filter(game => game.league === league), league, season, lookback }));
    const report = { ...result, generatedAt: clock(), researchVersion: RESEARCH_VERSION };
    (data().backtests ||= {})[`${league}:${season}:${lookback}`] = report; await persist(); return report;
  }
  function exportData() { return { exportedAt: clock(), version: RESEARCH_VERSION, competitions: RESEARCH_LEAGUES, archive: structuredClone({ ...read(), games: games(), players: players() }), evaluations: Object.keys(RESEARCH_LEAGUES).map(league => ({ league, ...evaluation(league) })) }; }
  const dailyData = () => ({ games: games(), players: players(), forecasts: read().forecasts, inputs: read().inputs, availability: availabilityReports() });
  const playerData = () => ({ games: games(), players: playerSource().filter(row => RESEARCH_LEAGUES[row.league]).map(row => ({ ...row, playerKey: entity(row) })) });
  const prematchData = () => ({ ...playerData(), availability: availabilityReports() });
  return { state, verify, sync, syncPlayers, syncBalanced, saveAvailability, seal, evaluation, backtest, exportData, dailyData, playerData, prematchData };
}
