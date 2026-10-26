import { canonicalTeam } from './football-history.mjs';
import { SportsError } from './sports.mjs';

const HOUR = 3600000, DAY = 24 * HOUR;
const documentation = 'https://www.api-football.com/documentation_v3#tag/Injuries';
const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
const count = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const positiveId = value => /^\d+$/.test(String(value)) && Number(value) > 0;
const sameTeam = (a, b, country) => canonicalTeam(a, country).toLocaleLowerCase('es') === canonicalTeam(b, country).toLocaleLowerCase('es');

// A card in a past appearance is evidence of that card, never of a current ban.
export function footballDiscipline(store, scope) {
  const refs = scope.sourceScopes || [{ key: scope.key, season: scope.season }];
  const groups = new Map(), seen = new Set();
  const logs = (store.playerLogs || []).filter(row => row.sport === 'football' && clean(row.name) && clean(row.team) && refs.some(ref => row.leagueKey === ref.key && String(row.season) === String(ref.season)) &&
    Date.parse(row.date) < Date.parse(scope.cutoff) && Date.parse(row.availableAfter || row.date) < Date.parse(scope.cutoff) &&
    scope.entities.some(entity => entity.kind === 'player' ? entity.playerKey === row.playerKey : sameTeam(entity.team, row.team, scope.country)))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const row of logs) {
    const player = row.playerKey || (row.playerId ? `api:${row.playerId}` : `name:${clean(row.name)}`);
    const identity = `${player}:${canonicalTeam(row.team, scope.country)}`, event = `${identity}:${row.date}:${row.opponent}`;
    if (seen.has(event)) continue;
    seen.add(event);
    if (!groups.has(identity)) groups.set(identity, []);
    if (groups.get(identity).length < scope.lookback) groups.get(identity).push(row);
  }
  return [...groups.values()].flatMap(rows => {
    const yellow = rows.filter(row => count(row.values?.yellow)), red = rows.filter(row => count(row.values?.red));
    const yellows = yellow.reduce((sum, row) => sum + row.values.yellow, 0), reds = red.reduce((sum, row) => sum + row.values.red, 0);
    if (!yellows && !reds) return [];
    return [{ playerKey: rows[0].playerKey || null, name: rows[0].name, team: rows[0].team, appearances: rows.length,
      yellow: { total: yellows, games: yellow.filter(row => row.values.yellow > 0).length, n: yellow.length },
      red: { total: reds, games: red.filter(row => row.values.red > 0).length, n: red.length },
      latest: rows[0].date, oldest: rows.at(-1).date, source: [...new Set(rows.map(row => row.source).filter(Boolean))].join(', ') || 'Historial guardado',
      historical: true, stale: Date.parse(scope.cutoff) - Date.parse(rows[0].date) > 30 * DAY }];
  }).sort((a, b) => b.red.total - a.red.total || b.yellow.total - a.yellow.total || a.name.localeCompare(b.name, 'es')).slice(0, 20);
}

export function parseFootballAbsences(rows, target, checkedAt) {
  const found = new Map();
  for (const row of rows) {
    if (String(row?.fixture?.id) !== target.id || String(row?.league?.id) !== target.leagueId || String(row?.league?.season) !== target.season ||
      !positiveId(row?.player?.id) || !clean(row.player.name)) continue;
    const side = ['home', 'away'].find(side => positiveId(target[`${side}Id`]) && String(target[`${side}Id`]) === String(row.team?.id));
    if (!side) continue;
    if (!['Missing Fixture', 'Questionable'].includes(row.player.type)) continue;
    const reason = clean(row.player.reason), suspended = /suspend|suspensi[oó]n|red card|yellow cards/i.test(reason);
    const status = row.player.type === 'Questionable' ? 'questionable' : suspended ? 'suspended' : 'out';
    const playerKey = `api:${row.player.id}`;
    found.set(playerKey, { playerKey, name: clean(row.player.name), team: target[side], teamId: row.team.id,
      status, reason: reason || 'Motivo no especificado por el proveedor', providerType: row.player.type,
      fixtureId: target.id, checkedAt, publishedAt: null, source: 'API-Football / injuries', sourceUrl: documentation });
  }
  return [...found.values()];
}

export function createFootballContext({ getStore, persist, request, connected, getConnection = () => ({}), now = () => new Date() }) {
  let busy = false;
  const saved = () => getStore().footballContext || { fixtures: {}, pauseUntil: null };
  function targets(scope) {
    if (scope.historicalCutoff) return [];
    const result = new Map(), time = now().getTime();
    for (const ref of scope.sourceScopes || []) {
      const league = getStore().leagues?.[ref.key];
      if (!/^api:\d+$/.test(ref.key) || !league) continue;
      for (const fixture of league.fixturesBySeason?.[ref.season] || []) {
        if (!positiveId(fixture.id) || !['NS', 'TBD', 'PST'].includes(fixture.status) || !Number.isFinite(Date.parse(fixture.date)) ||
          Date.parse(fixture.date) <= time || Date.parse(fixture.date) > time + 14 * DAY) continue;
        if (!scope.entities.every(entity => [fixture.home, fixture.away].some(team => sameTeam(team, entity.team, scope.country)))) continue;
        if (scope.fixtureId && String(scope.fixtureId) !== String(fixture.id)) continue;
        const target = { id: String(fixture.id), leagueKey: ref.key, leagueId: ref.key.slice(4), season: String(ref.season), date: fixture.date,
          home: fixture.home, away: fixture.away, homeId: fixture.homeId, awayId: fixture.awayId,
          coverage: league.coverageBySeason?.[ref.season]?.injuries ?? null, status: fixture.status };
        result.set(`${target.leagueKey}:${target.season}:${target.id}`, target);
      }
    }
    return [...result.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  }
  const identity = target => `${target.leagueKey}:${target.season}:${target.id}`;
  function summary(scope, fixtureId) {
    if (scope.sport !== 'football') return null;
    const fixtures = targets(scope), target = fixtureId ? fixtures.find(row => row.id === String(fixtureId)) : fixtures[0];
    const record = target && saved().fixtures[identity(target)], clock = now().toISOString();
    const visible = record?.checkedAt <= scope.cutoff ? record : null;
    const allowed = getConnection().allowedSeasons, seasonBlocked = target && allowed && !allowed.includes(Number(target.season));
    const pauseUntil = saved().pauseUntil > clock ? saved().pauseUntil : null;
    const reason = scope.historicalCutoff ? 'Corte historico: no se consultan bajas actuales.' : !target ? 'No hay un proximo encuentro API-Football guardado para esta seleccion (proximos 14 dias).' :
      !connected() ? 'Falta conectar API-Football en el servidor. Los historiales y reportes guardados siguen disponibles.' : seasonBlocked ? 'El plan conectado no permite la temporada de este partido; las bajas actuales siguen pendientes.' :
        target.status !== 'NS' ? 'Partido aplazado o con horario por confirmar; no se consulta disponibilidad todavia.' : target.coverage === false ? 'El proveedor no declara cobertura de bajas para esta liga y temporada.' :
          pauseUntil ? `Consultas en pausa hasta ${pauseUntil}. Se conserva el ultimo reporte.` : null;
    return { fixtures, selectedFixtureId: target?.id || null, canRefresh: Boolean(target && !reason), blockedReason: reason,
      checkedAt: visible?.checkedAt || null, attemptedAt: record?.attemptedAt <= scope.cutoff ? record.attemptedAt : null,
      stale: Boolean(visible && visible.validUntil <= clock), nextRefreshAt: visible?.validUntil > clock ? visible.validUntil : null,
      warning: record?.attemptedAt <= scope.cutoff ? record.warning || null : null,
      absences: (visible?.rows || []).filter(row => scope.entities.some(entity => entity.kind === 'player' ? entity.playerKey === row.playerKey : sameTeam(entity.team, row.team, scope.country))),
      discipline: footballDiscipline(getStore(), scope), sourceUrl: documentation,
      notice: 'Un reporte vacio no confirma que todos esten disponibles. Las tarjetas son de participaciones guardadas, no el saldo disciplinario oficial ni la plantilla actual. El contexto no modifica las probabilidades.' };
  }
  async function refresh(scope, fixtureId) {
    if (scope.sport !== 'football') throw new SportsError(400, 'Esta consulta es solo de futbol.');
    const state = summary(scope, fixtureId);
    if (fixtureId && !state.selectedFixtureId) throw new SportsError(400, 'Selecciona un encuentro futuro guardado de estos equipos.');
    if (!state.canRefresh) throw new SportsError(409, state.blockedReason);
    if (busy) throw new SportsError(409, 'Ya hay una consulta de disponibilidad en curso.');
    if (state.nextRefreshAt) return { ...state, cached: true };
    const target = state.fixtures.find(row => row.id === state.selectedFixtureId), key = identity(target), stamp = now().toISOString();
    const archive = (getStore().footballContext ||= { fixtures: {}, pauseUntil: null });
    const prior = archive.fixtures[key];
    busy = true;
    try {
      if (target.coverage === null) {
        const data = await request('/leagues', { id: target.leagueId, season: target.season }, DAY);
        const season = data.find(row => String(row.league?.id) === target.leagueId)?.seasons?.find(row => String(row.year) === target.season);
        if (season?.coverage) {
          const league = getStore().leagues[target.leagueKey]; league.coverageBySeason ||= {}; league.coverageBySeason[target.season] = season.coverage;
        }
        if (season?.coverage?.injuries !== true) throw new SportsError(409, 'Cobertura de bajas no confirmada por el proveedor para esta temporada.');
      }
      const data = await request('/injuries', { fixture: target.id, season: target.season }, 4 * HOUR);
      if (!Array.isArray(data)) throw new SportsError(502, 'El proveedor devolvio un reporte no utilizable.');
      const checkedAt = now().toISOString();
      archive.fixtures[key] = { attemptedAt: stamp, checkedAt, validUntil: new Date(now().getTime() + 4 * HOUR).toISOString(),
        rows: parseFootballAbsences(data, target, checkedAt), warning: null };
      archive.pauseUntil = null;
    } catch (error) {
      // Do not store provider error text or URLs, which might contain account details.
      const code = error.code || (error.status === 401 ? 'credentials' : error.status === 403 ? 'plan' : error.status === 429 ? 'quota' : 'provider');
      const planBlocked = /season|plan|credentials|invalid_key/.test(code);
      archive.pauseUntil = new Date(now().getTime() + (planBlocked ? DAY : error.status === 429 ? HOUR : 15 * 60000)).toISOString();
      archive.fixtures[key] = { ...prior, attemptedAt: stamp, warning: planBlocked ? 'Acceso o temporada no disponible con el plan conectado. No se han actualizado las bajas.' :
        error.status === 429 ? 'Cuota o pausa del proveedor: se conserva el reporte anterior, si existe.' : 'No se pudo actualizar la disponibilidad. Se conserva el ultimo reporte con su fecha.' };
    } finally {
      archive.fixtures = Object.fromEntries(Object.entries(archive.fixtures).sort((a, b) => b[1].attemptedAt.localeCompare(a[1].attemptedAt)).slice(0, 120));
      busy = false; await persist();
    }
    return summary({ ...scope, cutoff: now().toISOString() }, target.id);
  }
  return { summary, refresh };
}
