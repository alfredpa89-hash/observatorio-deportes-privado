import { jsonRequest } from './api-client.js';
import { mountPlayerMarkets } from './player-markets.js';
import { mountBasketballPlayerTools } from './basketball-player-tools.js';
import { mountBasketballPrematch } from './basketball-prematch.js';
import { mountBasketballTeams } from './basketball-teams.js';
import { onDataRefresh } from './live-refresh.js';
import { mountRelevantContext } from './relevant-context.js';
import { basketballTeamEvidence, evidenceSampleLabel, renderBasketballEvidence } from './basketball-evidence.js';
const $ = id => document.getElementById(id);
const relevantContext = mountRelevantContext($('bb-report'));
const playerTools = mountBasketballPlayerTools($('bb-player-lab'));
const prematch = mountBasketballPrematch($('bb-prematch-view'));
const individual = mountBasketballTeams($('bb-individual-view'));
const el = (tag, text = '', className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const option = (value, label) => { const node = el('option', label); node.value = value; return node; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value == null ? 's/d' : `${num(value)} %`;
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)) : 's/d';
const localInstant = () => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); const get = type => parts.find(part => part.type === type).value; return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`; };
const labels = { winner: 'Ganador FT', total: 'Total FT', spread: 'Handicap FT', 'q1-total': 'Total 1Q', 'ht-total': 'Total descanso', 'q1-winner': 'Local gana 1Q (si/no)', 'ht-winner': 'Local gana descanso (si/no)', 'player-points': 'Jugador: puntos', 'player-rebounds': 'Jugador: rebotes', 'player-assists': 'Jugador: asistencias', 'player-pra': 'Jugador: PRA', 'player-threes': 'Jugador: triples' };
let state, active = false, busy = false, calendar = [];
let playerMarkets, playerRevision = 0;
let selectedReport;
const conditionField = el('label', '', 'field basket-condition'), conditionSelect = el('select'), conditionEvidence = el('div');
conditionField.append(el('span', 'Condicion a revisar'), conditionSelect);
$('bb-market-list').before(conditionField, conditionEvidence);
function renderCondition() {
  const market = selectedReport?.markets.find(item => item.id === conditionSelect.value);
  if (!market) { conditionEvidence.replaceChildren(); return; }
  const evidence = basketballTeamEvidence(selectedReport.history, market.spec, selectedReport.meta);
  renderBasketballEvidence(conditionEvidence, evidence, { label: market.label, probability: market.probability, modeled: true });
  const counts = ['home', 'away'].map(side => {
    const sample = market.observed?.[side];
    return sample ? `${side === 'home' ? 'Local' : 'Visitante'}: ${sample.hits} de ${sample.n} partidos cumplieron la condicion` : '';
  }).filter(Boolean);
  if (counts.length) conditionEvidence.append(el('p', `${counts.join(' | ')}. Historiales separados por equipo.`));
}
conditionSelect.addEventListener('change', renderCondition);
function invalidatePlayer() { playerRevision++; playerMarkets?.dispose(); $('bb-player-markets').hidden = true; $('bb-player-body').replaceChildren(); $('bb-player-result').textContent = 'Selecciona un jugador con historial y analiza la selección.'; }
async function api(path, body) {
  return jsonRequest(`/api/basketball/${path}`, body);
}
const league = () => $('bb-league').value;
const selected = () => state?.leagues.find(row => row.key === league());
const dataset = () => selected()?.datasets.find(row => row.season === $('bb-season').value);
const predictive = () => selected()?.predictionSupported !== false;
function modelControls() {
  for (const id of ['bb-total', 'bb-spread', 'bb-quarter', 'bb-half', 'bb-minutes', 'bb-player-status']) {
    $(id).disabled = !predictive(); $(id).closest('.field').hidden = !predictive();
  }
  $('bb-backtest').disabled = busy || !predictive();
  $('bb-import-form').hidden = !predictive();
  $('bb-player-projection').hidden = !predictive();
}
const selection = () => ({ league: league(), season: $('bb-season').value, lookback: Number($('bb-depth').value),
  cutoff: `${$('bb-cutoff').value}:00-05:00`, home: $('bb-home').value, away: $('bb-away').value,
  totalLine: Number($('bb-total').value), spreadLine: Number($('bb-spread').value), quarterLine: Number($('bb-quarter').value), halfLine: Number($('bb-half').value) });
function message(text = '', error = false) { $('bb-message').textContent = text; $('bb-message').classList.toggle('error', error); }
async function task(action) {
  if (busy) return; busy = true;
  const buttons = [...$('basketball-workspace').querySelectorAll('button, input, select')].filter(button => !button.closest('#bb-research-view, #bb-daily-view, #bb-prematch-view, #bb-individual-view')); buttons.forEach(button => { button.dataset.wasDisabled = button.disabled ? 'yes' : 'no'; button.disabled = true; });
  $('basketball-workspace').setAttribute('aria-busy', 'true'); message();
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; buttons.forEach(button => { button.disabled = button.dataset.wasDisabled === 'yes'; }); $('bb-start').disabled = Boolean(state?.trial.startedAt); modelControls(); $('basketball-workspace').setAttribute('aria-busy', 'false'); }
}
function empty(body, columns, text) { const cell = el('td', text); cell.colSpan = columns; const row = el('tr'); row.append(cell); body.replaceChildren(row); }
function row(values) { const item = el('tr'); values.forEach(value => item.append(el('td', value))); return item; }
function summaryRows(id, summary = {}) {
  const body = $(id); body.replaceChildren();
  for (const [group, result] of Object.entries(summary)) body.append(row([labels[group] || group, result.n, pct(result.accuracy), num(result.brier), num(result.logLoss), result.missing]));
  if (!Object.keys(summary).length) empty(body, 6, 'Sin escenarios evaluables todavía.');
}
function renderTrial() {
  const trial = state.trial, result = trial.perLeague[league()] || {};
  $('bb-trial-status').textContent = trial.active ? 'Seguimiento manual activo · Guayaquil' : 'Datos e historiales · Guayaquil';
  $('bb-trial-status').title = trial.startedAt ? `Inicio: ${date(trial.startedAt)}. Última revisión: ${date(trial.lastRun)}.` : 'Prueba no iniciada.';
  $('bb-start').disabled = Boolean(trial.startedAt);
  $('bb-kpis').replaceChildren(...[[predictive() ? 'Resultados para el modelo' : 'Resultados guardados', dataset()?.history || 0], [predictive() ? 'Registros para el modelo' : 'Participaciones guardadas', dataset()?.players || 0], ['Pronosticos sellados', result.frozen || 0], ['Partidos evaluados', result.completed || 0]].map(([label, value]) => {
    const item = el('div'); item.append(el('span', label), el('strong', num(value))); return item;
  }));
  summaryRows('bb-prospective-body', result.summary);
  $('bb-prospective-note').textContent = `${result.completed || 0} finalizados · ${result.pending || 0} pendientes · ${result.missingMarkets || 0} escenarios sin resultado · ${result.rescheduled || 0} reprogramados excluidos · ${result.invalid || 0} registros con integridad invalida. Error total: ${num(result.mae?.ft?.value)} puntos; referencia: ${num(result.baseline?.totalMae)}. Brier ganador de referencia: ${num(result.baseline?.brier)}. ${result.note || 'Se incluyen solo pronosticos guardados antes del partido.'} ${trial.rule || ''}`;
  if (!predictive()) $('bb-prospective-note').textContent = selected().note;
  const calibration = result.summary?.winner?.bins || [];
  $('bb-calibration-body').replaceChildren(...calibration.filter(bin => bin.n).map(bin => row([`${bin.from}-${bin.to} %`, bin.n, pct(bin.predicted), pct(bin.observed), `${pct(bin.low)} a ${pct(bin.high)}`])));
  if (!calibration.some(bin => bin.n)) empty($('bb-calibration-body'), 5, 'Sin resultados suficientes para comparar probabilidades.');
  const frozen = trial.snapshots.filter(item => item.league === league());
  $('bb-frozen-body').replaceChildren(...frozen.map(item => row([`${item.fixture.home} - ${item.fixture.away}`, date(item.fixture.date), date(item.createdAt), item.version, item.markets.filter(market => market.probability !== null).length])));
  if (!frozen.length) empty($('bb-frozen-body'), 5, 'Sin pronosticos sellados en esta competicion.');
}
function controls() {
  const previousSeason = $('bb-season').value;
  $('bb-season').replaceChildren(...(selected()?.seasons || []).map(season => option(season, season)));
  if ([...$('bb-season').options].some(item => item.value === previousSeason)) $('bb-season').value = previousSeason;
  const set = dataset();
  $('bb-connect').textContent = state.connected ? 'Conexion API' : 'Conectar API';
  for (const id of ['bb-home', 'bb-away']) { const previous = $(id).value; $(id).replaceChildren(option('', 'Seleccionar equipo'), ...(set?.teams || []).map(name => option(name, name))); if (set?.teams.includes(previous)) $(id).value = previous; }
  const previous = $('bb-player').value; $('bb-player').replaceChildren(option('', 'Seleccionar jugador'), ...(set?.playerNames || []).map(name => option(name, name)));
  if (set?.playerNames.includes(previous)) $('bb-player').value = previous;
  $('bb-data-status').textContent = predictive() ? `${selected().name} · Historial para pronosticos: ${set.history} resultados · ${set.fixtures} encuentros · ${set.paceGames} partidos con datos de posesiones · ${set.source}`
    : `${selected().name} / ${set.season}: ${set.matches} resultados de la temporada, ${set.history} resultados incluyendo historicos anteriores y ${set.fixtures} encuentros futuros. ${selected().note}`;
  $('bb-connection').textContent = `${state.connected ? 'Clave conectada' : 'Sin clave: conexion API-Basketball pendiente'} · Plan ${state.requestPolicy?.plan || 'sin verificar'} · Consultas locales ${state.quota.used || 0}/${state.requestPolicy?.usable ?? 90} · ${state.quota.day || 'sin solicitudes'}. Reserva ${state.requestPolicy?.reserve ?? 10}. Cuota compartida con otros usos de tu cuenta.`;
  renderTrial();
  modelControls();
  playerTools.setContext({ league: league(), season: $('bb-season').value, lookback: Number($('bb-depth').value), cutoff: `${$('bb-cutoff').value}:00-05:00` });
}
async function loadState() { state = await api('state'); controls(); }
function renderReport(report) {
  selectedReport = report;
  const previousCondition = conditionSelect.value;
  conditionSelect.replaceChildren(...report.markets.map(market => option(market.id, market.label)));
  if (report.markets.some(market => market.id === previousCondition)) conditionSelect.value = previousCondition;
  conditionField.hidden = !report.markets.length; conditionEvidence.hidden = !report.markets.length;
  renderCondition();
  relevantContext.show({ sport: 'basketball', kind: 'team', key: report.meta.league || league(), season: report.meta.season || $('bb-season').value,
    names: [report.meta.home, report.meta.away], lookback: report.meta.lookback, cutoff: report.meta.cutoff });
  $('bb-report').hidden = false;
  $('bb-match-title').textContent = `${report.meta.home} - ${report.meta.away}`;
  $('bb-match-context').textContent = `${report.meta.competition} · Corte ${date(report.meta.cutoff)} · ${report.meta.lookback} partidos`;
  $('bb-market-list').replaceChildren(...report.markets.map(market => {
    const item = el('div', '', 'market-row'), description = el('div'); description.append(el('div', market.label, 'market-title'), el('div', `${market.calibrated ? `Calibracion historica n=${market.calibrationN}` : 'Experimental, sin calibracion suficiente'} · Muestra minima ${market.n}`, 'market-detail'));
    const track = el('div', '', 'prob-track'), fill = el('div', '', 'prob-fill'); fill.style.width = `${market.probability || 0}%`; track.append(fill);
    const evidence = basketballTeamEvidence(report.history, market.spec, report.meta);
    description.append(el('div', `${evidence.label} / ${evidenceSampleLabel(evidence)}`, 'market-detail'));
    item.append(description, track, el('div', pct(market.probability), 'prob-value')); return item;
  }));
  if (report.meta.descriptive) $('bb-market-list').append(el('p', report.meta.model, 'calendar-note'));
  const headers = $('bb-period-body').closest('table').querySelectorAll('th');
  ['Periodo', report.meta.descriptive ? 'Media a favor local' : 'Local esperado', report.meta.descriptive ? 'Media a favor visitante' : 'Visitante esperado', report.meta.descriptive ? 'Suma de medias' : 'Total esperado', 'Muestra L/V'].forEach((label, index) => { headers[index].textContent = label; });
  $('bb-method').textContent = report.meta.model;
  $('bb-quality').replaceChildren(...report.quality.messages.map(text => el('li', text)));
  $('bb-period-body').replaceChildren(...Object.entries(report.meta.periods).map(([period, result]) => row([{ ft: 'Partido completo', q1: 'Primer cuarto', ht: 'Descanso' }[period], num(result?.home), num(result?.away), num(result?.total), `${result?.homeN || 0} / ${result?.awayN || 0}`])));
}
async function renderList() {
  const result = await api('list', selection()); calendar = result.fixtures;
  $('bb-calendar-note').textContent = result.note || '';
  $('bb-calendar-body').replaceChildren(...calendar.map(game => {
    const market = id => game.report?.markets.find(item => item.id === id)?.probability;
    const item = row([date(game.date), `${game.home} - ${game.away}`, ...['home-win', 'away-win', 'total-over', 'q1-total-over', 'ht-total-over'].map(id => pct(market(id)))]);
    const actions = el('td'), button = el('button', 'Abrir', 'button button-secondary'); button.type = 'button';
    button.addEventListener('click', () => { $('bb-home').value = game.home; $('bb-away').value = game.away; if (game.report) renderReport(game.report); else task(async () => renderReport(await api('report', selection()))); });
    const context = el('button', '', 'button button-secondary icon-button'), icon = el('i'); icon.dataset.lucide = 'clipboard-list'; icon.setAttribute('aria-hidden', 'true');
    context.append(icon); context.type = 'button'; context.title = `Ver prepartido de ${game.home} - ${game.away}`; context.setAttribute('aria-label', context.title);
    context.addEventListener('click', () => { const scope = { league: league(), season: $('bb-season').value, fixtureId: game.id };
      document.querySelector('[data-basket-view="prematch"]').click(); prematch.open(scope); });
    actions.append(button, context); item.append(actions); return item;
  }));
  if (!calendar.length) empty($('bb-calendar-body'), 8, dataset().history ? 'Sin calendario futuro guardado para el corte elegido.' : 'Sin datos de esta competicion: conecta la clave gratuita o importa un CSV personal.');
  window.lucide?.createIcons();
}
async function renderEvaluation() {
  const result = await api(`evaluation?league=${league()}`);
  summaryRows('bb-backtest-body', result?.summary);
  if (result?.unavailable) { $('bb-evaluation-note').textContent = result.note; return; }
  $('bb-evaluation-note').textContent = result ? `${result.n} partidos de validacion · ${result.skipped} omitidos por muestra · Error total ${num(result.mae.ft)} puntos; referencia ${num(result.mae.baseline)} · Error 1Q ${num(result.mae.q1)}; descanso ${num(result.mae.ht)}. Ganador de referencia: acierto ${pct(result.baseline.accuracy)}, Brier ${num(result.baseline.brier)}. ${result.method} ${result.note}` : 'Pendiente de comprobacion historica. Se necesita historial; la prueba de octubre es independiente.';
}
async function refreshVisibleData() {
  if (!$('bb-calendar-view').hidden) await renderList();
  if (!$('bb-evaluation-view').hidden) await renderEvaluation();
}
document.addEventListener('observatorio:sport', event => {
  active = event.detail === 'basketball';
  if (active) task(async () => { if (!$('bb-cutoff').value) $('bb-cutoff').value = localInstant(); await loadState(); await refreshVisibleData(); if (!$('bb-prematch-view').hidden) await prematch.activate(); if (!$('bb-individual-view').hidden) await individual.activate(); });
});
$('bb-league').addEventListener('change', () => task(async () => {
  invalidatePlayer();
  const config = selected(); $('bb-total').value = config.total; $('bb-quarter').value = config.quarter; $('bb-half').value = config.half;
  $('bb-report').hidden = true; $('bb-player-body').replaceChildren(); $('bb-player-result').textContent = 'Selecciona un jugador con historial.'; controls(); await refreshVisibleData();
}));
for (const id of ['bb-season', 'bb-depth', 'bb-cutoff']) $(id).addEventListener('change', () => { invalidatePlayer(); task(async () => { $('bb-report').hidden = true; controls(); await refreshVisibleData(); }); });
document.querySelectorAll('[data-basket-view]').forEach(button => button.addEventListener('click', () => {
  for (const view of ['prematch', 'individual', 'daily', 'calendar', 'players', 'evaluation', 'research']) $(`bb-${view}-view`).hidden = view !== button.dataset.basketView;
  const archive = ['research', 'daily', 'prematch', 'individual'].includes(button.dataset.basketView);
  $('bb-league').closest('.basket-filters').hidden = archive;
  $('bb-data-status').hidden = archive; $('bb-kpis').hidden = archive;
  document.querySelectorAll('[data-basket-view]').forEach(item => { const current = item === button; item.classList.toggle('active', current); item.setAttribute('aria-selected', String(current)); item.tabIndex = current ? 0 : -1; });
  if (button.dataset.basketView === 'prematch') prematch.activate();
  if (button.dataset.basketView === 'individual') individual.activate();
  if (['calendar', 'evaluation'].includes(button.dataset.basketView)) task(refreshVisibleData);
}));
$('bb-key-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  const key = $('bb-key').value; $('bb-key').value = ''; await api('key', { key, remember: $('bb-remember')?.checked ?? true }); document.dispatchEvent(new Event('observatorio:credentials'));
  if (key) { const access = await api('research/access', {}); document.dispatchEvent(new Event('observatorio:credentials')); await loadState(); message(`Clave conectada. Plan ${access.plan} comprobado; revisa el estado del guardado cifrado junto al campo de la clave.`); }
  else { await loadState(); message('Clave desconectada. Los datos guardados permanecen disponibles.'); }
}); });
$('bb-connect').addEventListener('click', () => { $('bb-sources').open = true; $('bb-key').focus(); });
$('bb-sources').addEventListener('toggle', () => $('bb-connect').setAttribute('aria-expanded', String($('bb-sources').open)));
$('bb-refresh').addEventListener('click', () => task(async () => { message('Actualizando con el presupuesto del plan verificado. Los registros individuales se completan por lotes.');
  const scope = !$('bb-prematch-view').hidden ? prematch.selection() : !$('bb-individual-view').hidden ? individual.selection() : { league: league(), season: $('bb-season').value };
  const result = await api('refresh', { league: scope.league, season: scope.season }); state = result.state; controls(); await refreshVisibleData(); if (!$('bb-prematch-view').hidden) await prematch.reload(); if (!$('bb-individual-view').hidden) await individual.reload(); message(result.warning || 'Datos actualizados; se revisaron los pronosticos de la prueba.');
}));
$('bb-start').addEventListener('click', () => task(async () => { await api('trial/start', {}); await loadState(); message('Protocolo de octubre iniciado. Sin pretemporada ni pronosticos retrospectivos.'); }));
$('bb-list').addEventListener('click', () => task(renderList));
$('bb-match-form').addEventListener('submit', event => { event.preventDefault(); task(async () => renderReport(await api('report', selection()))); });
$('bb-backtest').addEventListener('click', () => task(async () => { message('Comprobando cronologicamente el historial, sin usar resultados futuros...'); await api('backtest', { league: league(), season: '2025/2026', lookback: Number($('bb-depth').value) }); await renderEvaluation(); message('Comprobacion historica terminada. No modifica el modelo ni la calibracion de la prueba ya iniciada.'); }));
$('bb-player-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  invalidatePlayer(); const revision = playerRevision;
  const body = { ...selection(), player: $('bb-player').value, metric: $('bb-player-metric').value, line: Number($('bb-player-line').value), projectedMinutes: $('bb-minutes').value, status: $('bb-player-status').value };
  const result = await api('player', body); if (revision !== playerRevision) return;
  $('bb-player-result').textContent = result.descriptive ? `${result.player} / ${result.n} participaciones con dato / Media ${num(result.average)}. ${result.note}`
    : `${result.player} · ${result.n} partidos · Media ${num(result.average)} · Proyeccion ${num(result.expected)} · Minutos ${num(result.projectedMinutes)} · Over ${pct(result.over)} · Under ${pct(result.under)}. ${result.note}`;
  $('bb-player-body').replaceChildren(...result.history.map(item => row([date(item.date), item.team, item.opponent, num(item.minutes), ...['points', 'rebounds', 'assists', 'pra', 'threes'].map(metric => num(item.values?.[metric]))])));
  $('bb-player-markets').hidden = false;
  const cached = new Map([[body.line, result.over]]);
  playerMarkets = mountPlayerMarkets($('bb-player-markets'), { metric: body.metric, history: result.history, defaultLine: body.line, maximum: 199.5,
    guidance: { kind: 'player', label: `${result.player} / ${body.metric}`, cutoff: body.cutoff, season: body.season, lookback: body.lookback },
    ...(result.descriptive ? {} : { estimate: async line => { if (!cached.has(line)) cached.set(line, (await api('player', { ...body, line })).over); return cached.get(line); } }) });
  await playerMarkets.ready;
}); });
for (const id of ['bb-player', 'bb-player-metric', 'bb-player-line', 'bb-minutes', 'bb-player-status']) $(id).addEventListener('change', invalidatePlayer);
$('bb-import-form').addEventListener('submit', event => { event.preventDefault(); task(async () => { const file = $('bb-csv').files[0]; if (!file) throw new Error('Selecciona un CSV.');
  const result = await api('import', { league: league(), season: $('bb-season').value, csv: await file.text() }); state = result.state; controls(); await refreshVisibleData(); message(`${result.imported} resultados y ${result.fixtures} encuentros importados; ${result.skipped} filas omitidas.`);
}); });
$('bb-export').addEventListener('click', () => {
  if (!state) return;
  const rows = [['liga', 'id', 'inicio', 'sellado', 'modelo', 'hash_entradas', 'escenario', 'linea', 'probabilidad', 'resultado', 'calibrado']];
  for (const snapshot of state.trial.snapshots) {
    const outcomes = state.trial.perLeague[snapshot.league]?.outcomes || [];
    for (const market of snapshot.markets) rows.push([snapshot.league, snapshot.id, snapshot.fixture.date, snapshot.createdAt, snapshot.version, snapshot.inputHash,
      market.label, market.spec?.line, market.probability, outcomes.find(item => item.snapshotId === snapshot.id && item.marketId === market.id)?.outcome, market.calibrated]);
  }
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`, url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = el('a'); link.href = url; link.download = 'prueba-baloncesto-octubre-2026.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setInterval(() => { if (active && !busy) task(loadState); }, 60000);
onDataRefresh('basketball', () => active && !busy && !$('basketball-workspace').querySelector('[aria-busy="true"]'), () => task(async () => {
  const shownReport = !$('bb-calendar-view').hidden && !$('bb-report').hidden;
  await loadState(); await refreshVisibleData();
  if (shownReport && $('bb-home').value && $('bb-away').value) renderReport(await api('report', selection()));
  if (!$('bb-prematch-view').hidden) await prematch.reload();
  if (!$('bb-individual-view').hidden) await individual.reload();
  if (!$('bb-players-view').hidden) await playerTools.reload();
}), error => message(error.message, true));
