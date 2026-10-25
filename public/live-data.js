import { currentCutoff } from './live-refresh.js';

const main = document.getElementById('main-content'), band = document.createElement('section');
band.className = 'live-data-band'; band.setAttribute('aria-label', 'Estado de actualizacion de datos');
band.innerHTML = '<div><strong id="live-data-title">Comprobando datos disponibles</strong><p id="live-data-detail" role="status" aria-live="polite"></p></div><button id="live-data-check" class="button button-secondary icon-button" type="button" title="Comprobar fuentes disponibles" aria-label="Comprobar fuentes disponibles"><i data-lucide="refresh-cw" aria-hidden="true"></i></button>';
main.querySelector('.workspace-head').after(band);
const title = document.getElementById('live-data-title'), detail = document.getElementById('live-data-detail'), check = document.getElementById('live-data-check');
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)) : 'sin comprobar';
let polling = false, last = {}, baseline = false, status = null, lastVisit = 0, lastPoll = 0;
function cutoffs() {
  return [...document.querySelectorAll('[data-live-cutoff], #bb-cutoff, #bt-cutoff, #cutoff-date, #profile-cutoff, #fp-cutoff, #sp-cutoff')];
}
function updateCutoffs() {
  for (const input of cutoffs()) {
    input.value = currentCutoff(input.type, input.value, input.dataset.liveManual === 'true');
    if (input.type === 'date' && input.max) input.max = currentCutoff('date');
  }
}
document.addEventListener('input', event => { if (cutoffs().includes(event.target)) event.target.dataset.liveManual = 'true'; }, true);
document.addEventListener('submit', updateCutoffs, true);
function render(value) {
  status = value;
  const updating = value.phase === 'updating', limited = value.missing.length || value.issues.length || value.disabledSports.length || value.phase !== 'checked';
  band.dataset.state = updating ? 'updating' : limited ? 'partial' : 'checked';
  title.textContent = updating ? `Actualizando fuentes / ${value.processed} de ${value.total}` : limited ? 'Revision disponible / cobertura parcial' : 'Fuentes disponibles revisadas';
  const reason = [...value.missing, ...value.issues.map(issue => `${issue.task}: ${issue.message}`), ...value.disabledSports.map(sport => `${{ basketball: 'Baloncesto', football: 'Futbol', tennis: 'Tenis' }[sport]}: actualizacion automatica desactivada.`)];
  detail.textContent = `${updating ? `Solicitud ${date(value.requestedAt)}.` : `Comprobacion terminada: ${date(value.finishedAt)}.`} ${reason.length ? reason.slice(0, 2).join(' ') : 'Los analisis conservan la fecha de su ultimo resultado real.'} Cache de comprobacion: hasta ${value.cacheMinutes} min.`;
  detail.title = [...reason, value.note].join('\n'); check.disabled = updating;
  const changed = Object.entries(value.updatedSports).filter(([sport, at]) => baseline && last[sport] !== at).map(([sport]) => sport);
  last = value.updatedSports; baseline = true;
  if (changed.length) { updateCutoffs(); document.dispatchEvent(new CustomEvent('observatorio:refreshed', { detail: { sports: changed, checkedAt: value.finishedAt || value.lastCycle } })); }
}
async function request(path, body) {
  const response = await fetch(`/api/data/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Servidor no disponible'); return data;
}
async function poll() {
  if (polling || document.hidden) return; polling = true; lastPoll = Date.now();
  try { render(await request('progress')); }
  catch { band.dataset.state = 'partial'; title.textContent = 'No se pudo comprobar la actualizacion'; detail.textContent = 'Se conservan las vistas guardadas. Comprueba que el servidor local siga encendido.'; check.disabled = false; }
  finally { polling = false; }
}
async function visit() {
  lastVisit = Date.now();
  try {
    if (!Object.keys(last).length) render(await request('progress'));
    render(await request('visit', {}));
  } catch { title.textContent = 'Actualizacion pendiente'; detail.textContent = 'No se pudo consultar el servidor. Los datos anteriores no se presentan como actuales.'; }
}
check.addEventListener('click', visit);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateCutoffs(); void visit(); } });
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - lastVisit >= 15 * 60000) void visit();
  else if (status?.phase === 'updating' || Date.now() - lastPoll >= 30000) void poll();
}, 2000);
updateCutoffs(); void visit(); window.lucide?.createIcons();
