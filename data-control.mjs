import { createHash } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { buildDataCoverage, dataIntegrity } from './data-coverage.mjs';
import { basketballFocus } from './basketball-focus.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const accessScope = job => { const { focusDay, ...params } = job.params; return hash({ kind: job.kind, params }); };
const TTL = 6 * 3600000, DAY = 86400000;
export const VISIT_TTL = 15 * 60000;
const initial = () => ({ schema: 1, automatic: { basketball: true, football: true, tennis: true }, budgets: { basketball: { dailyBudget: 7500 }, football: { dailyBudget: 100 } }, jobs: [], events: [] });
const sanitize = error => ({ code: String(error.code || (error.status === 403 ? 'access_restricted' : error.status === 429 ? 'quota_exceeded' : 'update_error')).slice(0, 60),
  message: error.status ? String(error.message).replace(/https?:\/\/\S+\?\S*/g, '[fuente protegida]').slice(0, 240) : 'No se pudo completar la actualizacion; se conserva el historial.' });

export function planDataJobs(store, { basketballConnected, footballConnected, footystatsConnected, paid = false }, now = new Date()) {
  const jobs = [], year = now.getUTCFullYear(), start = now.getUTCMonth() >= 8 ? year : year - 1, currentBasket = `${start}/${start + 1}`;
  const add = (sport, kind, label, params, priority, ttl = TTL) => jobs.push({ id: hash({ kind, params }), sport, kind, label, params, priority, ttl });
  if (basketballConnected) for (const league of ['nba', 'euroleague', 'endesa']) {
    const historical = [...new Set([...(store.basketballResearch?.games || []).filter(row => row.league === league).map(row => row.season), ...Object.keys(store.basketball?.datasets?.[league] || {})])].sort().reverse();
    for (const season of [...new Set([currentBasket, ...(paid ? [] : historical.slice(0, 2))])]) {
      const params = { league, season, ...(season === currentBasket ? { focusDay: basketballFocus(now).today } : {}) };
      add('basketball', 'basketball-calendar', `${{ nba: 'NBA', euroleague: 'Euroliga', endesa: 'Endesa' }[league]} ${season} / calendario y resultados`, params, season === currentBasket ? 120 : 35, season === currentBasket ? paid ? 30 * 60000 : TTL : 30 * DAY);
      add('basketball', 'basketball-details', `${league} ${season} / ${paid ? 'participantes de hoy y manana' : 'historial equilibrado'}`, params, season === currentBasket ? 100 : 45, TTL);
    }
  }
  if (basketballConnected) add('basketball', 'basketball-access', 'API-Basketball / verificar plan y cuota', {}, 160, 12 * 3600000);
  add('basketball', 'nba-free', 'NBA / calendario y resultados gratuitos', { sport: 'nba', season: currentBasket }, 110);
  for (const league of Object.values(store.leagues || {})) {
    const season = [...(league.seasons || [])].sort((a, b) => String(b).localeCompare(String(a)))[0];
    if (!season) continue;
    const old = Number(String(season).slice(0, 4)) < year;
    if (league.source === 'api-football' && footballConnected) {
      add('football', 'football-calendar', `${league.name} ${season} / resultados`, { id: league.id || Number(league.key.slice(4)), season }, 25, old ? 30 * DAY : TTL);
      if (league.coverageBySeason?.[season]?.fixtures?.statistics_players !== false) add('football', 'football-players', `${league.name} ${season} / jugadores`, { leagueKey: league.key, season, scope: 'league', lookback: 30, maxGames: 1 }, 20);
    }
    if (league.source === 'Football-Data.co.uk') {
      const division = league.key.split(':')[1], seasonCode = ['E0', 'E1', 'SP1', 'D1', 'I1', 'F1', 'N1', 'P1'].includes(division) && /^\d{4}\/\d{4}$/.test(String(season)) ? String(season).slice(2, 4) + String(season).slice(7, 9) : String(season);
      add('football', 'football-free', `${league.name} / fuente gratuita`, { division, season: seasonCode }, 30, old ? 30 * DAY : TTL);
    }
  }
  if (footystatsConnected) {
    add('football', 'footystats-access', 'FootyStats / catalogo de acceso diario', {}, 27, DAY);
    add('football', 'footystats', 'FootyStats / una liga autorizada por lote', { maxLeagues: 1 }, 15);
  }
  add('tennis', 'tennis-free', 'ATP / resultados y servicio disponibles', { season: String(year) }, 10);
  return jobs;
}

export function createDataControl({ getStore, persist, connections, policies, basketballData, handlers, backups, contextReports = () => [], trialAudit = () => null, basketballReadiness = () => null, now = () => new Date() }) {
  let running = null, visiting = null, pauseRequested = false;
  const clock = () => now().toISOString();
  const data = () => {
    const store = getStore();
    if (store.dataControl && store.dataControl.schema !== 1) throw new SportsError(409, 'Version del Centro de datos no compatible. No se sobrescribe; conserva el respaldo.');
    return (store.dataControl ||= initial());
  };
  function event(type, message, job = null) { data().events.push({ at: clock(), type, message, job }); data().events = data().events.slice(-100); }
  function plan() {
    const state = data(), source = connections(), descriptors = planDataJobs(getStore(), { ...source, paid: policies().basketball.paid }, now());
    state.accessBlocks ||= {};
    for (const job of state.jobs) if (job.status === 'blocked') state.accessBlocks[accessScope(job)] ||= { sport: job.sport, at: job.lastAt, issue: job.issue };
    const activeIds = new Set(descriptors.map(row => row.id));
    state.jobs = state.jobs.filter(row => activeIds.has(row.id));
    for (const job of descriptors) {
      const old = state.jobs.find(row => row.id === job.id);
      if (old) Object.assign(old, job);
      else state.jobs.push({ ...job, status: 'pending', attempts: 0, nextAt: clock(), lastAt: null, result: null });
      const blocked = state.accessBlocks[accessScope(job)];
      if (blocked) Object.assign(state.jobs.find(row => row.id === job.id), { status: 'blocked', issue: blocked.issue, lastAt: blocked.at });
    }
    return state.jobs;
  }
  async function settings(body) {
    const state = data();
    const automatic = { ...state.automatic }, budgets = structuredClone(state.budgets);
    if (body.automatic) for (const sport of ['basketball', 'football', 'tennis']) if (sport in body.automatic) {
      if (typeof body.automatic[sport] !== 'boolean') throw new SportsError(400, 'Actualizacion automatica no valida.');
      automatic[sport] = body.automatic[sport];
    }
    if (body.budgets) for (const name of ['basketball', 'football']) if (name in body.budgets) {
      const value = Number(body.budgets[name]);
      if (!Number.isInteger(value) || value < 20 || value > 7500) throw new SportsError(400, 'El presupuesto local debe estar entre 20 y 7500. No modifica tu suscripcion.');
      budgets[name] = { ...budgets[name], dailyBudget: value };
    }
    if (body.maximizeFree) for (const name of ['basketball', 'football']) if (name in body.maximizeFree) {
      if (typeof body.maximizeFree[name] !== 'boolean') throw new SportsError(400, 'El uso ampliado de cuota debe ser verdadero o falso.');
      budgets[name] = { ...budgets[name], maximizeFree: body.maximizeFree[name] };
    }
    state.automatic = automatic; state.budgets = budgets;
    for (const job of state.jobs) if (job.status === 'quota' && budgets[job.sport]?.maximizeFree && body.maximizeFree?.[job.sport] === true) {
      job.status = 'pending'; job.issue = null; job.nextAt = clock();
    }
    await persist(); return { automatic: state.automatic, budgets: state.budgets, policies: policies() };
  }
  async function cycle({ automatic = false, maxJobs = 4, jobIds = null, freshness = false } = {}) {
    if (running || visiting && !jobIds) return { running: true };
    if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 8) throw new SportsError(400, 'Lote de 1 a 8 tareas.');
    pauseRequested = false;
    running = Promise.resolve().then(async () => {
      plan();
      const jobs = data().jobs.filter(row => row.status !== 'blocked' && (!jobIds || jobIds.includes(row.id)) && Date.parse(row.nextAt) <= now().getTime() && (!automatic || data().automatic[row.sport]));
      const score = job => job.priority + (data().budgets[job.sport]?.maximizeFree ? Math.min(120, Math.max(0, (now().getTime() - Date.parse(job.lastAt || job.nextAt)) / 60000)) / 2 : 0);
      jobs.sort((a, b) => score(b) - score(a) || String(a.lastAt || '').localeCompare(String(b.lastAt || '')));
      // Basketball gets most slots; each background cycle also gives other enabled sports a turn.
      const selected = [...jobs.filter(row => row.sport === 'basketball').slice(0, Math.max(1, maxJobs - 2)),
        ...jobs.filter(row => row.sport === 'football').slice(0, 1), ...jobs.filter(row => row.sport === 'tennis').slice(0, 1)];
      for (const row of jobs) if (selected.length < maxJobs && !selected.includes(row)) selected.push(row);
      if (selected.length) await backups.ensure();
      let completed = 0; const processedIds = [];
      for (const job of selected.slice(0, maxJobs)) {
        if (pauseRequested) break;
        processedIds.push(job.id);
        job.status = 'running'; job.attempts++; await persist();
        try {
          const result = await handlers[job.kind]({ ...job.params, ...(freshness ? { freshness: true } : {}) });
          job.result = { imported: result?.imported ?? null, completed: result?.completed ?? result?.processed ?? null,
            pending: result?.pending ?? result?.remainingGames ?? null, warning: result?.warning || null };
          if (job.result.warning && !job.result.completed && !job.result.imported && /quota|limite|presupuesto|no permite|no.*access|free plan|subscription|conexi[oó]n|no se pudo|no se encontr|temporada no encontrada/i.test(job.result.warning)) {
            const status = /limite|quota|presupuesto/i.test(job.result.warning) ? 429 : /no permite|no.*access|free plan|subscription|temporada no encontrada/i.test(job.result.warning) ? 403 : 502;
            throw Object.assign(new SportsError(status, job.result.warning), { code: 'source_unavailable' });
          }
          job.status = job.result.pending > 0 ? 'partial' : 'complete'; job.issue = null; job.lastAt = clock();
          if (freshness) job.freshAt = clock();
          (data().updatedSports ||= {})[job.sport] = clock();
          const expanded = data().budgets[job.sport]?.maximizeFree || policies().basketball.paid && job.sport === 'basketball';
          job.nextAt = new Date(now().getTime() + (job.result.pending > 0 ? expanded ? 5 * 60000 : 3600000 : job.ttl)).toISOString();
          completed++; event('updated', `${job.label}: ${job.status === 'partial' ? 'lote parcial guardado' : 'tarea completada'}`, job.id);
        } catch (error) {
          job.issue = sanitize(error); job.status = [401, 403].includes(error.status) ? 'blocked' : error.status === 429 ? 'quota' : 'retry';
          const policy = policies()[job.kind.startsWith('footystats') ? 'footystats' : job.sport], reset = new Date(Date.parse(clock().slice(0, 10)) + DAY).toISOString();
          const retryAt = error.status === 429 ? policy?.quota?.cooldownUntil > clock() ? policy.quota.cooldownUntil : policy?.resetsAt || reset : null;
          const delay = [401, 403].includes(error.status) ? DAY : Math.min(TTL, 5 * 60000 * 2 ** Math.min(job.attempts - 1, 6));
          job.nextAt = retryAt || new Date(now().getTime() + delay).toISOString(); job.lastAt = clock();
          event('attention', `${job.label}: ${job.issue.message}`, job.id);
        }
        await persist();
      }
      data().lastCycle = clock(); await persist(); return { completed, processed: processedIds.length, processedIds, paused: pauseRequested };
    });
    try { return await running; } finally { running = null; }
  }
  function progress() {
    const control = data(), visit = control.visit || null;
    const source = connections(), missing = [];
    if (control.automatic.basketball && !source.basketballConnected) missing.push('API-Basketball sin conectar: Euroliga y Endesa actuales pendientes.');
    if (control.automatic.football && !source.footballConnected && Object.values(getStore().leagues || {}).some(row => row.source === 'api-football')) missing.push('API-Football sin conectar: individuales y ligas API conservan su historial.');
    const tasks = (visit?.jobIds || []).map(id => control.jobs.find(job => job.id === id)).filter(Boolean);
    return { requestedAt: visit?.requestedAt || null, finishedAt: visit?.finishedAt || null,
      phase: visiting ? 'updating' : visit?.phase === 'updating' ? 'interrupted' : visit?.phase || 'pending',
      total: tasks.length, processed: (visit?.processedIds || []).length,
      issues: [...tasks.filter(job => job.issue || job.result?.warning || job.result?.pending > 0).map(job => ({ task: job.label, message: job.issue?.message || job.result?.warning || `${job.result.pending} detalles pendientes`, pending: job.result?.pending || 0 })),
        ...(visit?.failure ? [{ task: 'Actualizacion', message: visit.failure.message, pending: 0 }] : [])],
      missing, disabledSports: Object.keys(control.automatic).filter(sport => !control.automatic[sport]), updatedSports: control.updatedSports || {}, lastCycle: control.lastCycle || null, cacheMinutes: VISIT_TTL / 60000,
      checks: tasks.map(job => ({ task: job.label, sport: job.sport, checkedAt: job.freshAt || null, status: job.status })),
      note: 'Comprobacion de las fuentes disponibles, no garantia de cobertura completa ni datos en tiempo real. La hora de descarga no es la fecha del ultimo resultado.' };
  }
  async function visit() {
    if (visiting) return progress();
    if (data().visit?.finishedAt && now().getTime() - Date.parse(data().visit.finishedAt) < VISIT_TTL) return progress();
    pauseRequested = false;
    const requestedAt = clock();
    data().visit = { requestedAt, phase: 'updating', finishedAt: null, jobIds: [], processedIds: [] };
    visiting = Promise.resolve().then(async () => {
      if (running) await running;
      const jobs = plan().filter(job => data().automatic[job.sport]);
      const currentStart = now().getUTCMonth() >= 8 ? now().getUTCFullYear() : now().getUTCFullYear() - 1;
      const currentSeason = `${currentStart}/${currentStart + 1}`;
      const primary = jobs.filter(job => job.kind !== 'basketball-details' && job.kind !== 'football-players' && (job.kind !== 'basketball-calendar' || job.params.season === currentSeason));
      const details = jobs.filter(job => job.kind === 'football-players' || job.kind === 'basketball-details' && job.params.season === currentSeason);
      const required = [...primary, ...details];
      const record = data().visit; record.jobIds = required.map(job => job.id);
      // Fresh checks bypass long archive caches, but never override access/quota cooldowns.
      for (const job of required) if (!job.issue && (!job.freshAt || now().getTime() - Date.parse(job.freshAt) >= VISIT_TTL)) job.nextAt = clock();
      record.processedIds = required.filter(job => job.freshAt && Date.parse(job.freshAt) >= now().getTime() - VISIT_TTL || job.issue && Date.parse(job.nextAt) > now().getTime()).map(job => job.id);
      await persist();
      for (const stage of [primary, details]) {
        let remaining = stage.map(job => job.id).filter(id => !record.processedIds.includes(id));
        while (remaining.length && !pauseRequested) {
          const result = await cycle({ automatic: true, maxJobs: 4, jobIds: remaining, freshness: true });
          if (!result.processedIds?.length) break;
          record.processedIds.push(...result.processedIds); await persist();
          remaining = remaining.filter(id => !record.processedIds.includes(id));
        }
      }
      record.finishedAt = clock(); record.phase = pauseRequested ? 'paused' : record.processedIds.length < record.jobIds.length ? 'partial' : 'checked'; await persist();
    }).catch(async error => {
      data().visit.phase = 'error'; data().visit.finishedAt = clock(); data().visit.failure = sanitize(error);
      event('attention', sanitize(error).message); await persist().catch(() => {});
    }).finally(() => { visiting = null; });
    return progress();
  }
  async function state() {
    const source = connections(), coverage = buildDataCoverage(getStore(), basketballData(), now()), control = data();
    for (const row of coverage) {
      const job = control.jobs.find(job => (row.sport === 'basketball' && job.kind === 'basketball-calendar' && job.params.league === row.key || row.sport === 'football' && job.kind === 'football-calendar' && `api:${job.params.id}` === row.key) && String(job.params.season) === String(row.season) && job.issue);
      if (job) { row.accessStatus = job.status; row.accessIssue = job.issue.message; }
    }
    return { schema: 1, running: Boolean(running || visiting), freshness: progress(), automatic: control.automatic, budgets: control.budgets, policies: policies(), connections: source,
      lastCycle: control.lastCycle || null, jobs: control.jobs, events: control.events.slice(-20).reverse(), coverage, integrity: dataIntegrity(getStore()),
      backups: await backups.list(), reports: contextReports(), trialAudit: trialAudit(), basketballReadiness: basketballReadiness(), priority: ['basketball', 'football', 'tennis'],
      notice: 'Cuotas y suscripciones independientes. Datos historicos no confirman plantilla actual. La actualizacion requiere equipo y servidor encendidos. No altera el protocolo congelado de octubre.' };
  }
  return { state, settings, cycle, visit, progress, running: () => Boolean(running || visiting), pause: async () => { pauseRequested = true; if (visiting) await visiting; else if (running) await running; },
    reconnect: async sport => {
      if (!visiting) data().visit = null;
      for (const [key, block] of Object.entries(data().accessBlocks || {})) if (block.sport === sport) delete data().accessBlocks[key];
      for (const job of data().jobs) if (job.sport === sport && (['blocked', 'quota', 'retry'].includes(job.status) || job.kind === 'basketball-access')) { job.nextAt = clock(); job.attempts = 0; job.status = 'pending'; job.issue = null; job.freshAt = null; }
      await persist();
    } };
}
