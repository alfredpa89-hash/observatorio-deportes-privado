import { mountPlayerMarkets } from './player-markets.js';
import { METRICS, PERIOD_LABELS, inspectGame, admissibleGame, periodRecords, usableHistory, replayHistory, parsePeriodImport, mergePersonalGames, playerKey, sourceDiscrepancies } from './basketball-periods-core.js';

const $ = id => document.getElementById(id);
const el = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
const row = values => { const element = el('tr'); element.append(...values.map(value => el('td', value))); return element; };
const num = value => value == null || !Number.isFinite(value) ? 's/d' : value.toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value == null ? 's/d' : `${num(value * 100)} %`;
const date = value => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const labels = { points: 'Puntos', conceded: 'Puntos recibidos', total: 'Total del encuentro', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA', threes: 'Triples' };
const leagues = { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa' };
const officialLinks = { nba: ['https://www.nba.com/stats/players/traditional', 'NBA Stats / gamebooks'], euroleague: ['https://www.euroleaguebasketball.net/euroleague/game-center/', 'Game Center'], endesa: ['https://live.acb.com/es', 'ACB Live'] };
const STORAGE = 'observatorio-period-records-v1';
let archive = { games: [], players: [] }, references = [], personal = [], request, revision = 0, widget, records = [], storageWarning = '';
const context = () => ({ league: $('br-league').value, season: $('br-season').value, depth: Number($('br-depth').value) });
const visible = () => !$('br-periods-view').hidden && !$('bb-research-view').hidden;
function message(text, error = false) { $('bp-status').textContent = text; $('bp-status').classList.toggle('error', error); }
function table(id, rows, columns, empty) {
  const body = $(id); body.replaceChildren(...rows);
  if (!rows.length) { const item = row([empty]); item.firstChild.colSpan = columns; body.append(item); }
}
function options(id, values) {
  const previous = $(id).value;
  $(id).replaceChildren(...values.map(([value, label]) => { const item = el('option', label); item.value = value; return item; }));
  if (values.some(([value]) => value === previous)) $(id).value = previous;
}
function sourceLink(url, label) {
  const link = el('a', label);
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return el('span', label); link.href = parsed.href; }
  catch { return el('span', label); }
  link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function kpis(id, values) { $(id).replaceChildren(...values.map(([label, value]) => { const item = el('div'); item.append(el('span', label), el('strong', value)); return item; })); }
function importShape(game) { return { ...game, id: game.id.replace(/^personal:/, '') }; }
function readPersonal() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || '{"schema":1,"games":[]}');
    if (stored.schema !== 1 || !Array.isArray(stored.games) || stored.games.length > 2000) throw new Error('Formato local no valido.');
    return stored.games.map(game => {
      const [checked] = parsePeriodImport({ schema: 1, license: game.license, games: [importShape(game)] }, { rightsConfirmed: true });
      checked.importedAt = Number.isFinite(Date.parse(game.importedAt)) ? game.importedAt : checked.importedAt; return checked;
    });
  } catch { storageWarning = 'No se pudo validar el archivo personal local. Se conserva sin sobrescribir; revisa tu copia exportada.'; return []; }
}
personal = readPersonal();
function allGames() { return $('bp-source').value === 'reference' ? references : $('bp-source').value === 'personal' ? personal : archive.games; }
function selectedGames() { const { league, season } = context(); return allGames().filter(game => game.league === league && game.season === season && admissibleGame(game)); }
async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`No se pudo leer el archivo (${response.status}).`); return response.json();
}
async function load(force = false) {
  const token = ++revision; message('Leyendo registros guardados; sin consultas al proveedor...');
  try {
    if (force || !request) request = Promise.all([readJson('/api/basketball/research/export'), readJson('/data/quarter-reference.json')]);
    const [data, sample] = await request;
    if (token !== revision) return;
    archive = data.archive; references = sample.games.map(game => ({ ...game, referenceOnly: true }));
    render(true);
    message(storageWarning || 'Datos guardados y muestras oficiales separados. La prueba de octubre permanece intacta.', Boolean(storageWarning));
  } catch (error) { if (token === revision) { request = undefined; message(`${error.message} Se conservan los registros locales.`, true); render(true); } }
}
function resetReplay() {
  $('bp-replay-status').textContent = ''; $('bp-replay-kpis').replaceChildren();
  table('bp-replay-rows', [], 8, 'Sin comprobación para esta selección.'); table('bp-calibration', [], 4, 'Sin evaluación.');
}
function suggestedLine(kind, metric, period, league) {
  if (kind === 'players') return metric === 'pra' ? 9.5 : metric === 'points' ? 4.5 : .5;
  if (period === 'ot') return .5;
  const nba = league === 'nba';
  if (metric === 'total') return period === 'ft' ? nba ? 220.5 : 160.5 : period === 'ht' ? nba ? 110.5 : 80.5 : nba ? 55.5 : 40.5;
  return period === 'ft' ? nba ? 109.5 : 79.5 : period === 'ht' ? nba ? 54.5 : 39.5 : nba ? 26.5 : 19.5;
}
function renderSelectors() {
  const games = selectedGames(), kind = $('bp-kind').value;
  options('bp-team', [['', 'Todos los equipos'], ...[...new Set(games.flatMap(game => [game.home, game.away]))].sort((a, b) => a.localeCompare(b, 'es')).map(name => [name, name])]);
  const team = $('bp-team').value;
  if (kind === 'teams') {
    options('bp-entity', [...new Set(games.flatMap(game => [game.home, game.away]))].filter(name => !team || name === team).sort((a, b) => a.localeCompare(b, 'es')).map(name => [name, name]));
    options('bp-metric', ['points', 'conceded', 'total'].map(key => [key, labels[key]]));
  } else {
    const players = new Map(); games.flatMap(game => game.players || []).filter(player => !team || player.team === team).forEach(player => players.set(playerKey(player), player));
    options('bp-entity', [...players].sort((a, b) => a[1].name.localeCompare(b[1].name, 'es')).map(([key, player]) => [key, `${player.name} · ${player.team}`]));
    options('bp-metric', METRICS.map(key => [key, labels[key]]));
  }
  if (!$('bp-entity').options.length) options('bp-entity', [['', kind === 'players' ? 'Sin registros individuales por cuarto' : 'Sin equipos en esta selección']]);
  $('bp-entity-label').textContent = kind === 'players' ? 'Jugador a estudiar' : 'Equipo a estudiar';
}
function renderCoverage() {
  const { season } = context();
  table('bp-coverage', Object.entries(leagues).map(([league, name]) => {
    const games = archive.games.filter(game => game.league === league && game.season === season && admissibleGame(game));
    const complete = games.filter(game => inspectGame(game).complete).length;
    const samples = references.filter(game => game.league === league);
    const item = row([name, `${complete} / ${games.length} · ${season}`, samples.length ? `${samples.reduce((sum, game) => sum + game.players.length, 0)} jugadores · ${samples.map(game => game.season).join(', ')} · ${samples.length} partido(s)` : 'Sin muestra individual verificada']);
    const cell = el('td'); cell.append(sourceLink(...officialLinks[league]), el('div', league === 'euroleague' ? 'Acceso directo no disponible; no se automatiza la descarga.' : 'Muestras técnicas puntuales, no conexión continua.')); item.append(cell); return item;
  }), 4, 'Sin cobertura verificada.');
}
function renderQuality() {
  const games = selectedGames(), rows = [];
  for (const game of games) {
    const quality = inspectGame(game);
    if (!quality.valid) rows.push(row([`${game.home} - ${game.away}`, 'Inconsistente; excluido', quality.errors.join('; ')]));
  }
  const conflicts = usableHistory(records, context().depth).conflicts;
  conflicts.forEach(record => rows.push(row([`${record.name} / ${record.opponent}`, 'Fuentes discrepantes; excluido', `${date(record.date)} · ${PERIOD_LABELS[$('bp-period').value]}`])));
  const { league, season } = context();
  for (const { game, player, log, changes } of sourceDiscrepancies(references.filter(game => game.league === league && game.season === season), archive.players))
    rows.push(row([`${player.name} · ${date(game.date)}`, 'Diferencia entre fuentes en el final', changes.map(metric => `${labels[metric]}: ${num(log.values[metric])} (${log.source}) / ${num(player.periods.ft[metric])} (${game.source})`).join('; ')]));
  const valid = games.filter(game => inspectGame(game).complete).length;
  $('bp-quality-status').textContent = `${valid} de ${games.length} partidos con 4 cuartos consistentes. ${rows.length} observaciones. Sin sobrescribir fuentes ni alterar registros sellados.`;
  table('bp-quality', rows.slice(0, 100), 3, games.length ? 'Sin inconsistencias detectadas en los campos disponibles. No certifica cobertura completa.' : 'Sin registros para comprobar.');
}
function render(selectors = false) {
  if (selectors) renderSelectors();
  resetReplay(); widget?.dispose(); widget = undefined;
  const { league, season, depth } = context(), kind = $('bp-kind').value, period = $('bp-period').value, metric = $('bp-metric').value;
  records = periodRecords(selectedGames(), { league, season, kind, period, metric, entity: $('bp-entity').value });
  const history = usableHistory(records, depth), display = records.slice(0, depth);
  const average = history.values.length ? history.values.reduce((sum, record) => sum + record.value, 0) / history.values.length : null;
  const reference = $('bp-source').value === 'reference';
  $('bp-context').textContent = `${leagues[league]} · ${season} · ${PERIOD_LABELS[period]} · ${labels[metric] || ''} · Ventana de ${depth} partidos`;
  kpis('bp-kpis', [['Registros visibles', num(display.length)], ['Valores válidos para frecuencias', num(history.values.length)], ['Promedio del período', num(average)], ['Faltantes / sin participación', num(history.window.length - history.values.length)]]);
  $('bp-record-title').textContent = kind === 'players' ? 'Registros individuales del período' : 'Resultados del equipo por período';
  const headers = kind === 'players' ? ['Fecha · Guayaquil', 'Jugador / rival', 'Minutos', 'Puntos', 'Rebotes', 'Asistencias', 'PRA', 'Triples', 'Fuente / calidad'] : ['Fecha · Guayaquil', 'Equipo / rival', 'A favor', 'En contra', 'Valor seleccionado', 'Fuente / calidad'];
  const head = el('tr'); head.append(...headers.map(label => el('th', label))); $('bp-record-head').replaceChildren(head);
  const rows = display.map(record => {
    const item = kind === 'players' ? row([date(record.date), `${record.name} / ${record.opponent}`, num(record.minutes), ...METRICS.map(key => num(record.values?.[key]))]) : row([date(record.date), `${record.name} / ${record.opponent}`, num(record.scored), num(record.conceded), num(record.value)]);
    const cell = el('td'); cell.append(sourceLink(record.sourceUrl, record.source || 'Guardado'), el('div', !record.valid ? 'Inconsistente; excluido' : record.referenceOnly ? 'Referencia oficial; fuera del modelo' : record.value == null ? 'Dato del período ausente' : record.minutes === 0 ? 'Sin participación' : 'Dato registrado'));
    item.append(cell); return item;
  });
  const ftOnly = archive.players.filter(player => player.league === league && player.season === season).length;
  table('bp-records', rows, headers.length, kind === 'players' ? `Sin datos individuales por cuarto en esta selección. ${ftOnly} registros finales disponibles en Partidos y jugadores; no se dividen entre cuatro.` : 'Sin registros de esta temporada y fuente.');
  $('bp-frequency-note').textContent = reference ? 'Muestra oficial de referencia: excluida de frecuencias, comprobaciones y pronósticos.' : `${history.values.length} valores utilizables de ${history.window.length} partidos únicos; ${history.conflicts.length} conflictos excluidos. Frecuencia observada, no probabilidad validada del próximo partido.`;
  $('bp-frequency-section').hidden = reference;
  if (!reference) {
    const defaultLine = suggestedLine(kind, metric, period, league);
    const from = kind === 'players' ? .5 : Math.max(.5, defaultLine - 15), to = kind === 'players' ? 24.5 : defaultLine + 15;
    const initialLines = Array.from({ length: Math.floor(to - from) + 1 }, (_, index) => from + index);
    widget = mountPlayerMarkets($('bp-markets'), { metric: 'period-value', initialLines, defaultLine,
      history: history.window.map(record => ({ ...(record.minutes === undefined ? {} : { minutes: record.minutes }), values: { 'period-value': record.value } })) });
  }
  $('bp-line').value = String(suggestedLine(kind, metric, period, league));
  $('bp-replay').disabled = reference || history.values.length < 5;
  renderCoverage(); renderQuality();
}

$('bp-replay-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if ($('bp-source').value === 'reference') throw new Error('Las referencias oficiales no entran en esta comprobación.');
    const result = replayHistory(records, { line: Number($('bp-line').value), depth: context().depth });
    $('bp-replay-status').textContent = `${result.n} resultados comprobados en orden cronológico; ${result.missing} faltantes o sin participación y ${result.conflicts} conflictos excluidos. Detalle de los últimos 25 resultados. No cambia la calibración de octubre.`;
    kpis('bp-replay-kpis', [['Muestra evaluada', num(result.n)], ['Acierto descriptivo', pct(result.accuracy)], ['Brier', num(result.brier)], ['Error absoluto medio', num(result.mae)]]);
    $('bp-replay-status').textContent += ` Log loss: ${num(result.logLoss)}.`;
    table('bp-replay-rows', result.outcomes.slice(-25).reverse().map(item => row([date(item.date), item.opponent, item.n, pct(item.probability), num(item.expected), item.value, item.actual ? 'Sí' : 'No', num(item.error)])), 8, 'Se necesitan al menos 5 partidos previos utilizables y un resultado posterior.');
    table('bp-calibration', result.bins.filter(bin => bin.n).map(bin => row([`${bin.from}–${bin.to} %`, bin.n, pct(bin.predicted), pct(bin.observed)])), 4, 'Sin muestra evaluable.');
  } catch (error) { $('bp-replay-status').textContent = error.message; }
});
$('bp-import-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (storageWarning) throw new Error(storageWarning);
    const file = $('bp-file').files[0]; if (!file || file.size > 2 * 1024 * 1024) throw new Error('Selecciona un JSON de hasta 2 MB.');
    const incoming = parsePeriodImport(JSON.parse(await file.text()), { rightsConfirmed: $('bp-rights').checked });
    const merged = mergePersonalGames(personal, incoming), serialized = JSON.stringify({ schema: 1, games: merged.games });
    if (serialized.length > 4 * 1024 * 1024) throw new Error('Archivo local demasiado grande; conserva una exportación.');
    localStorage.setItem(STORAGE, serialized); personal = merged.games;
    const first = incoming[0]; $('br-league').value = first.league; $('br-season').value = first.season;
    $('br-league').dispatchEvent(new Event('change')); $('bp-source').value = 'personal'; render(true);
    message(`${merged.added} partidos personales incorporados. Fuentes y valores originales conservados; sin modificar la prueba de octubre.`);
    $('bp-file').value = ''; $('bp-rights').checked = false;
  } catch (error) { message(`${error.message} No se guardó esta importación.`, true); }
});
$('bp-export').addEventListener('click', () => {
  if (storageWarning) { message(storageWarning, true); return; }
  const data = { schema: 1, license: 'Archivo personal. Las autorizaciones originales constan en license de cada partido.', games: personal.map(importShape) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = 'baloncesto-cuartos-personal.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`${personal.length} partidos personales exportados. Sin claves ni datos de la prueba de octubre.`);
});
$('bp-reload').addEventListener('click', () => load(true));
$('bp-historical').addEventListener('click', () => { $('br-season').value = '2024/2025'; $('bp-source').value = 'archive'; $('br-season').dispatchEvent(new Event('change')); });
$('bp-source').addEventListener('change', () => {
  const { league, season } = context();
  const samples = references.filter(game => game.league === league);
  if ($('bp-source').value === 'reference' && samples.length && !samples.some(game => game.season === season)) {
    $('br-season').value = [...samples].sort((a, b) => b.season.localeCompare(a.season))[0].season;
    $('br-season').dispatchEvent(new Event('change'));
  }
  render(true);
});
for (const id of ['bp-kind', 'bp-team']) $(id).addEventListener('change', () => render(true));
for (const id of ['bp-entity', 'bp-period', 'bp-metric']) $(id).addEventListener('change', () => render());
for (const id of ['br-league', 'br-season', 'br-depth']) $(id).addEventListener('change', () => { if (visible()) load(); });
document.querySelector('[data-research-view="periods"]').addEventListener('click', () => load());
new MutationObserver(changes => {
  if (changes.some(change => change.attributeName === 'aria-busy') && $('bb-research-view').getAttribute('aria-busy') === 'false' && visible()) load(true);
}).observe($('bb-research-view'), { attributes: true, attributeFilter: ['aria-busy'] });
