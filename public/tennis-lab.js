import { jsonRequest } from './api-client.js';
import { onDataRefresh, currentCutoff } from './live-refresh.js';
import { mountRelevantContext } from './relevant-context.js';
const root = document.getElementById('tennis-workspace');
const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const num = value => value === null || value === undefined ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value === null || value === undefined ? 's/d' : `${num(value)} %`;
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 's/d';
const localInput = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};
const matchDate = match => match.datePrecision === 'tournament-week' ? `${match.date.slice(0, 10)} (semana)` : date(match.date);
const option = (value, label) => { const node = el('option', label); node.value = value; return node; };
function button(label, icon, primary = false) {
  const node = el('button', '', `button ${primary ? 'button-primary' : 'button-secondary'}`), glyph = el('i');
  node.type = 'button'; glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true'); node.append(glyph, el('span', label)); return node;
}
function field(parent, label, choices, type = 'select') {
  const wrapper = el('label', '', 'field'), control = el(choices ? 'select' : 'input');
  control.id = `tn-field-${field.next++}`; wrapper.htmlFor = control.id;
  if (choices) control.append(...choices.map(([value, text]) => option(value, text))); else control.type = type;
  wrapper.append(el('span', label), control); parent.append(wrapper); return control;
}
field.next = 1;
function table(parent, title, columns) {
  if (title) parent.append(el('h3', title));
  const wrapper = el('div', '', 'table-scroll'), node = el('table', '', 'basket-table'), head = el('thead'), tr = el('tr'), body = el('tbody');
  tr.append(...columns.map(column => el('th', column))); head.append(tr); node.append(head, body); wrapper.append(node); parent.append(wrapper);
  return { body, fill(rows, empty = 'Sin registros para esta seleccion.') {
    body.replaceChildren(...rows.map(values => { const row = el('tr'); row.append(...values.map(value => { const cell = el('td'); if (value instanceof Node) cell.append(value); else cell.textContent = value; return cell; })); return row; }));
    if (!rows.length) { const row = el('tr'), cell = el('td', empty); cell.colSpan = columns.length; row.append(cell); body.append(row); }
  } };
}
function kpis(parent, values) {
  parent.replaceChildren(...values.map(([label, value]) => { const item = el('div'); item.append(el('span', label), el('strong', String(value))); return item; }));
}
const countLabel = item => item.n ? `${item.hits} de ${item.n} partidos` : 'Sin partidos con dato';
const interval = item => item.interval ? `${pct(item.interval[0])} a ${pct(item.interval[1])}` : 's/d';
const sourceLink = (url, label = 'Fuente') => { const a = el('a', label, 'text-link'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
async function api(path, body) {
  return jsonRequest(`/api/tennis/${path}`, body);
}

const heading = el('div', '', 'sport-data-band'), headingText = el('div'), dataStatus = el('p'), refresh = button('Actualizar historicos', 'refresh-cw');
headingText.append(el('h2', 'Tenis ATP'), dataStatus); heading.append(headingText, refresh);
const nav = el('nav', '', 'basket-views'); nav.setAttribute('aria-label', 'Analisis de tenis'); nav.setAttribute('role', 'tablist');
const filters = el('div', '', 'tennis-filters');
const season = field(filters, 'Temporada', [['2026', '2026'], ['2025', '2025']]);
const surface = field(filters, 'Superficie', [['all', 'Todas'], ['Hard', 'Dura'], ['Clay', 'Arcilla'], ['Grass', 'Hierba'], ['Carpet', 'Moqueta']]);
const category = field(filters, 'Categoria', [['all', 'Todas'], ['grand-slam', 'Grand Slam'], ['masters-1000', 'Masters 1000'], ['atp-500', 'ATP 500']]);
const indoor = field(filters, 'Pista', [['all', 'Todas'], ['indoor', 'Cubierta'], ['outdoor', 'Exterior']]);
const tournament = field(filters, 'Torneo', null, 'text'), tournamentList = el('datalist'); tournamentList.id = 'tn-tournaments'; tournament.setAttribute('list', tournamentList.id); filters.append(tournamentList);
const lookback = field(filters, 'Ultimos partidos', [5, 10, 15, 20, 25, 30].map(n => [n, n])); lookback.value = '20';
const bestOf = field(filters, 'Formato del historial', [['3', 'Al mejor de 3'], ['5', 'Al mejor de 5']]);
const cutoff = field(filters, 'Corte / Guayaquil', null, 'datetime-local'); cutoff.value = localInput(); cutoff.dataset.liveCutoff = 'true';
const filterDetails = el('details', '', 'tennis-filter-details'), filterSummary = el('summary', 'Filtros del historial');
filterDetails.append(filterSummary, filters);
const mobileFilters = matchMedia('(max-width: 640px)'); filterDetails.open = !mobileFilters.matches;
mobileFilters.addEventListener('change', () => { filterDetails.open = !mobileFilters.matches; });
const status = el('p', '', 'app-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
const panels = {}, tabs = {};
for (const [id, label] of [['individual', 'Jugador'], ['comparison', 'Prepartido'], ['calendar', 'Encuentros'], ['daily', 'Probabilidades del dia'], ['evaluation', 'Evaluacion'], ['data', 'Datos y disponibilidad']]) {
  const tab = el('button', label, 'segment'), panel = el('section', '', 'tennis-panel');
  tab.type = 'button'; tab.id = `tn-tab-${id}`; panel.id = `tn-panel-${id}`; tab.setAttribute('role', 'tab'); panel.setAttribute('role', 'tabpanel');
  tab.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', tab.id); nav.append(tab); panels[id] = panel; tabs[id] = tab;
  tab.addEventListener('click', () => show(id));
}
root.append(heading, nav, filterDetails, status, ...Object.values(panels));
const profileForm = el('form', '', 'tennis-actions'), player = field(profileForm, 'Jugador del historial', [['', 'Seleccionar jugador']]);
const metric = field(profileForm, 'Estadistica', [['aces', 'Aces']]), customLine = field(profileForm, 'Linea adicional', null, 'number');
customLine.min = '.5'; customLine.max = '99.5'; customLine.step = '1'; customLine.placeholder = 'Opcional';
const analyze = button('Analizar jugador', 'chart-no-axes-combined', true); analyze.type = 'submit'; profileForm.append(analyze);
const profileResult = el('div'), profileTitle = el('h3'), profileKpis = el('div', '', 'basket-kpis'), warnings = el('ul', '', 'player-lab-warnings'); profileResult.hidden = true;
panels.individual.append(profileForm, profileResult); profileResult.append(profileTitle, profileKpis, warnings);
const summaryTable = table(profileResult, 'Produccion individual', ['Estadistica', 'Media', 'Con datos', 'Sin datos']);
const ratiosTable = table(profileResult, 'Servicio y devolucion', ['Indicador', 'Porcentaje', 'Cumplidos / oportunidades', 'Partidos con par', 'Sin par completo']);
const lineTable = table(profileResult, 'Over y under / frecuencia historica', ['Escenario', 'Cumplidos / con datos', 'Frecuencia', 'Intervalo 95 %', 'Sin datos']);
const rangeTable = table(profileResult, 'Intervalos del jugador', ['Rango', 'Cumplidos / con datos', 'Frecuencia', 'Intervalo 95 %', 'Sin datos']);
const contextHeading = el('h3', 'Contexto del jugador'), contextKpis = el('div', '', 'basket-kpis'), availabilityNote = el('p', '', 'calendar-note'); profileResult.append(contextHeading, contextKpis, availabilityNote);
const historyTable = table(profileResult, 'Historial de la muestra', ['Fecha / precision', 'Rival', 'Torneo', 'Superficie', 'Resultado', 'Marcador', 'Aces', 'D. faltas', 'Quiebres']);

const compareForm = el('form', '', 'tennis-actions'), playerA = field(compareForm, 'Jugador A', [['', 'Seleccionar jugador']]), playerB = field(compareForm, 'Jugador B', [['', 'Seleccionar jugador']]);
const gamesLine = field(compareForm, 'Total de juegos', null, 'number'); gamesLine.min = '.5'; gamesLine.max = '99.5'; gamesLine.step = '1'; gamesLine.value = '22.5';
const compareButton = button('Comparar prepartido', 'git-compare-arrows', true); compareButton.type = 'submit'; compareForm.append(compareButton);
const compareResult = el('div'); compareResult.hidden = true; panels.comparison.append(compareForm, compareResult);
const compareTitle = el('h3'), compareNote = el('p', '', 'calendar-note'); compareResult.append(compareTitle, compareNote);
const compareStats = table(compareResult, 'Rendimiento y contexto', ['Indicador', 'Jugador A', 'Jugador B']);
const estimatesTable = table(compareResult, 'Estimaciones experimentales / sin calibracion', ['Escenario', 'Estimacion', 'Muestra A / B', 'Contexto']);
const scenariosTable = table(compareResult, 'Sets y handicaps / frecuencias historicas', ['Escenario', 'Cumplidos / con datos', 'Frecuencia', 'Intervalo 95 %', 'Sin datos']);
const h2h = table(compareResult, 'Enfrentamientos directos', ['Fecha / precision', 'Jugador A', 'Jugador B', 'Marcador', 'Superficie']);

const fixtureDetails = el('details', '', 'method-details'); fixtureDetails.append(el('summary', 'Registrar encuentro con fuente'));
const fixtureForm = el('form', '', 'tennis-actions'), fixtureA = field(fixtureForm, 'Jugador A', [['', 'Seleccionar jugador']]), fixtureB = field(fixtureForm, 'Jugador B', [['', 'Seleccionar jugador']]);
const fixtureTournament = field(fixtureForm, 'Torneo del encuentro', null, 'text'); fixtureTournament.required = true; fixtureTournament.setAttribute('list', tournamentList.id);
const fixtureCategory = field(fixtureForm, 'Categoria del encuentro', [['atp-500', 'ATP 500'], ['masters-1000', 'Masters 1000'], ['grand-slam', 'Grand Slam']]);
const fixtureSurface = field(fixtureForm, 'Superficie del encuentro', [['Hard', 'Dura'], ['Clay', 'Arcilla'], ['Grass', 'Hierba']]);
const fixtureFormat = field(fixtureForm, 'Formato del encuentro', [['3', 'Al mejor de 3'], ['5', 'Al mejor de 5']]);
const fixtureDate = field(fixtureForm, 'Inicio / Guayaquil', null, 'datetime-local'), fixtureSource = field(fixtureForm, 'Fuente del calendario', null, 'url'); fixtureDate.required = fixtureSource.required = true; fixtureSource.placeholder = 'https://';
const addFixture = button('Guardar encuentro', 'calendar-plus', true); addFixture.type = 'submit'; fixtureForm.append(addFixture); fixtureDetails.append(fixtureForm); panels.calendar.append(fixtureDetails);
const calendarNote = el('p', '', 'calendar-note'); panels.calendar.append(calendarNote);
const calendarTable = table(panels.calendar, 'Encuentros guardados', ['Inicio / Guayaquil', 'Encuentro', 'Torneo', 'Superficie / formato', 'Fuente', '']);

const dailyForm = el('form', '', 'tennis-actions'), dailyDate = field(dailyForm, 'Dia / Guayaquil', null, 'date'); dailyDate.value = localInput().slice(0, 10); dailyDate.min = dailyDate.value;
const minimum = field(dailyForm, 'Probabilidad minima (%)', null, 'number'); minimum.value = '50'; minimum.min = '0'; minimum.max = '100'; minimum.step = '1';
const dailyGroup = field(dailyForm, 'Escenario', [['all', 'Todos'], ['resultado', 'Ganador'], ['juegos', 'Juegos'], ['sets', 'Sets']]);
const loadDaily = button('Consultar dia', 'list-filter'); loadDaily.type = 'submit'; const prepareDaily = button('Sellar proximos encuentros', 'shield-check'); dailyForm.append(loadDaily, prepareDaily);
const dailyNote = el('p', '', 'calendar-note'); panels.daily.append(dailyForm, dailyNote);
const dailyTable = table(panels.daily, 'Mayor probabilidad estimada', ['Inicio', 'Encuentro', 'Escenario', 'Probabilidad', 'Muestra minima', 'Sellado']);

const evaluationActions = el('div', '', 'tennis-actions'), backtestButton = button('Evaluar historico seleccionado', 'flask-conical'), evaluationButton = button('Revisar resultados', 'refresh-cw');
evaluationActions.append(backtestButton, evaluationButton); panels.evaluation.append(evaluationActions);
const evaluationNote = el('p', '', 'calendar-note'), evaluationKpis = el('div', '', 'basket-kpis'); panels.evaluation.append(evaluationNote, evaluationKpis);
const evaluationTable = table(panels.evaluation, 'Evaluacion prospectiva / pronosticos previos al inicio', ['Escenario', 'Evaluados', 'Acierto', 'Brier', 'Log loss', 'Faltantes']);
const backtestNote = el('p', '', 'calendar-note'); panels.evaluation.append(el('h3', 'Validacion temporal del ganador'), backtestNote);
const binsTable = table(panels.evaluation, 'Calibracion observada / historico', ['Rango', 'Muestra', 'Probabilidad media', 'Frecuencia real', 'Intervalo 95 %']);

const coverageKpis = el('div', '', 'basket-kpis'), coverageNote = el('p', '', 'calendar-note'); panels.data.append(coverageKpis, coverageNote);
const datasetTable = table(panels.data, 'Historicos guardados', ['Temporada', 'Resultados', 'Ultima descarga', 'Fuente', 'Importador']);
const reportDetails = el('details', '', 'method-details'); reportDetails.append(el('summary', 'Registrar disponibilidad con fuente'));
const reportForm = el('form', '', 'tennis-actions'), reportPlayer = field(reportForm, 'Jugador', [['', 'Seleccionar jugador']]);
const reportStatus = field(reportForm, 'Estado reportado', [['unknown', 'No confirmado'], ['available', 'Disponible'], ['questionable', 'En duda'], ['out', 'Baja']]);
const reportSource = field(reportForm, 'Fuente del reporte', null, 'url'), reportPublished = field(reportForm, 'Publicado / Guayaquil', null, 'datetime-local'), reportExpires = field(reportForm, 'Vigente hasta / Guayaquil', null, 'datetime-local'), reportText = field(reportForm, 'Observacion', null, 'text');
reportSource.required = reportPublished.required = reportExpires.required = true; reportText.maxLength = 500;
reportPublished.value = localInput(); reportExpires.value = localInput(new Date(Date.now() + 2 * 86400000)); reportSource.placeholder = 'https://';
const saveReport = button('Guardar reporte', 'clipboard-plus'); saveReport.type = 'submit'; reportForm.append(saveReport); reportDetails.append(reportForm); panels.data.append(reportDetails);

let data, profileData, busy = false, currentView = 'individual', active = false, dailyData, lastAutoAttempt = 0;
const selection = () => ({ season: season.value, surface: surface.value, category: category.value, indoor: indoor.value, tournament: tournament.value.trim(), lookback: Number(lookback.value), bestOf: Number(bestOf.value), cutoff: `${cutoff.value}:00-05:00` });
function message(value = '', error = false) { status.textContent = value; status.classList.toggle('error', error); }
function show(id) {
  currentView = id;
  for (const [key, panel] of Object.entries(panels)) { panel.hidden = key !== id; tabs[key].classList.toggle('active', key === id); tabs[key].setAttribute('aria-selected', String(key === id)); tabs[key].tabIndex = key === id ? 0 : -1; }
  if (data && id === 'daily') task(renderDaily);
  if (data && id === 'evaluation') task(renderEvaluation);
}
nav.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const keys = Object.keys(tabs), index = keys.indexOf(currentView);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length;
  tabs[keys[next]].click(); tabs[keys[next]].focus();
});
async function task(action) {
  if (busy) return; busy = true; root.setAttribute('aria-busy', 'true');
  const controls = [...root.querySelectorAll('button, input, select')]; controls.forEach(node => { node.dataset.tennisDisabled = String(node.disabled); node.disabled = true; }); message();
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; controls.forEach(node => { node.disabled = node.dataset.tennisDisabled === 'true'; }); root.setAttribute('aria-busy', 'false'); window.lucide?.createIcons(); }
}
async function load() {
  data = await api(`state?${new URLSearchParams(selection())}`);
  filterSummary.textContent = `Filtros / ${season.value} / ${lookback.value} partidos / ${bestOf.value} sets`;
  const selector = (control, choices) => { const old = control.value; control.replaceChildren(option('', 'Seleccionar jugador'), ...choices.map(row => option(row.key, `${row.name} (${row.n})`))); if (choices.some(row => row.key === old)) control.value = old; };
  for (const control of [player, playerA, playerB, fixtureA, fixtureB, reportPlayer]) selector(control, data.players);
  const oldMetric = metric.value; metric.replaceChildren(...Object.entries(data.metrics).map(([value, label]) => option(value, label))); metric.value = oldMetric;
  tournamentList.replaceChildren(...data.tournaments.map(name => option(name, name)));
  const latest = data.coverage.datasets.map(row => row.loadedAt).filter(Boolean).sort().at(-1);
  dataStatus.textContent = `${data.coverage.usable} resultados admisibles / ${data.players.length} jugadores / Ultima descarga ${date(latest)}`;
  kpis(coverageKpis, [['Resultados con filtros', data.coverage.results], ['Con servicio', data.coverage.serviceMatches], ['Con quiebres', data.coverage.breakMatches], ['Fecha exacta', data.coverage.exactDates], ['Semana del torneo', data.coverage.approximateDates], ['Retiros excluidos', data.coverage.excludedRetirements]]);
  coverageNote.textContent = `${data.notice} Ultima fecha de torneo en la seleccion: ${data.coverage.latestTournamentDate?.slice(0, 10) || 's/d'}. Calendario guardado: ${data.fixtures.length}.`;
  datasetTable.fill(data.coverage.datasets.map(row => [row.season, row.n, date(row.loadedAt), row.source, `v${row.parserVersion}`]));
  renderCalendar();
}
const relevantPlayer = mountRelevantContext(profileResult), relevantMatch = mountRelevantContext(compareResult);
function renderProfile(result) {
  profileData = result; profileResult.hidden = false; profileTitle.textContent = `${result.player.name} / ${data.metrics[result.metric]}`;
  relevantPlayer.show({ ...selection(), sport: 'tennis', kind: 'player', key: 'atp', playerKey: result.player.key });
  kpis(profileKpis, [['Partidos de la muestra', result.record.n], ['Victorias', result.record.wins], ['Derrotas', result.record.losses], ['Ventana solicitada', result.lookback]]);
  warnings.replaceChildren(...result.warnings.map(text => el('li', text)));
  summaryTable.fill(result.summary.map(item => [item.label, num(item.average), item.n, item.missing]));
  ratiosTable.fill(result.ratios.map(item => [item.label, pct(item.percentage), `${item.numerator} / ${item.denominator}`, item.n, item.missing]));
  lineTable.fill(result.lines.map(item => [`${item.direction === 'over' ? 'Over' : 'Under'} ${item.line}`, countLabel(item), pct(item.frequency), interval(item), item.missing]));
  rangeTable.fill(result.ranges.map(item => [`${item.from}${item.to === null ? '+' : ` a ${item.to}`}`, countLabel(item), pct(item.frequency), interval(item), item.missing]));
  const context = result.context;
  kpis(contextKpis, [['Partidos 7 dias / fecha exacta', num(context.matches7Days)], ['Partidos 14 dias / fecha exacta', num(context.matches14Days)], ['Minutos 14 dias / muestra parcial', num(context.minutes14Days)], ['Partidos con duracion / 14 dias', context.durationMatches], ['Dias desde ultima fecha exacta', num(context.daysSinceLast)], ['Ranking historico', num(context.historicalRanking?.rank)]]);
  const report = context.availability;
  availabilityNote.replaceChildren(el('span', report && !report.stale ? `${report.name}: ${report.status}. Publicado ${date(report.publishedAt)}; vigente hasta ${date(report.expiresAt)}. ${report.note} ` : 'Disponibilidad actual no confirmada. Los descansos y minutos solo incluyen fechas exactas guardadas; una muestra parcial no acredita la carga completa. '));
  if (report) availabilityNote.append(sourceLink(report.sourceUrl));
  historyTable.fill(result.history.map(row => [matchDate(row), row.opponent, row.tournament, row.surface, row.values.won ? 'G' : 'P', row.score || 's/d', num(row.values.aces), num(row.values.doubleFaults), num(row.values.breaks)]));
}
async function analyzePlayer() { renderProfile(await api('player', { ...selection(), playerKey: player.value, metric: metric.value, ...(customLine.value ? { line: Number(customLine.value) } : {}) })); }
profileForm.addEventListener('submit', event => { event.preventDefault(); task(analyzePlayer); });
for (const control of [player, metric, customLine]) control.addEventListener('change', () => { profileResult.hidden = true; profileData = null; });
async function compare() {
  const result = await api('comparison', { ...selection(), gamesLine: Number(gamesLine.value), player1Key: playerA.value, player2Key: playerB.value }); compareResult.hidden = false;
  relevantMatch.show({ ...selection(), sport: 'tennis', kind: 'player', key: 'atp', playerKeys: [result.a.player.key, result.b.player.key] });
  compareTitle.textContent = `${result.a.player.name} / ${result.b.player.name}`; compareNote.textContent = result.note;
  compareStats.fill([['Partidos', result.a.record.n, result.b.record.n], ['Victorias / derrotas', `${result.a.record.wins} / ${result.a.record.losses}`, `${result.b.record.wins} / ${result.b.record.losses}`],
    ...result.a.summary.map((item, i) => [item.label, `${num(item.average)} (n=${item.n})`, `${num(result.b.summary[i].average)} (n=${result.b.summary[i].n})`]),
    ['Ranking historico', num(result.a.context.historicalRanking?.rank), num(result.b.context.historicalRanking?.rank)],
    ['Descanso / muestra de fechas exactas', num(result.a.context.daysSinceLast), num(result.b.context.daysSinceLast)],
    ['Disponibilidad reportada', result.a.context.availability?.status || 'No confirmada', result.b.context.availability?.status || 'No confirmada']]);
  estimatesTable.fill(result.estimates.map(item => [item.label, pct(item.probability), `${item.samples.home} / ${item.samples.away}`, item.samples.league]));
  scenariosTable.fill(result.scenarios.map(item => [item.label, countLabel(item), pct(item.frequency), interval(item), item.missing]));
  h2h.fill(result.h2h.map(row => [matchDate(row), row.player1, row.player2, row.score || 's/d', row.surface]));
}
compareForm.addEventListener('submit', event => { event.preventDefault(); task(compare); });
for (const control of [playerA, playerB, gamesLine]) control.addEventListener('change', () => { compareResult.hidden = true; });
function renderCalendar() {
  calendarNote.textContent = `${data.fixtures.length} encuentros guardados. Sin feed automatico contratado; los registros manuales no acreditan resultados ni alineaciones.`;
  calendarTable.fill(data.fixtures.map(row => {
    const actions = el('div', '', 'tennis-row-actions'), open = button('', 'chart-no-axes-combined'); open.classList.add('icon-button'); open.title = open.ariaLabel = 'Ver prepartido';
    open.disabled = !row.player1Key || !row.player2Key;
    open.addEventListener('click', () => task(async () => {
      surface.value = row.surface; bestOf.value = String(row.bestOf); category.value = 'all'; tournament.value = ''; indoor.value = row.indoor || 'all'; cutoff.value = localInput();
      await load(); playerA.value = row.player1Key; playerB.value = row.player2Key; show('comparison'); await compare();
    })); actions.append(open);
    if (row.registeredAt) { const remove = button('', 'trash-2'); remove.classList.add('icon-button'); remove.title = remove.ariaLabel = 'Quitar encuentro sin pronostico'; remove.addEventListener('click', () => task(async () => { await api('fixtures/remove', { id: row.id }); await load(); })); actions.append(remove); }
    return [date(row.date), `${row.player1 || row.home} / ${row.player2 || row.away}`, row.tournament || 's/d', `${row.surface || 's/d'} / ${row.bestOf || 's/d'} sets`, row.sourceUrl ? sourceLink(row.sourceUrl) : 'Sin fuente verificada', actions];
  }), 'Sin calendario futuro cargado.'); window.lucide?.createIcons();
}
fixtureForm.addEventListener('submit', event => { event.preventDefault(); task(async () => {
  await api('fixtures', { ...selection(), tournament: fixtureTournament.value.trim(), category: fixtureCategory.value, surface: fixtureSurface.value, indoor: 'all', bestOf: Number(fixtureFormat.value),
    player1Key: fixtureA.value, player2Key: fixtureB.value, date: `${fixtureDate.value}:00-05:00`, sourceUrl: fixtureSource.value });
  await load(); message('Encuentro manual guardado con su fuente.');
}); });
async function renderDaily() {
  dailyData = await api(`daily?date=${dailyDate.value}`);
  const picks = dailyData.picks.filter(row => row.probability >= Number(minimum.value) && (dailyGroup.value === 'all' || row.group === dailyGroup.value));
  dailyNote.textContent = dailyData.notice;
  dailyTable.fill(picks.map(row => [date(row.fixture.date), `${row.fixture.player1} / ${row.fixture.player2}`, row.label, pct(row.probability), row.n, date(row.createdAt)]), 'Sin pronosticos futuros sellados para esta fecha y filtros.');
}
dailyForm.addEventListener('submit', event => { event.preventDefault(); task(renderDaily); });
prepareDaily.addEventListener('click', () => task(async () => {
  const result = await api('daily/prepare', { season: season.value, date: dailyDate.value }); await renderDaily();
  message(`${result.prepared} encuentros sellados. ${result.skipped.map(row => row.reason).join(' ') || 'No se reconstruyen pronosticos posteriores al inicio.'}`);
}));
async function renderEvaluation() {
  const result = await api('evaluation');
  evaluationNote.textContent = `${result.version}. Ventana prospectiva fija: 20. Experimental, sin calibracion ni rentabilidad. Invalidos: ${result.exclusions.invalid}; retiros: ${result.exclusions.retired}; cambios de formato: ${result.exclusions.formatChanged}; reprogramados: ${result.exclusions.rescheduled}. Resultados sin fecha exacta y coincidencia unica quedan pendientes.`;
  kpis(evaluationKpis, [['Pronosticos sellados', result.snapshots], ['Pendientes de resultado verificado', result.exclusions.pending], ['Error absoluto de juegos', num(result.gamesMAE)], ['Muestra de juegos', result.gamesN]]);
  evaluationTable.fill(result.groups.map(row => [row.group, row.n, pct(row.accuracy), num(row.brier), num(row.logLoss), row.missing]));
  const backtest = result.historical;
  backtestNote.textContent = backtest ? `${backtest.note} Evaluados: ${backtest.n}; omitidos: ${backtest.skipped}; acierto ${pct(backtest.accuracy)}; Brier ${num(backtest.brier)}; log loss ${num(backtest.logLoss)}; error de juegos ${num(backtest.gamesMAE)} (n=${backtest.gamesN}). Corte: ${date(backtest.config.cutoff)}, superficie: ${backtest.config.surface}, ventana: ${backtest.config.lookback}.` : 'Sin validacion retrospectiva guardada.';
  binsTable.fill((backtest?.bins || []).filter(row => row.n).map(row => [`${row.from} a ${row.to} %`, row.n, pct(row.predicted), pct(row.observed), interval(row)]));
}
evaluationButton.addEventListener('click', () => task(renderEvaluation));
backtestButton.addEventListener('click', () => task(async () => { message('Evaluando cronologicamente el historial...'); await api('backtest', selection()); await renderEvaluation(); message('Validacion temporal guardada, separada de los pronosticos prospectivos.'); }));
reportForm.addEventListener('submit', event => { event.preventDefault(); task(async () => {
  await api('availability', { ...selection(), playerKey: reportPlayer.value, status: reportStatus.value, sourceUrl: reportSource.value, publishedAt: `${reportPublished.value}:00-05:00`, expiresAt: `${reportExpires.value}:00-05:00`, note: reportText.value });
  profileResult.hidden = true; compareResult.hidden = true; message('Reporte guardado con fuente, publicacion y vigencia.');
}); });
refresh.addEventListener('click', () => task(async () => {
  message('Actualizando archivos gratuitos de la temporada y la anterior...');
  const result = await api('refresh', selection()); cutoff.value = currentCutoff(cutoff.type, cutoff.value, cutoff.dataset.liveManual === 'true'); await load(); profileResult.hidden = compareResult.hidden = true;
  message(result.warning || 'Historicos actualizados; cada campo conserva su cobertura real.', Boolean(result.warning));
}));
for (const control of [season, surface, category, indoor, tournament, lookback, bestOf, cutoff]) control.addEventListener('change', () => task(async () => { if (control === bestOf) gamesLine.value = bestOf.value === '5' ? '38.5' : '22.5'; profileResult.hidden = compareResult.hidden = true; await load(); }));
document.addEventListener('observatorio:sport', event => {
  active = event.detail === 'tennis'; root.hidden = !active;
  if (active) task(activate);
});
async function activate() {
  await load();
  if (dailyDate.value < localInput().slice(0, 10)) dailyDate.value = localInput().slice(0, 10);
  const latest = data.coverage.datasets.find(row => row.season === season.value);
  if ((!latest || latest.parserVersion < 2 || Date.now() - Date.parse(latest.loadedAt) > 6 * 3600000) && Date.now() - lastAutoAttempt > 15 * 60000) {
    lastAutoAttempt = Date.now();
    const result = await api('refresh', selection()); cutoff.value = currentCutoff(cutoff.type, cutoff.value, cutoff.dataset.liveManual === 'true'); await load();
    if (result.warning) message(result.warning, true);
  }
  if (currentView === 'daily') await renderDaily();
  if (currentView === 'evaluation') await renderEvaluation();
}
show('individual');
if (document.body.dataset.activeSport === 'tennis') { active = true; root.hidden = false; task(activate); }
window.lucide?.createIcons();
setInterval(() => { if (active && currentView === 'daily' && !busy) task(renderDaily); }, 60000);
onDataRefresh('tennis', () => active && !busy, () => task(async () => {
  const hadProfile = !profileResult.hidden, hadComparison = !compareResult.hidden;
  await load();
  if (currentView === 'individual' && hadProfile && player.value) await analyzePlayer();
  if (currentView === 'comparison' && hadComparison && playerA.value && playerB.value) await compare();
  if (currentView === 'daily') await renderDaily();
  if (currentView === 'evaluation') await renderEvaluation();
}));
