import { createHash, randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { buildPrematchBrief } from './prematch-context.mjs';
import { contextSources, contextNewsDomains } from './context-sources.mjs';

const HOUR = 3600000, DAY = 24 * HOUR, FAILURE_PAUSE = 15 * 60000;
const diagnosticLabels = {
  ok: 'Fuente respondio; titulares encontrados', empty: 'Fuente respondio; sin titulares admisibles',
  rate_limited: 'Limite de solicitudes del proveedor', timeout: 'La fuente no respondio dentro de 30 segundos',
  dns_error: 'No se pudo resolver la direccion de la fuente', network_error: 'No se pudo completar la conexion con la fuente',
  provider_unavailable: 'Servicio de noticias no disponible', rejected: 'La fuente rechazo la consulta',
  invalid_response: 'La fuente devolvio una respuesta no utilizable', unknown_error: 'Intento anterior sin diagnostico detallado',
};
const retryTime = entry => entry?.nextAttemptAt || (entry?.attemptedAt ? new Date(Date.parse(entry.attemptedAt) + 6 * HOUR).toISOString() : null);
function newsFailure(error, httpStatus, durationMs) {
  const code = error?.code || error?.cause?.code;
  const outcome = httpStatus === 429 ? 'rate_limited' : httpStatus >= 500 ? 'provider_unavailable' : httpStatus >= 400 ? 'rejected' :
    ['oversized', 'bad_schema', 'bad_json'].includes(code) ? 'invalid_response' :
      error?.name === 'TimeoutError' || error?.name === 'AbortError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code) ? 'timeout' :
        ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'dns_error' : 'network_error';
  return { code: outcome, label: diagnosticLabels[outcome], httpStatus: httpStatus || null, durationMs };
}
const fail = message => { throw new SportsError(400, message); };
const categories = { injury: 'Lesion o disponibilidad', suspension: 'Sancion o tarjetas', medical: 'Incidencia medica', workload: 'Minutos o carga', competition: 'Situacion del torneo', other: 'Otra informacion' };
const domains = { football: ['uefa.com', 'conmebol.com', 'premierleague.com', 'fifa.com', 'laliga.com', 'bundesliga.com', 'legaseriea.it', 'ligue1.com'],
  basketball: ['nba.com', 'euroleaguebasketball.net', 'acb.com'], tennis: ['atptour.com', 'wtatennis.com', 'itftennis.com', 'wimbledon.com', 'ausopen.com', 'rolandgarros.com', 'usopen.org'] };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
export function publicContextUrl(value) {
  let url; try { url = new URL(value); } catch { fail('Incluye un enlace HTTPS publico.'); }
  if (url.href.length > 2000 || url.protocol !== 'https:' || url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname) || /(?:localhost|\.local|\.internal)$/i.test(url.hostname) ||
    [...url.searchParams.keys()].some(key => /key|token|secret|password|authorization|signature/i.test(key)) || /(?:key|token|secret|password|authorization)=/i.test(url.hash)) fail('Usa una fuente HTTPS publica sin claves, tokens ni credenciales.');
  return url;
}
const text = (value, size) => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, size);
const seenDate = value => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value));
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().replace('.000', '') === date ? date : null;
};
function latest(rows, key) {
  const map = new Map();
  for (const row of [...rows].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt))) map.set(key(row), row);
  return [...map.values()];
}
export function createResearchContext({ getStore, persist, read, now = () => new Date(), request = (...args) => fetch(...args) }) {
  let busy = false;
  const saved = () => getStore().researchContext || { notes: [], news: {}, quota: { day: '', count: 0 }, lastRequestAt: null, cooldownUntil: null };
  const writable = () => (getStore().researchContext ||= saved());
  const stamp = () => now().toISOString();
  const cacheKey = scope => hash({ sport: scope.sport, key: scope.key, season: scope.season, ids: scope.entities.map(row => row.id).sort() });
  function decorate(scope) {
    const clock = stamp(), set = saved().news[cacheKey(scope)];
    const dailyLimit = saved().quota.day === clock.slice(0, 10) && saved().quota.count >= 60;
    const pause = saved().cooldownUntil > clock, nextAttemptAt = [retryTime(set), saved().cooldownUntil,
      dailyLimit && new Date(Date.parse(clock.slice(0, 10)) + DAY).toISOString(),
      saved().lastRequestAt && new Date(Date.parse(saved().lastRequestAt) + 10000).toISOString()].filter(value => value > clock).sort().at(-1) || null;
    const diagnostic = set?.diagnostic || (set?.attemptedAt ? { code: set.warning ? 'unknown_error' : set.items?.length ? 'ok' : 'empty',
      label: diagnosticLabels[set.warning ? 'unknown_error' : set.items?.length ? 'ok' : 'empty'], httpStatus: null, durationMs: null } : null);
    const notes = latest(saved().notes.filter(row => row.sport === scope.sport && row.key === scope.key && row.season === scope.season &&
      scope.entities.some(entity => row.entityId === entity.id) && (!row.fixtureId || row.fixtureId === scope.fixtureId) && row.publishedAt <= scope.cutoff && row.recordedAt <= scope.cutoff), row => `${row.entityId}:${row.category}:${(row.subject || '').toLocaleLowerCase('es')}`)
      .map(row => {
        const reviews = (row.reviews || []).filter(item => item.recordedAt <= scope.cutoff), review = reviews.at(-1) || null;
        return { ...row, reviews, review, withdrawn: review?.action === 'withdrawn', expired: !Number.isFinite(Date.parse(row.expiresAt)) || row.expiresAt <= scope.cutoff, categoryLabel: categories[row.category] };
      });
    const availability = latest(scope.availability, row => `${row.playerKey || row.team}:${row.fixtureId || ''}`)
      .map(row => ({ ...row, expired: !Number.isFinite(Date.parse(row.expiresAt)) || row.expiresAt <= scope.cutoff }));
    const items = scope.historicalCutoff ? [] : (set?.items || []).filter(row => Date.parse(row.seenAt) > now().getTime() - 7 * DAY);
    return { ...scope, availability, notes, categories, sources: contextSources(scope), brief: buildPrematchBrief(scope, notes, availability),
      news: { items, checkedAt: set?.checkedAt || null, attemptedAt: set?.attemptedAt || null, warning: set?.warning || null,
        diagnostic, providerHealth: saved().providerHealth || null, nextAttemptAt,
        blockedReason: pause ? 'provider_pause' : dailyLimit ? 'daily_limit' : retryTime(set) > clock ? 'selection_cache' : nextAttemptAt ? 'request_spacing' : null,
        cached: retryTime(set) > clock,
        cooldownUntil: saved().cooldownUntil, provider: 'GDELT DOC 2.0', availableForCutoff: !scope.historicalCutoff,
        note: 'Titulares para revisar: no confirman lesiones, sanciones, identidad ni plantilla. Fecha de deteccion GDELT, no publicacion. No se descargan articulos ni se usan como entradas del modelo.' },
      asOf: clock, modelChanged: false };
  }
  function summary(body) { return decorate(read(body)); }
  async function saveNote(body) {
    const scope = read(body), entity = scope.entities.find(row => row.id === body.entityId);
    if (scope.historicalCutoff) fail('Registra reportes desde un corte actual; no se reconstruye contexto historico.');
    if (!entity || !Object.hasOwn(categories, body.category)) fail('Identidad o tipo de reporte no valido.');
    const validTime = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
    if (!validTime(body.publishedAt) || !validTime(body.expiresAt)) fail('Publicacion y vencimiento requieren fecha con zona horaria.');
    const publishedAt = new Date(body.publishedAt).toISOString(), expiresAt = new Date(body.expiresAt).toISOString(), recordedAt = stamp();
    if (publishedAt > recordedAt || expiresAt <= recordedAt || Date.parse(expiresAt) - Date.parse(publishedAt) > 30 * DAY) fail('Reporte vigente, no futuro y con un maximo de 30 dias entre publicacion y vencimiento.');
    const title = text(body.title, 120), note = text(body.note, 350), subject = text(body.subject, 100), sourceUrl = publicContextUrl(body.sourceUrl).href;
    if (title.length < 5 || note.length < 10) fail('Escribe un titulo y un resumen propio de al menos diez caracteres.');
    const report = { id: randomUUID(), sport: scope.sport, key: scope.key, season: scope.season, entityId: entity.id, name: entity.name, team: entity.team,
      category: body.category, subject, fixtureId: scope.fixtureId || null, title, note, sourceUrl, publishedAt, expiresAt, recordedAt, verification: 'manual-unverified', reviews: [],
      notice: 'Reporte registrado por el usuario; la app no ha contrastado automaticamente su contenido.' };
    if (saved().notes.length >= 2000) throw new SportsError(409, 'Limite de reportes alcanzado; conserva y revisa los registros antes de ampliar el archivo.');
    writable().notes.push(report); await persist(); return report;
  }
  async function reviewNote(body) {
    const scope = read(body);
    if (scope.historicalCutoff) fail('No se revisan reportes desde un corte historico.');
    if (!['reviewed', 'unreviewed', 'withdrawn'].includes(body.action)) fail('Accion de revision no valida.');
    const row = saved().notes.find(item => item.id === body.noteId && item.sport === scope.sport && item.key === scope.key && item.season === scope.season &&
      (!item.fixtureId || item.fixtureId === scope.fixtureId) && scope.entities.some(entity => entity.id === item.entityId));
    if (!row) throw new SportsError(404, 'Reporte no encontrado para esta seleccion.');
    if ((row.reviews?.length || 0) >= 100) throw new SportsError(409, 'Limite de revisiones del reporte alcanzado.');
    const review = { action: body.action, recordedAt: stamp() };
    row.reviews ||= []; row.reviews.push(review); await persist();
    return { id: row.id, review, modelChanged: false };
  }
  async function refresh(body) {
    const scope = read(body), key = cacheKey(scope), clock = stamp(), prior = saved().news[key];
    if (scope.historicalCutoff) fail('No se buscan noticias actuales para reconstruir un contexto anterior.');
    if (busy) throw new SportsError(409, 'Ya hay una consulta de noticias en curso.');
    if (decorate(scope).news.nextAttemptAt) return { ...decorate(scope), requests: 0 };
    const day = clock.slice(0, 10), quota = saved().quota.day === day ? saved().quota.count : 0;
    if (quota >= 60) throw new SportsError(429, 'Limite preventivo de 60 consultas de noticias al dia.');
    const terms = [...new Set(scope.entities.flatMap(row => {
      const name = row.name.replace(/[^\p{L}\p{N}\s.'-]/gu, '').trim(), parts = name.split(/\s+/);
      return row.kind === 'player' && parts.length === 2 && parts.every(part => part.length > 2) ? [name, [...parts].reverse().join(' ')] : [name];
    }).filter(name => name.length >= 4))].slice(0, 4);
    if (!terms.length) fail('Identidad demasiado corta para una busqueda de noticias sin ambiguedad.');
    const allowedDomains = [...new Set([...domains[scope.sport], ...contextNewsDomains(scope)])];
    const query = `${terms.length > 1 ? '(' + terms.map(name => `"${name}"`).join(' OR ') + ')' : `"${terms[0]}"`} (${allowedDomains.map(domain => `domainis:${domain}`).join(' OR ')})`;
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.search = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '10', timespan: '7d', sort: 'datedesc' });
    busy = true;
    let httpStatus = null; const started = performance.now();
    try {
      const state = writable(); state.quota = { day, count: quota + 1 }; state.lastRequestAt = clock;
      state.news[key] = { ...prior, attemptedAt: clock, items: prior?.items || [], warning: null };
      await persist();
      const response = await request(url, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { accept: 'application/json' } });
      httpStatus = response.status;
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const until = /^\d+$/.test(retry || '') ? now().getTime() + Number(retry) * 1000 : Date.parse(retry);
          state.cooldownUntil = new Date(Math.max(now().getTime() + HOUR, Number.isFinite(until) && until <= 8640000000000000 ? until : 0)).toISOString();
        }
        await response.body?.cancel().catch(() => {});
        throw new Error('provider_unavailable');
      }
      let bytes = 0, content = ''; const decoder = new TextDecoder();
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 256 * 1024) throw Object.assign(new Error(), { code: 'oversized' }); content += decoder.decode(chunk, { stream: true }); }
      content += decoder.decode();
      let payload; try { payload = JSON.parse(content); } catch { throw Object.assign(new Error(), { code: 'bad_json' }); }
      if (!Array.isArray(payload?.articles)) throw Object.assign(new Error(), { code: 'bad_schema' });
      const items = new Map();
      for (const article of payload.articles.slice(0, 100)) {
        try {
          const link = publicContextUrl(article.url), domain = link.hostname.replace(/^www\./, ''), seenAt = seenDate(article.seendate);
          if (!allowedDomains.some(allowed => domain === allowed || domain.endsWith('.' + allowed)) || !seenAt || Date.parse(seenAt) > now().getTime() || Date.parse(seenAt) < now().getTime() - 7 * DAY) continue;
          link.hash = '';
          const title = text(article.title, 220).split(' ').slice(0, 25).join(' ');
          if (title.length < 5) continue;
          items.set(link.href, { title, url: link.href, domain, seenAt, recordedAt: stamp(), verification: 'candidate', source: 'GDELT / dominio oficial', publishedAt: null });
        } catch { /* Untrusted external links are never fetched or passed through. */ }
      }
      const checkedAt = stamp(), diagnostic = { code: items.size ? 'ok' : 'empty', label: diagnosticLabels[items.size ? 'ok' : 'empty'], httpStatus, durationMs: Math.round(performance.now() - started) };
      state.news[key] = { attemptedAt: clock, checkedAt, items: [...items.values()].slice(0, 10), warning: null,
        diagnostic, nextAttemptAt: new Date(now().getTime() + 6 * HOUR).toISOString() };
      state.providerHealth = { ...diagnostic, attemptedAt: clock, checkedAt };
    } catch (error) {
      const state = writable(), diagnostic = newsFailure(error, httpStatus, Math.round(performance.now() - started));
      const next = new Date(now().getTime() + (diagnostic.code === 'rate_limited' ? HOUR : FAILURE_PAUSE)).toISOString();
      state.cooldownUntil = [state.cooldownUntil, next].filter(Boolean).sort().at(-1);
      state.news[key] = { ...state.news[key], diagnostic, nextAttemptAt: state.cooldownUntil,
        warning: `${diagnostic.label}${httpStatus ? ` (HTTP ${httpStatus})` : ''}. Se conserva la muestra previa; no se presenta como actualizada. No hay reintentos automaticos.` };
      state.providerHealth = { ...diagnostic, attemptedAt: clock, checkedAt: state.providerHealth?.checkedAt || null };
    } finally {
      const state = writable(), entries = Object.entries(state.news).sort((a, b) => (b[1].attemptedAt || '').localeCompare(a[1].attemptedAt || ''));
      state.news = Object.fromEntries(entries.slice(0, 100));
      busy = false; await persist();
    }
    return { ...decorate(scope), requests: 1 };
  }
  return { summary, saveNote, reviewNote, refresh };
}
