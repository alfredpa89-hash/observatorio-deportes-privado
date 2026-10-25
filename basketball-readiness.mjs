import { randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { basketballFocus } from './basketball-focus.mjs';
import { basketballSeason } from './basketball-data.mjs';
import { eligibleNba } from './basketball-research.mjs';

const NAMES = { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa' };
const OFFICIAL = { nba: ['nba.com'], euroleague: ['euroleaguebasketball.net', 'euroleague.net'], endesa: ['acb.com'] };
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const periods = ['q1', 'q2', 'ht', 'q3', 'q4'];
export const CHECK_FIELDS = {
  homePoints: 'Puntos local', awayPoints: 'Puntos visitante',
  ...Object.fromEntries(['home', 'away'].flatMap(side => periods.map(period => [`${side}:${period}`, `${side === 'home' ? 'Local' : 'Visitante'} / ${period.toUpperCase()}`]))),
  ...Object.fromEntries(['minutes', 'points', 'rebounds', 'assists', 'pra', 'threes', 'q1', 'q2', 'q3', 'q4'].map(field => [`player:${field}`, {
    minutes: 'Minutos', points: 'Puntos', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA', threes: 'Triples',
    q1: 'Puntos 1Q', q2: 'Puntos 2Q', q3: 'Puntos 3Q', q4: 'Puntos 4Q' }[field]])),
};
const unique = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
const playerId = row => row.playerKey || (row.apiPlayerId ? `API-Basketball:${row.apiPlayerId}` : `${row.source}:${row.playerId || row.name}`);
const sameGame = (log, game) => log.league === game.league && log.season === game.season &&
  (String(log.matchId) === String(game.id) || log.apiMatchId != null && game.apiId != null && String(log.apiMatchId) === String(game.apiId));
function periodValue(game, side, field) {
  const direct = game.periods?.[side]?.[field] ?? game.stats?.[side]?.[field === 'q1' ? 'firstQuarterPoints' : field === 'ht' ? 'halfTimePoints' : field];
  if (finite(direct)) return direct;
  if (field === 'ht') {
    const a = periodValue(game, side, 'q1'), b = periodValue(game, side, 'q2');
    if (finite(a) && finite(b)) return a + b;
  }
  return null;
}
function observed(game, logs, field, key) {
  if (field.startsWith('player:')) {
    const row = logs.find(log => sameGame(log, game) && playerId(log) === key), metric = field.slice(7);
    return row ? metric === 'minutes' ? row.minutes : periods.includes(metric) ? row.periods?.[metric]?.points : row.values?.[metric] : null;
  }
  const [side, period] = field.split(':');
  return period ? periodValue(game, side, period) : game[field];
}
const fieldCounts = (rows, definitions) => Object.entries(definitions).map(([id, [label, test]]) => {
  const n = rows.filter(test).length;
  return { id, label, n, total: rows.length, missing: rows.length - n };
});

export function createBasketballReadiness({ getStore, persist, read, policy, trial = () => ({}), researchEvaluation = () => ({}), now = () => new Date() }) {
  function source() {
    const data = read(), clock = now().getTime();
    return { ...data, games: unique(data.games.filter(game => !game.preseason && !game.referenceOnly && !/pre.?season|friendly|all.?star/i.test(game.phase || '') && Number.isFinite(Date.parse(game.date)) &&
      (game.league !== 'nba' || eligibleNba(game.date, game.season, game.phase || 'Regular Season'))),
      game => `${game.league}:${game.season}:${game.id}`),
    players: unique(data.players.filter(row => Date.parse(row.date) < clock && (!row.fetchedAt || Date.parse(row.fetchedAt) <= clock)),
      row => `${row.league}:${row.season}:${row.matchId}:${row.team}:${playerId(row)}`) };
  }
  function checks(data) {
    return (getStore().basketballChecks || []).map(check => {
      const game = data.games.find(game => game.league === check.league && game.season === check.season && game.id === check.matchId);
      const value = game ? observed(game, data.players, check.field, check.playerKey) : null;
      return { ...check, observed: finite(value) ? value : null,
        status: !finite(value) ? 'missing' : Math.abs(value - check.expected) <= (check.field === 'player:minutes' ? .02 : 0) ? 'match' : 'mismatch' };
    });
  }
  function state() {
    const data = source(), clock = now(), year = Number(basketballFocus(clock).today.slice(0, 4)), month = Number(basketballFocus(clock).today.slice(5, 7));
    const start = month >= 9 ? year : year - 1, season = `${start}/${start + 1}`, focus = basketballFocus(clock), access = policy();
    const comparisons = checks(data), trialState = trial();
    const leagues = Object.entries(NAMES).map(([league, name]) => {
      const finished = data.games.filter(game => game.league === league && game.finished && Date.parse(game.date) < clock.getTime())
        .sort((a, b) => b.date.localeCompare(a.date));
      const current = finished.filter(game => game.season === season), sample = current.slice(0, 20);
      const logs = data.players.filter(log => log.minutes !== 0 && log.participation !== 'did_not_play' && sample.some(game => sameGame(log, game)));
      const fields = fieldCounts(sample, {
        points: ['Puntos y resultado', game => finite(game.homePoints) && finite(game.awayPoints)],
        quarters: ['Cuartos de equipos', game => ['home', 'away'].every(side => ['q1', 'q2', 'q3', 'q4'].every(q => finite(periodValue(game, side, q))))],
        half: ['Descanso de equipos', game => ['home', 'away'].every(side => finite(periodValue(game, side, 'ht')))],
        players: ['Partidos con individuales de ambos equipos', game => [game.home, game.away].every(team => logs.some(log => sameGame(log, game) && log.team === team && log.minutes > 0))],
      });
      const playerFields = fieldCounts(logs, Object.fromEntries(['minutes', 'points', 'rebounds', 'assists', 'pra', 'threes', 'quarters'].map(field => [field, [
        { minutes: 'Minutos', points: 'Puntos', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA', threes: 'Triples', quarters: 'Puntos individuales en los 4 cuartos' }[field],
        log => field === 'minutes' ? finite(log.minutes) : field === 'quarters' ? ['q1', 'q2', 'q3', 'q4'].every(q => finite(log.periods?.[q]?.points)) : finite(log.values?.[field]),
      ]])));
      const fixtures = data.games.filter(game => game.league === league && game.season === season && !game.finished && game.timeKnown !== false &&
        Date.parse(game.date) >= clock.getTime() + 5 * 60000 && game.date >= focus.from && game.date < focus.until &&
        (!game.status || ['NS', 'Scheduled', 'STATUS_SCHEDULED'].includes(game.status))).sort((a, b) => a.date.localeCompare(b.date));
      const latestIdentities = new Map();
      for (const log of data.players.filter(row => row.league === league && row.season === season && row.minutes > 0).sort((a, b) => a.date.localeCompare(b.date))) latestIdentities.set(playerId(log), log);
      const participants = new Set(fixtures.flatMap(game => [game.home, game.away]));
      const relevant = [...latestIdentities.values()].filter(log => participants.has(log.team));
      const availability = relevant.map(log => {
        const latest = (data.availability || []).filter(row => row.league === league && (!row.season || row.season === season) && row.team === log.team && row.playerKey === playerId(log) &&
          Date.parse(row.recordedAt) <= clock.getTime() && Date.parse(row.publishedAt) <= clock.getTime() &&
          (!row.fixtureId || fixtures.some(game => game.id === row.fixtureId && [game.home, game.away].includes(log.team))))
          .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
        const applicable = fixtures.filter(game => [game.home, game.away].includes(log.team) && (!latest?.fixtureId || game.id === latest.fixtureId));
        const usable = latest && Date.parse(latest.expiresAt) > clock.getTime() && applicable.length && applicable.every(game => Date.parse(latest.expiresAt) > Date.parse(game.date));
        return { playerKey: playerId(log), name: log.name, team: log.team, status: usable ? latest.status : 'unknown',
          expiresAt: latest?.expiresAt || null, sourceUrl: latest?.sourceUrl || null, seasonEvidence: log.date };
      });
      const coverage = getStore().basketball?.catalog?.find(row => league === 'nba' ? row.name === 'NBA' : league === 'euroleague' ? /^euroleague$/i.test(row.name) : row.name === 'ACB' && row.country?.name === 'Spain')
        ?.seasons?.find(row => basketballSeason(row.season) === season)?.coverage || null;
      const research = researchEvaluation(league), prospective = trialState.perLeague?.[league] || null;
      const historical = Object.values(getStore().basketballResearch?.backtests || {}).filter(row => row.league === league)
        .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] || getStore().basketball?.evaluations?.[league] || null;
      const official = comparisons.filter(row => row.league === league && row.season === season && sample.some(game => game.id === row.matchId));
      const contrastedGames = new Set(official.filter(row => row.status === 'match').map(row => row.matchId)).size;
      const blockers = [];
      if (!access.paid) blockers.push('Temporada actual y plan Pro pendientes de verificacion en esta sesion.');
      if (sample.length < 20) blockers.push(`Muestra actual incompleta: ${sample.length}/20 partidos, sin sustituirla por otras temporadas.`);
      if (fields.some(row => row.n < row.total) || !logs.length || playerFields.some(row => row.id !== 'quarters' && row.n < row.total)) blockers.push('Faltan campos o individuales de la muestra actual.');
      if (!playerFields.find(row => row.id === 'quarters')?.n) blockers.push('Cuartos individuales sin evidencia; no se reparten los totales del partido.');
      blockers.push(`Contraste manual: ${contrastedGames}/20 partidos con al menos un campo coincidente. No certifica todos los campos ni el proveedor.`);
      if (!fixtures.length) blockers.push('Sin calendario futuro admisible guardado para hoy y manana.');
      if (!availability.length || availability.some(row => row.status === 'unknown')) blockers.push('Disponibilidad/plantilla no verificadas para todos los jugadores; historiales no equivalen a una plantilla.');
      if (league === 'endesa') blockers.push('Modelo Endesa independiente pendiente; solo analisis descriptivo.');
      if (!(prospective?.completed > 0 || research.completed > 0)) blockers.push('Sin partidos evaluados prospectivamente; no hay eficacia demostrada.');
      const evidenceGames = sample.length ? sample : finished.slice(0, 20);
      return { league, name, season, currentMatches: current.length, sampleTarget: 20, sampleSize: sample.length, latestMatch: current[0]?.date || null,
        latestHistorical: finished.find(game => game.season !== season)?.date || null, declaredCoverage: coverage, fields, playerFields,
        fixtures: fixtures.map(game => ({ id: game.id, date: game.date, home: game.home, away: game.away })), availability,
        knownCurrentPlayers: latestIdentities.size, rosterConfirmed: false, blockers, status: 'pending',
        evaluation: { trial: prospective, research, historical },
        sampleGames: evidenceGames.map(game => ({ id: game.id, season: game.season, date: game.date, home: game.home, away: game.away,
          players: data.players.filter(log => sameGame(log, game)).map(log => ({ key: playerId(log), name: log.name, team: log.team })) })) };
    });
    return { generatedAt: clock.toISOString(), season, focus, paid: access.paid, leagues, checks: comparisons.slice(-200).reverse(),
      fields: CHECK_FIELDS, note: 'Comprobacion de datos, no certificacion de precision. Una fuente oficial registrada manualmente no se verifica por abrir su enlace. Ninguna compra garantiza lesiones ni cuartos individuales. La prueba congelada no se modifica.' };
  }
  async function saveCheck(body) {
    const data = source(), game = data.games.find(game => game.league === body.league && game.season === body.season && game.id === body.matchId && game.finished && Date.parse(game.date) < now().getTime());
    if (!game || !Object.hasOwn(CHECK_FIELDS, body.field)) throw new SportsError(400, 'Selecciona partido finalizado y campo de la muestra guardada.');
    if (body.field.startsWith('player:') && !data.players.some(log => sameGame(log, game) && playerId(log) === body.playerKey)) throw new SportsError(400, 'Selecciona la identidad del jugador en este partido.');
    if (body.expected === '' || body.expected == null || !finite(Number(body.expected))) throw new SportsError(400, 'Indica el valor oficial; cero es un dato valido.');
    let url; try { url = new URL(body.sourceUrl); } catch { throw new SportsError(400, 'Indica el enlace oficial HTTPS.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || !OFFICIAL[game.league]?.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new SportsError(400, 'Usa el Game Center oficial de esta competicion, sin credenciales ni parametros.');
    if (typeof body.publishedAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(body.publishedAt) || !Number.isFinite(Date.parse(body.publishedAt)) || Date.parse(body.publishedAt) > now().getTime() || Date.parse(body.publishedAt) < Date.parse(game.date)) throw new SportsError(400, 'La fecha de la referencia debe ser posterior al inicio y no futura, con zona horaria.');
    const value = observed(game, data.players, body.field, body.playerKey);
    const check = { id: randomUUID(), league: game.league, season: game.season, matchId: game.id, field: body.field,
      playerKey: body.field.startsWith('player:') ? body.playerKey : null, expected: Number(body.expected), observedAtSave: finite(value) ? value : null,
      sourceUrl: url.href, publishedAt: new Date(body.publishedAt).toISOString(), recordedAt: now().toISOString(), verification: 'manual' };
    (getStore().basketballChecks ||= []).push(check); await persist();
    return checks(data).find(row => row.id === check.id);
  }
  return { state, saveCheck };
}
