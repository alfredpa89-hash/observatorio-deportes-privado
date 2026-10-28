import { jsonRequest } from './api-client.js';
import { evidenceSampleLabel } from './basketball-evidence.js';
import { mountRelevantContext } from './relevant-context.js';
import { selectOverviewMarkets } from './basketball-scenario-options.js';
import { mountBasketballAvailabilityLinks } from './basketball-availability-links.js';

const node = (tag, text = '', className = '') => { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 1 });
const formatter = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' });
const date = value => value ? formatter.format(new Date(value)) : 's/d';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dialog = node('dialog', '', 'daily-overview'); dialog.id = 'daily-overview'; dialog.setAttribute('aria-labelledby', 'overview-title');
const header = node('header', '', 'overview-header'), heading = node('div'), title = node('h2', 'Resumen del dia'); title.id = 'overview-title';
heading.append(title, node('p', 'Hoy y manana · Guayaquil · Con los datos guardados'));
const close = node('button', 'Cerrar', 'button button-secondary'); close.type = 'button'; close.addEventListener('click', () => dialog.close()); header.append(heading, close);
const body = node('div', '', 'overview-body'), filters = node('form', '', 'overview-filters');
function select(id, label, choices) { const wrap = node('label', '', 'field'), input = node('select'); input.id = id; wrap.htmlFor = id;
  for (const [value, text] of choices) { const option = node('option', text); option.value = value; input.append(option); }
  wrap.append(node('span', label), input); filters.append(wrap); return input; }
const day = select('overview-day', 'Dia', [[today(), 'Hoy']]);
const tomorrow = new Date(Date.parse(`${today()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), tomorrowOption = node('option', 'Manana'); tomorrowOption.value = tomorrow; day.append(tomorrowOption);
const sport = select('overview-sport', 'Deporte', [['basketball', 'Baloncesto'], ['football', 'Futbol'], ['tennis', 'Tenis'], ['all', 'Todos']]);
const group = select('overview-group', 'Condicion', [['all', 'Todas las condiciones']]);
const direction = select('overview-direction', 'Sentido', [['both', 'Over y under'], ['over', 'Over (mas de)'], ['under', 'Under (menos de)']]);
const lineField = node('label', '', 'field'), line = node('input'), lineOptions = node('datalist');
line.id = 'overview-line'; line.type = 'number'; line.min = '.5'; line.max = '499.5'; line.step = '1'; line.value = '220.5'; line.setAttribute('list', 'overview-lines');
lineOptions.id = 'overview-lines'; lineField.append(node('span', 'Linea de puntos (.5)'), line, lineOptions); filters.append(lineField);
const isTotal = () => ['total', 'q1-total', 'ht-total'].includes(group.value);
const period = () => ({ 'q1-total': 'q1', 'ht-total': 'ht' }[group.value] || 'ft');
function lineControls() { lineField.hidden = direction.parentElement.hidden = !isTotal(); line.required = isTotal(); }
lineControls();
const reload = node('button', 'Leer datos guardados', 'button button-primary'); reload.type = 'submit'; filters.append(reload);
const status = node('p', '', 'overview-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
const cards = node('div', '', 'overview-cards'), notice = node('p', '', 'overview-notice');
const coverage = node('details'), coverageList = node('ul', '', 'overview-coverage'); coverage.append(node('summary', 'Cobertura, fechas y pendientes'), coverageList);
const evaluation = node('details'), evaluationBody = node('div', '', 'overview-evaluation'), evaluationControls = node('div', '', 'overview-filters');
const evalLeague = node('select'); evalLeague.setAttribute('aria-label', 'Competicion a evaluar');
for (const [value, label] of [['nba', 'NBA'], ['euroleague', 'Euroliga'], ['tennis', 'Tenis']]) { const option = node('option', label); option.value = value; evalLeague.append(option); }
const evalRead = node('button', 'Leer evaluacion guardada', 'button button-secondary'); evalRead.type = 'button';
const evalSave = node('button', 'Guardar equipos para evaluar', 'button button-secondary'); evalSave.type = 'button';
evaluationControls.append(evalLeague, evalRead, evalSave);
evaluation.append(node('summary', 'Comprobar si los porcentajes funcionan'), evaluationControls, evaluationBody);
evaluation.append(node('p', 'Guardar sella NBA o Euroliga de la fecha seleccionada antes del inicio, con ventana 20 y lineas internas fijas. No consulta APIs ni cambia registros anteriores. Tenis conserva su preparacion en su propio apartado.', 'overview-notice'));
const contextRoot = node('div', '', 'overview-context'), context = mountRelevantContext(contextRoot);
const availabilityRoot = node('div'), availabilityLinks = mountBasketballAvailabilityLinks(availabilityRoot);
body.append(filters, status, cards, notice, availabilityRoot, coverage, evaluation, contextRoot); dialog.append(header, body); document.body.append(dialog);
let state, busy = false, revision = 0, manualGroup = false;
function show() {
  if (!state) return;
  const selected = state.rows.flatMap(row => {
    return selectOverviewMarkets(row.markets, { group: group.value, direction: direction.value, line: line.value }).map(market => ({ row, market }));
  }).sort((a, b) => (a.market.evidence?.level ?? 4) - (b.market.evidence?.level ?? 4) || b.market.probability - a.market.probability);
  cards.replaceChildren(...selected.slice(0, 36).map(({ row, market }) => {
    const card = node('article', '', 'overview-card'), evidence = market.evidence; card.dataset.level = String(evidence?.level ?? 4);
    card.append(node('small', `${row.fixture.competition} · ${date(row.fixture.date)}`), node('h3', `${row.fixture.home} – ${row.fixture.away}`), node('p', market.label));
    card.append(node('div', evidence?.level >= 3 ? 'Sin estimacion actual utilizable' : `${num(market.probability)} %`, 'overview-probability'), node('span', evidence?.label || 'Datos pendientes', 'overview-quality'));
    if (evidence) card.append(node('p', evidenceSampleLabel(evidence)));
    const observed = market.observed;
    if (observed) card.append(node('p', ['home', 'away'].map(side => observed[side]?.n ? `${side === 'home' ? 'Local' : 'Visitante'}: ${observed[side].hits} de ${observed[side].n} partidos cumplieron` : '').filter(Boolean).join(' · ')));
    if (row.expectedTotal != null) card.append(node('p', `Total esperado: ${num(row.expectedTotal)} puntos.`));
    card.append(node('p', market.calibrated ? `Calibracion historica n=${market.calibrationN}; no acredita eficacia futura.` : 'Experimental; sin calibracion suficiente.'));
    card.append(node('p', `${row.mode === 'sealed' ? 'Pronostico sellado' : 'Vista actual sin sellar'} · Corte ${date(row.cutoff)}. ${row.availability?.note || 'Disponibilidad actual por verificar.'}`));
    const details = node('details'), list = node('ul'); details.append(node('summary', 'Fuentes y limites'));
    list.append(...(evidence?.reasons || []).map(reason => node('li', reason)), node('li', `Fuentes: ${row.sources.join(', ') || 'Identificadas en el historial guardado'}.`));
    if (evidence?.level >= 3) list.append(node('li', `Referencia del modelo: ${num(market.probability)} %. Se excluye de la lista de estimaciones actuales por antiguedad o falta de muestra.`));
    details.append(list); card.append(details);
    const contextButton = node('button', 'Ver contexto prepartido', 'button button-secondary'); contextButton.type = 'button';
    contextButton.addEventListener('click', async () => { await context.show(row.scope); contextRoot.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); card.append(contextButton);
    return card;
  }));
  if (!selected.length) cards.append(node('p', 'No hay estimaciones admisibles para esta seleccion. Revisa el calendario y la cobertura; no significa 0 % de probabilidad.'));
}
async function load() {
  if (busy) return; busy = true; const token = ++revision;
  filters.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; }); status.dataset.error = 'false'; status.textContent = 'Leyendo el calendario y calculando con el historial guardado…';
  try {
    const result = await jsonRequest(`/api/daily-overview?${new URLSearchParams({ day: day.value, sport: sport.value,
      ...(isTotal() ? { period: period(), line: line.value } : {}) })}`);
    if (token !== revision) return;
    state = result; const previous = group.value; group.replaceChildren();
    availabilityLinks.setLeague(state.rows.some(row => row.scope.key === 'nba') ? 'nba' : '');
    const all = node('option', 'Todas las condiciones'); all.value = 'all'; group.append(all);
    const names = { winner: 'Ganador', total: 'Total de puntos', spread: 'Handicap', 'q1-total': 'Total primer cuarto', 'ht-total': 'Total al descanso', resultado: 'Ganador', 'doble-oportunidad': 'Doble oportunidad', goles: 'Goles', corners: 'Corners', tarjetas: 'Tarjetas', 'ambos-marcan': 'Ambos marcan' };
    for (const value of [...new Set(state.rows.flatMap(row => row.markets.map(market => market.group)))].filter(Boolean)) { const option = node('option', names[value] || value); option.value = value; group.append(option); }
    if ([...group.options].some(option => option.value === previous)) group.value = previous;
    if (!manualGroup) group.value = ['total', 'resultado'].find(value => [...group.options].some(option => option.value === value)) || 'all';
    updateLines(false); lineControls();
    status.textContent = `Lectura ${date(state.generatedAt)} · ${state.rows.length} encuentros o escenarios individuales. No se consultaron las APIs deportivas.`;
    notice.textContent = state.notice;
    coverageList.replaceChildren(...state.coverage.map(row => node('li', `${row.name}: ${row.fixtures} encuentros; ultimo resultado ${date(row.latest)}. ${row.note}`)), ...state.issues.map(text => node('li', text)));
    show();
  } catch (error) {
    status.dataset.error = 'true'; status.textContent = `${error.message}${state ? ` Se muestra la seleccion anterior (${state.day}, ${state.sport}), leida ${date(state.generatedAt)}.` : ''}`;
  } finally { busy = false; filters.querySelectorAll('input, select, button').forEach(el => { el.disabled = false; }); }
}
filters.addEventListener('submit', event => { event.preventDefault(); void load(); });
function updateLines(reset) {
  const markets = state?.rows.flatMap(row => row.markets).filter(market => market.group === group.value && market.spec?.type === 'total') || [];
  const values = [...new Set(markets.map(market => market.spec.line))].sort((a, b) => a - b);
  lineOptions.replaceChildren(...values.map(value => { const option = node('option'); option.value = value; return option; }));
  if (reset || values.length && !values.includes(Number(line.value))) {
    const nba = state.rows.some(row => row.scope.key === 'nba'), defaults = nba ? { ft: 220.5, q1: 55.5, ht: 110.5 } : { ft: 160.5, q1: 40.5, ht: 80.5 };
    line.value = values.includes(defaults[period()]) ? defaults[period()] : values[0] ?? defaults[period()];
  }
}
day.addEventListener('change', load); sport.addEventListener('change', load);
group.addEventListener('change', () => { manualGroup = true; updateLines(true); lineControls(); show(); });
direction.addEventListener('change', show);
line.addEventListener('change', () => { if (!line.checkValidity()) { line.reportValidity(); return; }
  const exists = state?.rows.some(row => row.markets.some(market => market.group === group.value && market.spec?.line === Number(line.value)));
  if (exists) show(); else void load(); });
evalRead.addEventListener('click', async () => {
  evalRead.disabled = true; evaluationBody.textContent = 'Leyendo registros sellados antes del inicio…';
  try {
    const tennis = evalLeague.value === 'tennis';
    const result = await jsonRequest(`/api/daily-overview/evaluation?${new URLSearchParams({ sport: tennis ? 'tennis' : 'basketball', league: evalLeague.value })}`);
    const groups = tennis ? result.groups : Object.entries(result.summary || {}).map(([group, data]) => ({ group, ...data }));
    evaluationBody.replaceChildren(node('p', `${tennis ? result.snapshots : result.frozen} registros sellados. ${result.pending ?? result.exclusions?.pending ?? 0} pendientes. Esta lectura no cambia la calibracion.`));
    if (!groups.length) evaluationBody.append(node('p', 'Todavia no hay resultados evaluables. Las vistas sin sellar no se contabilizan como pronosticos anteriores al partido.'));
    for (const row of groups) {
      const detail = node('details'), bins = node('ul'); detail.append(node('summary', `${row.group}: n=${row.n} · acierto ${num(row.accuracy)} % · Brier ${row.brier == null ? 's/d' : row.brier.toFixed(4)} · log loss ${row.logLoss == null ? 's/d' : row.logLoss.toFixed(4)}`));
      bins.append(...(row.bins || []).filter(bin => bin.n).map(bin => node('li', `${bin.from}–${bin.to} %: ${bin.n} casos; anunciado ${num(bin.predicted)} %, observado ${num(bin.observed)} %.`))); detail.append(bins); evaluationBody.append(detail);
    }
    evaluationBody.append(node('p', 'La eficacia sigue pendiente de una muestra suficiente y comparaciones temporales. No se convierte acierto en rentabilidad.'));
  } catch (error) { evaluationBody.textContent = error.message; } finally { evalRead.disabled = false; }
});
evalLeague.addEventListener('change', () => { evalSave.disabled = evalLeague.value === 'tennis'; });
evalSave.addEventListener('click', async () => {
  if (evalLeague.value === 'tennis') return;
  evalSave.disabled = true; evalRead.disabled = true; evalLeague.disabled = true;
  evaluationBody.textContent = 'Guardando solo encuentros futuros admisibles. Esta operacion no se repetira automaticamente si tarda demasiado…';
  try {
    const result = await jsonRequest('/api/basketball/daily/prepare', { day: day.value, league: evalLeague.value, kind: 'team' });
    evaluationBody.replaceChildren(node('p', `${result.sealed} pronosticos nuevos; ${result.existing} ya guardados; ${result.issues.length} pendientes. Puedes leer ahora la evaluacion; los encuentros sin resultado seguiran pendientes.`));
    const reasons = [...new Set(result.issues.map(item => item.reason))];
    if (reasons.length) { const list = node('ul'); list.append(...reasons.map(reason => node('li', reason))); evaluationBody.append(list); }
  } catch (error) { evaluationBody.textContent = `${error.message} Lee la evaluacion antes de intentar guardar otra vez; puede haberse completado parte del lote.`; }
  finally { evalSave.disabled = false; evalRead.disabled = false; evalLeague.disabled = false; }
});
document.getElementById('open-daily-overview').addEventListener('click', () => { dialog.showModal(); void load(); });
