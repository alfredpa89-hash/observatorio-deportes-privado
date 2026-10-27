import { jsonRequest } from './api-client.js';
import { onDataRefresh } from './live-refresh.js';
import { evidenceSampleLabel } from './basketball-evidence.js';
const $ = id => document.getElementById(id);
const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const date = value => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value));
const localDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const metrics = { points: 'Puntos', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA', threes: 'Triples' };
let state, busy = false, disconnected = false, page = 0, lastDay = localDay();
const selection = () => ({ day: $('bd-day').value, league: $('bd-league').value, kind: $('bd-kind').value });
const visible = () => (state?.rows || []).filter(row => row.probability >= Number($('bd-min').value) &&
  ($('bd-evidence').value === 'all' || row.evidence && row.evidence.level < 3) &&
  ($('bd-market').value === 'all' || (row.kind === 'player' ? row.spec.metric : row.spec.type) === $('bd-market').value) &&
  ($('bd-period').value === 'all' || (row.spec.period || 'ft') === $('bd-period').value) && Date.parse(row.fixture.date) >= Date.now() + 5 * 60000);
function message(value = '', error = false) { $('bd-message').textContent = value; $('bd-message').classList.toggle('error', error); }
async function api(path = '', body) {
  return jsonRequest(`/api/basketball/daily${path}`, body);
}
function dayLimits() {
  const today = localDay(); $('bd-day').min = today;
  $('bd-day').max = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  if (!$('bd-day').value || $('bd-day').value < today) $('bd-day').value = today;
}
function render() {
  if (!state) return;
  const rows = visible(), size = Number($('bd-size').value);
  page = Math.max(0, Math.min(page, Math.ceil(rows.length / size) - 1));
  const start = page * size;
  $('bd-count').textContent = rows.length ? `${start + 1}-${Math.min(start + size, rows.length)} de ${rows.length} selecciones` : '0 selecciones';
  $('bd-kpis').replaceChildren(...[['Encuentros admisibles', state.counts.fixtures], ['Escenarios guardados', state.counts.scenarios], ['Equipos', state.counts.teams], ['Individuales', state.counts.players]].map(([label, value]) => {
    const item = node('div'); item.append(node('span', label), node('strong', num(value))); return item;
  }));
  const stale = Date.now() - Date.parse(state.generatedAt) > 2 * 60000;
  $('bd-freshness').textContent = disconnected ? `Sin conexion. Ultima lectura ${date(state.generatedAt)}; lista no actualizada.` : `${state.day} / Guayaquil / Leido ${date(state.generatedAt)}${stale ? ' / Lectura antigua: actualiza la lista' : ''}`;
  $('bd-list').replaceChildren(...rows.slice(start, start + size).map((row, index) => {
    const item = node('article', '', 'daily-row'), rank = node('span', String(start + index + 1).padStart(2, '0'), 'daily-rank');
    const description = node('div', '', 'daily-description');
    description.append(node('span', `${row.competition} / ${date(row.fixture.date)}`, 'daily-context'), node('h4', row.label), node('p', `${row.fixture.home} - ${row.fixture.away}`));
    const probability = node('div', '', 'daily-estimate'); probability.append(node('strong', `${num(row.probability)} %`), node('span', 'Estimada'));
    const track = node('div', '', 'prob-track'), fill = node('div', '', 'prob-fill'); fill.style.width = `${row.probability}%`; track.append(fill); probability.append(track);
    const evidence = node('div', '', 'daily-evidence'); evidence.append(node('span', `Modelo n=${row.n} / ventana ${row.lookback}`), node('span', row.missing ? `${row.missing} datos faltantes` : 'Sin campos faltantes en la muestra disponible'),
      node('span', row.calibrated ? `Calibracion historica n=${row.calibrationN}` : 'Experimental; sin calibracion'));
    if (row.evidence) evidence.append(node('strong', row.evidence.label), node('span', evidenceSampleLabel(row.evidence)),
      node('span', row.evidence.missing || row.evidence.unfilled ? `${row.evidence.missing} campos faltantes / ${row.evidence.unfilled} partidos para completar la ventana` : 'Ventana guardada con campos completos'));
    if (row.observed) evidence.append(node('span', Object.entries(row.observed).filter(([, sample]) => sample?.n).map(([side, sample]) =>
      `${side === 'home' ? 'Local' : side === 'away' ? 'Visitante' : 'Jugador'}: ${sample.hits} de ${sample.n} partidos cumplieron la condicion`).join(' | ')));
    const status = node('div', '', 'daily-status'); status.append(node('span', row.origin === 'trial' ? 'Prueba de octubre' : 'Archivo de investigacion', 'daily-origin'), node('span', row.availability.note));
    if (row.kind === 'player') status.append(node('span', `${num(row.projectedMinutes)} min proyectados`));
    const details = node('details', '', 'daily-details'); details.append(node('summary', 'Registro y fuente'));
    details.append(node('p', `Sellado ${date(row.createdAt)} / ${row.modelVersion} / ${row.fixture.season}`), node('p', row.sources.join(', ') || 'Fuente identificada en el archivo de entradas'));
    if (row.evidence) details.append(...row.evidence.reasons.map(reason => node('p', reason)));
    status.append(details); item.append(rank, description, probability, evidence, status); return item;
  }));
  $('bd-empty').hidden = Boolean(rows.length);
  $('bd-empty-title').textContent = state.counts.scenarios ? 'Sin coincidencias con los filtros' : 'Sin estimaciones disponibles para este dia';
  $('bd-empty-note').textContent = state.counts.scenarios ? 'Hay escenarios guardados, pero ninguno coincide con estos filtros o conserva margen antes del inicio.' :
    state.counts.fixtures ? 'Hay encuentros guardados. La preparacion requiere historial suficiente; los registros antiguos no sustituyen la temporada actual.' :
      'No hay calendario futuro admisible guardado. Las temporadas actuales bloqueadas por Free no se completan con datos inventados.';
  $('bd-prev').disabled = busy || page === 0; $('bd-next').disabled = busy || start + size >= rows.length;
  $('bd-export').disabled = busy || !rows.length; $('bd-prepare').disabled = busy || !state.counts.fixtures || state.league === 'endesa';
  $('bd-coverage').replaceChildren(...state.coverage.map(item => node('li', `${item.name}: ${item.history} resultados guardados, ${item.fixtures} encuentros admisibles. ${item.note}`)));
  $('bd-lines').replaceChildren(...Object.entries(state.lines).filter(([league]) => state.league === 'all' || state.league === league).map(([league, lines]) => {
    const item = node('p'); item.append(node('strong', `${league === 'nba' ? 'NBA' : 'Euroliga'}: `), document.createTextNode(`Total ${lines.total}, 1Q ${lines.quarter}, descanso ${lines.half}, handicap local ${lines.spread}. `),
      document.createTextNode(Object.entries(lines.players).map(([metric, line]) => `${metrics[metric]} ${line}`).join('; ') + '. Historial: 20 partidos.')); return item;
  }));
  $('bd-notice').textContent = state.notice;
  const excluded = state.excluded;
  $('bd-exclusions').textContent = `${excluded.started} encuentros no admisibles por inicio, estado u horario; ${excluded.invalid} registros con integridad invalida; ${excluded.rescheduled} reprogramados; ${excluded.missing} escenarios o registros sin evidencia; ${excluded.unavailable} individuales excluidos por disponibilidad. Solo se muestra el lado de mayor probabilidad de cada familia y linea. No son cuotas de casas.`;
}
async function task(action) {
  if (busy) return; busy = true;
  const controls = [...$('bb-daily-view').querySelectorAll('button, input, select')]; controls.forEach(item => { item.disabled = true; });
  $('bb-daily-view').setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) {
    disconnected = true; message(error.message, true);
    if (state && ['day', 'league', 'kind'].some(key => state[key] !== selection()[key])) state = undefined;
    if (!state) { $('bd-list').replaceChildren(); $('bd-kpis').replaceChildren(); $('bd-count').textContent = 'Sin lectura actual'; }
    $('bd-freshness').textContent = state ? `Sin conexion. Ultima lectura ${date(state.generatedAt)}; lista no actualizada.` : 'No se pudo leer el servidor local.';
  }
  finally { busy = false; controls.forEach(item => { item.disabled = false; }); $('bb-daily-view').setAttribute('aria-busy', 'false'); if (state) render(); else { $('bd-prepare').disabled = true; $('bd-export').disabled = true; } }
}
async function load() {
  dayLimits(); state = await api(`?${new URLSearchParams(selection())}`); disconnected = false; render();
}
document.querySelector('[data-basket-view="daily"]').addEventListener('click', () => task(async () => { message(); await load(); }));
for (const id of ['bd-day', 'bd-league', 'bd-kind']) $(id).addEventListener('change', () => task(async () => { page = 0; message(); await load(); }));
for (const id of ['bd-market', 'bd-period', 'bd-evidence', 'bd-size']) $(id).addEventListener('change', () => { page = 0; render(); });
$('bd-min').addEventListener('input', () => { $('bd-min-value').textContent = `${$('bd-min').value} %`; page = 0; render(); });
$('bd-reload').addEventListener('click', () => task(async () => { message(); await load(); }));
$('bd-prepare').addEventListener('click', () => task(async () => {
  message('Preparando solo encuentros futuros con los datos guardados...');
  const result = await api('/prepare', selection()); state = result.state; disconnected = false; page = 0;
  message(`${result.sealed} pronosticos nuevos; ${result.existing} ya guardados.${result.issues.length ? ` ${result.issues.length} pendientes por datos o disponibilidad.` : ''}${result.remaining ? ` ${result.remaining} encuentros fuera del limite de esta carga.` : ''} No se consulto la API.`, Boolean(result.issues.length));
  const unique = [...new Set(result.issues.map(item => `${item.player ? `${item.player} / ${metrics[item.metric]}: ` : ''}${item.reason}`))];
  $('bd-issues-details').hidden = !unique.length; $('bd-issues-count').textContent = `${unique.length} pendientes de preparacion`;
  $('bd-issues').replaceChildren(...unique.map(text => node('li', text))); render();
}));
$('bd-prev').addEventListener('click', () => { page--; render(); });
$('bd-next').addEventListener('click', () => { page++; render(); });
$('bd-export').addEventListener('click', () => {
  if (!state) return;
  const rows = [['dia_guayaquil', 'liga', 'encuentro', 'inicio', 'escenario', 'probabilidad_estimada', 'muestra', 'ventana', 'faltantes', 'origen', 'sellado', 'modelo', 'disponibilidad', 'minutos_proyectados', 'respaldo', 'muestra_por_equipo', 'avisos_datos'],
    ...visible().map(row => [state.day, row.competition, `${row.fixture.home} - ${row.fixture.away}`, row.fixture.date, row.label, row.probability, row.n, row.lookback, row.missing, row.origin, row.createdAt, row.modelVersion, row.availability.note, row.projectedMinutes,
      row.evidence?.label, row.evidence ? evidenceSampleLabel(row.evidence) : '', row.evidence?.reasons.join(' | ')])];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`, url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = `probabilidades-baloncesto-${state.day}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setInterval(() => {
  if ($('basketball-workspace').hidden || $('bb-daily-view').hidden || busy) return;
  const today = localDay(); if (today !== lastDay) { $('bd-day').value = today; lastDay = today; page = 0; }
  task(load);
}, 60000);
dayLimits();
onDataRefresh('basketball', () => !$('basketball-workspace').hidden && !$('bb-daily-view').hidden && !busy, () => task(load));
