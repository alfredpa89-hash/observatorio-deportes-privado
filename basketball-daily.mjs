import { createHash } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { gameKey, localDay, regularNba } from './basketball-data.mjs';
import { availableTime, LEAGUES, MODEL_VERSION } from './basketball-model.mjs';
import { basketballEvidence, basketballTeamEvidence } from './public/basketball-evidence.js';

export const DAILY_VERSION = 'basketball-daily-v1';
export const PLAYER_LINES = {
  nba: { points: 20.5, rebounds: 5.5, assists: 4.5, pra: 30.5, threes: 1.5 },
  euroleague: { points: 15.5, rebounds: 5.5, assists: 4.5, pra: 25.5, threes: 1.5 },
};
const NAMES = { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa' };
const METRICS = { points: 'puntos', rebounds: 'rebotes', assists: 'asistencias', pra: 'PRA', threes: 'triples' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = game => `${game.league}:${gameKey(game)}`;
const upcoming = (game, cutoff) => !game.finished && !game.preseason && !game.referenceOnly && game.timeKnown !== false &&
  Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) >= cutoff + 5 * 60000 &&
  (!game.status || ['NS', 'Scheduled', 'STATUS_SCHEDULED'].includes(game.status)) &&
  !/pre.?season|friendly/i.test(game.phase || '') && (game.league !== 'nba' || regularNba(game.date, game.season, game.phase || ''));
function valid(snapshot, inputs) {
  try {
    const { integrity, ...value } = snapshot;
    const input = inputs?.[snapshot.inputHash];
    return Boolean(input && integrity === hash(value) && snapshot.inputHash === hash(input) &&
      snapshot.modelVersion !== 'invalid' && (snapshot.modelVersion || snapshot.version) === MODEL_VERSION &&
      Number.isFinite(Date.parse(snapshot.createdAt)) && Date.parse(snapshot.createdAt) <= Date.parse(snapshot.fixture.date) - 5 * 60000);
  } catch { return false; }
}
function availability(records, snapshot, market, now) {
  const spec = market.spec;
  if (spec.type !== 'player') return { status: 'team', note: 'Lesiones no ajustadas automaticamente' };
  const saved = snapshot.playerProjection?.status || 'unknown';
  const report = records.filter(row => row.league === snapshot.league && (!row.season || row.season === snapshot.fixture.season) && row.team === spec.team &&
    (spec.playerKey ? row.playerKey === spec.playerKey : row.name === spec.player) &&
    (!row.fixtureId || row.fixtureId === snapshot.fixture.id) && Date.parse(row.recordedAt) <= now && Date.parse(row.publishedAt) <= now)
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).at(-1);
  const current = report && Date.parse(report.expiresAt) > now ? report.status : 'unknown';
  return { status: current, atSeal: saved, minutesLimit: current === 'minutes_limit' ? report.minutesLimit : null, note: current === 'out' ? 'Baja reportada: excluido de la lista' :
    current === 'questionable' ? 'En duda; condicionado a jugar' : current === 'minutes_limit' ? 'Limite de minutos reportado; revisar proyeccion sellada' :
      current === 'active' ? 'Disponible segun reporte manual; condicionado a jugar' : 'Disponibilidad no verificada; condicionado a jugar' };
}
function marketLabel(market, fixture) {
  const spec = market.spec, period = spec.period === 'q1' ? '1Q' : spec.period === 'ht' ? 'Descanso' : 'Final + prorroga';
  if (spec.type === 'player') return `${spec.player}: ${spec.direction === 'under' ? 'Under' : 'Over'} ${spec.line} ${METRICS[spec.metric] || spec.metric}`;
  if (spec.type === 'team-total') return `${fixture[spec.side]}: ${spec.direction === 'under' ? 'Under' : 'Over'} ${spec.line} puntos`;
  if (spec.type === 'winner') return `${spec.side === 'draw' ? 'Empate' : `Gana ${fixture[spec.side]}`} / ${period}`;
  return market.label;
}
function variants(market) {
  if (!['player', 'team-total'].includes(market.spec?.type) || !finite(market.probability) || market.spec.line % 1 !== 0.5) return [market];
  return [market, { ...market, id: `${market.id}:complement`, probability: Math.round((100 - market.probability) * 10000) / 10000,
    spec: { ...market.spec, direction: market.spec.direction === 'under' ? 'over' : 'under' } }];
}

export function createBasketballDaily({ getStore, research, now = () => new Date() }) {
  let preparing = false;
  function selection(body = {}) {
    const today = localDay(now()), day = body.day || today, league = body.league || 'all', kind = body.kind || 'all';
    const limit = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
      new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day || day < today || day > limit)
      throw new SportsError(400, 'Selecciona hoy o uno de los proximos siete dias, en Guayaquil. No se reconstruyen pronosticos pasados.');
    if (!['all', ...Object.keys(NAMES)].includes(league) || !['all', 'team', 'player'].includes(kind)) throw new SportsError(400, 'Filtro del dia no valido.');
    return { day, league, kind, today, lastDay: limit };
  }
  function sources(archive) {
    return [...(getStore().basketball?.trial?.snapshots || []).map(snapshot => ({ snapshot, inputs: getStore().basketball?.inputs, origin: 'trial' })),
      ...(archive.forecasts || []).map(snapshot => ({ snapshot, inputs: archive.inputs, origin: 'research' }))];
  }
  function state(body = {}) {
    const filters = selection(body), time = now().getTime(), archive = research.dailyData();
    const onDay = game => localDay(game.date) === filters.day && (filters.league === 'all' || game.league === filters.league);
    const dayGames = archive.games.filter(onDay), fixtures = dayGames.filter(game => upcoming(game, time));
    const byId = new Map(archive.games.map(game => [`${game.league}:${game.id}`, game])), byIdentity = new Map(archive.games.map(game => [identity(game), game]));
    const candidates = [], excluded = { invalid: 0, started: dayGames.filter(game => !upcoming(game, time)).length, unavailable: 0, missing: 0, rescheduled: 0 };
    const seenSnapshots = new Set();
    for (const { snapshot, inputs, origin } of sources(archive)) {
      if (!snapshot.fixture || !Number.isFinite(Date.parse(snapshot.fixture.date)) || !onDay({ ...snapshot.fixture, league: snapshot.league })) continue;
      if (!valid(snapshot, inputs) || Date.parse(snapshot.createdAt) > time) { excluded.invalid++; continue; }
      const game = byId.get(`${snapshot.league}:${snapshot.fixture.id}`) || byIdentity.get(identity({ ...snapshot.fixture, league: snapshot.league }));
      if (!game) { excluded.missing++; continue; }
      if (Date.parse(game.date) !== Date.parse(snapshot.fixture.date) || game.home !== snapshot.fixture.home || game.away !== snapshot.fixture.away) { excluded.rescheduled++; continue; }
      if (!upcoming(game, time) || snapshot.league === 'endesa') continue;
      seenSnapshots.add(identity(game));
      for (const market of (snapshot.markets || []).flatMap(variants)) {
        const spec = market.spec;
        if (!spec || !['winner', 'total', 'spread', 'team-total', 'player'].includes(spec.type) || !finite(market.probability) || market.probability < 0 || market.probability > 100) continue;
        const kind = spec.type === 'player' ? 'player' : 'team';
        if (filters.kind !== 'all' && filters.kind !== kind) continue;
        const evidence = inputs[snapshot.inputHash], projection = snapshot.predictions?.[spec.period || 'ft'];
        const n = market.n ?? snapshot.playerProjection?.n ?? (projection ? Math.min(projection.homeN, projection.awayN) : 0);
        if (!finite(n) || n < 5) { excluded.missing++; continue; }
        const current = availability(archive.availability || [], snapshot, market, time);
        const projectedMinutes = spec.type === 'player' ? snapshot.playerProjection?.projectedMinutes ?? market.projectedMinutes ?? null : null;
        if (current.status === 'out' || current.minutesLimit !== null && current.minutesLimit < projectedMinutes) { excluded.unavailable++; continue; }
        const fields = { ...spec, period: spec.period || 'ft' }; delete fields.playerKey;
        const key = `${identity(game)}:${JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)))}`;
        const sourceNames = [...new Set([...(evidence.games || []), ...(evidence.players || [])].map(row => row.source).filter(Boolean))];
        const supportContext = { cutoff: now().toISOString(), season: game.season, lookback: snapshot.lookback || 20 };
        const playerHistory = snapshot.playerProjection?.history || (evidence.players || []).filter(row => row.team === spec.team &&
          (spec.playerKey ? row.playerKey === spec.playerKey : row.name === spec.player) && row.minutes > 0 && availableTime(row) < Date.parse(snapshot.createdAt))
          .sort((a, b) => a.date.localeCompare(b.date)).slice(-(snapshot.lookback || 20));
        const support = kind === 'player' ? basketballEvidence({ ...supportContext, kind, availability: current.status, history: playerHistory,
          validHistory: playerHistory.filter(row => typeof row.values?.[spec.metric] === 'number' && Number.isFinite(row.values[spec.metric])) })
          : basketballTeamEvidence(Object.fromEntries(['home', 'away'].map(side => [side, (evidence.games || [])
            .filter(row => [row.home, row.away].includes(game[side]) && availableTime(row) < Date.parse(snapshot.createdAt))
            .sort((a, b) => a.date.localeCompare(b.date)).slice(-(snapshot.lookback || 20))])), spec, supportContext);
        candidates.push({ key, id: `${snapshot.id}:${market.id}`, snapshotId: snapshot.id, origin, league: snapshot.league, competition: NAMES[snapshot.league],
          fixture: { id: game.id, date: game.date, home: game.home, away: game.away, season: game.season }, kind,
          label: marketLabel(market, game), probability: market.probability, n, missing: support.missing, lookback: snapshot.lookback || 20,
          spec, calibrated: market.calibrated === true, calibrationN: market.calibrationN || 0, createdAt: snapshot.createdAt,
          modelVersion: MODEL_VERSION, sources: sourceNames, availability: current,
          projectedMinutes, evidence: support });
      }
    }
    // The trial takes precedence for duplicate scenarios; other research lines remain visible.
    const unique = new Map();
    for (const row of candidates.sort((a, b) => (a.origin === 'trial' ? -1 : 1) - (b.origin === 'trial' ? -1 : 1) || a.createdAt.localeCompare(b.createdAt))) if (!unique.has(row.key)) unique.set(row.key, row);
    const best = new Map();
    for (const row of unique.values()) {
      const spec = row.spec, family = spec.type === 'winner' ? 'winner' : spec.type;
      const key = `${identity({ ...row.fixture, league: row.league })}:${family}:${spec.period || 'ft'}:${spec.type === 'spread' ? Math.abs(spec.line) : spec.line ?? ''}:${spec.team || ''}:${spec.player || ''}:${spec.metric || ''}:${spec.type === 'team-total' ? spec.side : ''}`;
      if (!best.has(key) || row.probability > best.get(key).probability) best.set(key, row);
    }
    const rows = [...best.values()].sort((a, b) => b.probability - a.probability || b.n - a.n || a.fixture.date.localeCompare(b.fixture.date) || a.id.localeCompare(b.id));
    const coverage = Object.entries(NAMES).filter(([league]) => filters.league === 'all' || filters.league === league).map(([league, name]) => {
      const saved = archive.games.filter(game => game.league === league && game.finished), pending = fixtures.filter(game => game.league === league);
      return { league, name, fixtures: pending.length, history: saved.length, ranked: rows.filter(row => row.league === league).length,
        note: league === 'endesa' ? 'Modelo independiente pendiente; no se muestran probabilidades de Endesa.' : !pending.length ? 'Sin calendario admisible guardado para este dia. No equivale a que no haya partidos.' :
          rows.some(row => row.league === league) ? 'Estimaciones experimentales guardadas antes del inicio.' : 'Pendiente de preparar pronosticos o completar historial de la temporada y su anterior.' };
    });
    return { version: DAILY_VERSION, modelVersion: MODEL_VERSION, ...filters, generatedAt: now().toISOString(), timeZone: 'America/Guayaquil', rows, coverage, excluded,
      counts: { fixtures: fixtures.length, scenarios: rows.length, teams: rows.filter(row => row.kind === 'team').length, players: rows.filter(row => row.kind === 'player').length,
        withoutForecast: fixtures.filter(game => game.league !== 'endesa' && !seenSnapshots.has(identity(game))).length },
      lines: Object.fromEntries(Object.entries(PLAYER_LINES).map(([league, players]) => [league, { total: LEAGUES[league].total, quarter: LEAGUES[league].quarter, half: LEAGUES[league].half, spread: -3.5, players }])),
      notice: 'Mayor probabilidad estimada no significa apuesta segura ni rentable. Una opcion por familia y linea; selecciones del mismo partido no son independientes. Jugadores: condicionado a jugar. Preparacion privada separada de la prueba de octubre, sin consultas a la API.' };
  }
  async function prepare(body = {}) {
    if (preparing) throw new SportsError(409, 'La preparacion del dia ya esta en curso.');
    const filters = selection(body);
    preparing = true;
    try {
      const archive = research.dailyData(), fixtures = archive.games.filter(game => localDay(game.date) === filters.day &&
        (filters.league === 'all' || filters.league === game.league) && upcoming(game, now().getTime()));
      let sealed = 0, existing = 0, remaining = 0, attempted = 0; const issues = [];
      const saved = sources(archive).filter(({ snapshot, inputs }) => valid(snapshot, inputs));
      const already = (game, target) => saved.some(({ snapshot }) =>
        snapshot.league === game.league && (snapshot.fixture.id === game.id || identity({ ...snapshot.fixture, league: snapshot.league }) === identity(game)) &&
        (target === 'match' ? snapshot.target === 'match' || !snapshot.target : snapshot.target === target));
      for (const fixture of fixtures) {
        if (fixture.league === 'endesa') { issues.push({ fixtureId: fixture.id, reason: 'Endesa: modelo independiente pendiente.' }); continue; }
        const base = { league: fixture.league, season: fixture.season, fixtureId: fixture.id, lookback: 20 };
        const jobs = [];
        if (filters.kind !== 'player') {
          if (already(fixture, 'match')) existing++;
          else {
            const config = LEAGUES[fixture.league];
            jobs.push({ body: { ...base, totalLine: config.total, quarterLine: config.quarter, halfLine: config.half, spreadLine: -3.5 } });
          }
        }
        for (const team of filters.kind === 'team' ? [] : [fixture.home, fixture.away]) {
          const records = archive.players.filter(row => row.league === fixture.league && row.team === team && row.season === fixture.season &&
            !row.referenceOnly && availableTime(row) < now().getTime()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
          const latest = records.at(-1)?.date;
          const roster = [...new Map(records.filter(row => row.date === latest && row.minutes > 0).map(row => [row.playerKey, row])).values()];
          if (!roster.length) { issues.push({ fixtureId: fixture.id, reason: `${team}: sin jugadores con aparicion registrada en la temporada actual.` }); continue; }
          for (const player of roster) for (const [metric, line] of Object.entries(PLAYER_LINES[fixture.league])) {
            const target = `player:${team}:${player.playerKey}:${metric}:${line}`;
            if (already(fixture, target)) { existing++; continue; }
            jobs.push({ player: player.name, metric, body: { ...base, team, playerKey: player.playerKey, metric, line } });
          }
        }
        if (!jobs.length) continue;
        if (attempted >= 20) { remaining++; continue; }
        attempted++;
        for (const job of jobs) {
          try { await research.seal(job.body); sealed++; }
          catch (error) { issues.push({ fixtureId: fixture.id, ...(job.player ? { player: job.player, metric: job.metric } : {}), reason: error.message }); }
        }
      }
      return { sealed, existing, remaining, issues, state: state(filters) };
    } finally { preparing = false; }
  }
  return { state, prepare };
}
