import { footballSourceMode } from './football-source.js';
import { onDataRefresh, currentCutoff } from './live-refresh.js';
const $ = id => document.getElementById(id);
const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
const option = (value, label) => { const element = node('option', label); element.value = value; return element; };
const dateLabel = (date, time = false) => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(date));
const localDate = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const number = value => value === null || value === undefined ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 1 });
const percent = value => value === null || value === undefined ? 's/d' : `${number(value)}%`;
let sport = 'football';
let state = null;
let busy = false;
let lookback = 10;
let currentReport = null;
let fixtures = [];
let exactCutoff = null;
const preferences = {
  nba: { season: '2026/2027', totalLine: 220.5, spreadLine: -3.5, lookback: 10 },
  tennis: { season: '2026', totalLine: 22.5, lookback: 10, category: 'all', tournament: '', surface: 'all', bestOf: 3 },
};
const reports = {};
const calendars = {};

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la consulta.');
  return result;
}
function message(text = '', error = false) { $('sp-message').textContent = text; $('sp-message').classList.toggle('error', error); }
function selection() {
  return { sport, season: $('sp-season').value, home: $('sp-home').value, away: $('sp-away').value, lookback,
    cutoff: exactCutoff || ($('sp-cutoff').value === currentCutoff('date') ? new Date().toISOString() : `${$('sp-cutoff').value}T00:00:00-05:00`), totalLine: Number($('sp-total').value), spreadLine: Number($('sp-spread').value),
    category: $('sp-category').value, tournament: $('sp-tournament').value, surface: $('sp-surface').value, bestOf: Number($('sp-best-of').value) };
}
function dataset() { return state?.[sport]?.datasets.find(set => set.season === $('sp-season').value); }
function updateButtons() {
  const selected = $('sp-home').value && $('sp-away').value && $('sp-home').value !== $('sp-away').value;
  $('sp-analyze').disabled = busy || !selected;
  $('sp-add').disabled = busy || !selected;
  $('sp-list').disabled = busy || !dataset()?.participants.length;
}
async function task(button, label, action) {
  if (busy) return;
  busy = true;
  const old = button.textContent;
  button.disabled = true; if (!button.dataset.sport) button.textContent = label;
  const surfaces = [...document.querySelectorAll('main, .topbar, #sources-panel')];
  surfaces.forEach(surface => { surface.inert = true; });
  document.querySelector('.app-shell').setAttribute('aria-busy', 'true');
  message();
  try { await action(); } catch (error) { message(error.message, true); }
  finally {
    busy = false; button.disabled = false; if (!button.dataset.sport) button.textContent = button.id === 'sp-load' && dataset()?.loadedAt ? 'Actualizar historial' : old;
    surfaces.forEach(surface => { surface.inert = false; });
    document.querySelector('.app-shell').setAttribute('aria-busy', 'false'); updateButtons();
    if (button.dataset.sport) button.focus();
  }
}
function closeFixtureForm() { $('sp-fixture-form').hidden = true; $('sp-add').setAttribute('aria-expanded', 'false'); }
function invalidate() {
  currentReport = null; delete reports[sport]; delete calendars[sport];
  $('sp-report').hidden = true; fixtures = []; closeFixtureForm(); message(); renderCalendar(); updateButtons();
}
function updateTournaments() {
  const old = $('sp-tournament').value;
  const category = $('sp-category').value;
  const available = (dataset()?.tournaments || []).filter(tournament => category === 'all' || category === tournament.category);
  $('sp-tournament').replaceChildren(option('', 'Todos los torneos'), ...available.map(tournament => option(tournament.name, tournament.name)));
  if (available.some(tournament => tournament.name === old)) $('sp-tournament').value = old;
}
function updateControls() {
  const config = state[sport]; const selectedSeason = $('sp-season').value || preferences[sport].season;
  $('sp-season').replaceChildren(...config.seasons.map(season => option(season, season)));
  $('sp-season').value = config.seasons.includes(selectedSeason) ? selectedSeason : config.seasons[0];
  const set = dataset();
  for (const id of ['sp-home', 'sp-away']) {
    const previous = $(id).value;
    $(id).replaceChildren(option('', sport === 'nba' ? 'Seleccionar equipo' : 'Seleccionar jugador'), ...(set?.participants || []).map(name => option(name, name)));
    if (set?.participants.includes(previous)) $(id).value = previous;
    $(id).disabled = !set?.participants.length;
  }
  $('sp-data-status').textContent = set?.loadedAt
    ? `${set.matchCount.toLocaleString('es-EC')} resultados · ${set.historyCount.toLocaleString('es-EC')} con el historial anterior · ${set.fixtureCount} encuentros en calendario · ${set.source} · Actualizado ${dateLabel(set.loadedAt, true)}`
    : 'Sin historial guardado para esta temporada.';
  $('sp-source-note').textContent = set?.note || config.source.dateNote || config.source.coverage || '';
  $('sp-source-link').href = set?.sourcePage || config.source.sourcePage || (sport === 'nba' ? 'https://www.espn.com/nba/scoreboard' : 'https://stats.tennismylife.org/tennis-match-database');
  $('sp-load').textContent = set?.loadedAt ? 'Actualizar historial' : 'Cargar historial';
  $('source-status').textContent = `${sport === 'nba' ? 'NBA' : 'Tenis'} · ${set?.source || 'Sin historial'}`;
  $('source-status').classList.toggle('connected', Boolean(set?.loadedAt));
  if (sport === 'tennis') updateTournaments();
  updateButtons();
}
function updateRanking() {
  const previous = $('sp-ranking').value;
  const markets = sport === 'nba' ? [
    ['home-win', 'Gana local'], ['away-win', 'Gana visitante'], ['total-over', `Over ${$('sp-total').value} puntos`], ['total-under', `Under ${$('sp-total').value} puntos`],
    ['spread-home', 'Hándicap local'], ['spread-away', 'Hándicap visitante'],
  ] : [['player1-win', 'Gana jugador A'], ['player2-win', 'Gana jugador B'],
    [`games-over-${$('sp-total').value}`, `Over ${$('sp-total').value} juegos`], [`games-under-${$('sp-total').value}`, `Under ${$('sp-total').value} juegos`],
    ...[$('sp-best-of').value === '5' ? 3.5 : 2.5].flatMap(line => [['over', 'Over'], ['under', 'Under']].map(([direction, label]) => [`sets-${direction}-${line}`, `${label} ${line} sets`]))];
  $('sp-ranking').replaceChildren(...markets.map(([id, label]) => option(id, label)));
  if (markets.some(([id]) => id === previous)) $('sp-ranking').value = previous;
}
async function activate(next) {
  if (['nba', 'tennis'].includes(sport)) { preferences[sport] = selection(); reports[sport] = currentReport; }
  sport = next;
  document.querySelectorAll('[data-sport]').forEach(button => {
    const active = button.dataset.sport === sport; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  $('football-workspace').hidden = sport !== 'football'; $('sports-workspace').hidden = sport !== 'nba';
  $('tennis-workspace').hidden = sport !== 'tennis';
  $('basketball-workspace').hidden = sport !== 'basketball';
  document.dispatchEvent(new CustomEvent('observatorio:sport', { detail: sport }));
  $('toggle-sources').hidden = sport !== 'football';
  $('football-source-controls').hidden = sport !== 'football';
  $('sources-panel').hidden = true; $('toggle-sources').setAttribute('aria-expanded', 'false');
  if (sport === 'basketball') {
    $('workspace-title').textContent = 'Baloncesto';
    $('source-status').textContent = 'Baloncesto · Datos guardados';
    $('source-status').classList.remove('connected');
    return;
  }
  if (sport === 'tennis') {
    $('workspace-title').textContent = 'Tenis';
    $('source-status').textContent = 'ATP / Historicos y prepartido';
    $('sport-tennis').setAttribute('aria-controls', 'tennis-workspace');
    return;
  }
  $('workspace-title').textContent = sport === 'football' ? 'Futbol' : sport === 'nba' ? 'Archivo NBA' : 'Análisis de tenis';
  if (sport === 'football') {
    const football = await api('/api/state');
    const competitionCount = (football.competitions || football.catalog).length;
    $('source-status').textContent = footballSourceMode() === 'footystats' ? `FootyStats / ${football.catalog.filter(league => league.source === 'FootyStats' && league.seasons.length).length} ligas con historial` : football.connection?.verified ? `API-Football / ${football.connection.plan}` : football.connected ? 'Clave pendiente de verificar' : `${competitionCount} ligas guardadas`;
    $('source-status').classList.toggle('connected', Boolean(football.connected || competitionCount));
    return;
  }
  $('sports-workspace').setAttribute('aria-labelledby', `sport-${sport}`);
  $('sp-title').textContent = sport === 'nba' ? 'Historial NBA · ESPN y CSV' : 'ATP · Grand Slam, Masters 1000 y ATP 500';
  $('sp-history-field').classList.toggle('football-history-six', sport === 'nba');
  document.querySelectorAll('[data-sport-lookback="25"], [data-sport-lookback="30"]').forEach(button => { button.hidden = sport !== 'nba'; });
  $('sp-tennis-filters').hidden = sport !== 'tennis'; $('sp-spread-field').hidden = sport !== 'nba';
  $('sp-home-label').textContent = sport === 'nba' ? 'Local' : 'Jugador A'; $('sp-away-label').textContent = sport === 'nba' ? 'Visitante' : 'Jugador B';
  $('sp-report-home-label').textContent = sport === 'nba' ? 'LOCAL' : 'JUGADOR A'; $('sp-report-away-label').textContent = sport === 'nba' ? 'VISITANTE' : 'JUGADOR B';
  $('sp-total-label').textContent = sport === 'nba' ? 'Total de puntos' : 'Total de juegos';
  $('sp-total').max = sport === 'nba' ? '499.5' : '99.5'; $('sp-template').href = `/templates/${sport}.csv`;
  const saved = preferences[sport]; lookback = saved.lookback;
  $('sp-total').value = saved.totalLine; $('sp-spread').value = saved.spreadLine ?? -3.5;
  $('sp-cutoff').value = saved.cutoff ? localDate(saved.cutoff) : localDate(); exactCutoff = saved.cutoff || null;
  $('sp-category').value = saved.category || 'all'; $('sp-surface').value = saved.surface || 'all'; $('sp-best-of').value = saved.bestOf || 3;
  $('sp-season').replaceChildren(option(saved.season, saved.season));
  state = await api('/api/sports/state'); updateControls();
  $('sp-home').value = saved.home || ''; $('sp-away').value = saved.away || '';
  if ([...$('sp-tournament').options].some(item => item.value === saved.tournament)) $('sp-tournament').value = saved.tournament;
  document.querySelectorAll('[data-sport-lookback]').forEach(button => { const active = Number(button.dataset.sportLookback) === lookback; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  currentReport = reports[sport] || null; fixtures = calendars[sport]?.fixtures || []; closeFixtureForm();
  $('sp-report').hidden = !currentReport;
  if (currentReport) renderReport(currentReport);
  updateRanking(); renderCalendar(calendars[sport]?.note); updateButtons();
}
function renderTeam(side, name, history) {
  $(`sp-${side}-name`).textContent = name;
  const initial = $(`sp-${side}-initial`); initial.textContent = name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const logo = history?.find(match => match.home === name && match.homeLogo || match.away === name && match.awayLogo);
  const image = $(`sp-${side}-logo`); const url = logo?.home === name ? logo.homeLogo : logo?.awayLogo;
  image.hidden = !url; initial.hidden = Boolean(url);
  if (url) { image.src = url; image.onerror = () => { image.hidden = true; initial.hidden = false; }; }
}
function renderSummary(result) {
  const headers = sport === 'nba' ? ['Equipo', 'Partidos', 'G / P', 'Puntos a favor', 'Puntos en contra', 'Puntos 1Q (n)', 'Puntos descanso (n)', 'Rebotes', 'Asistencias', 'Triples'] : ['Jugador', 'Partidos', 'G / P', 'Juegos', 'Sets', 'Aces', 'D. faltas', 'Elo'];
  const head = node('tr'); headers.forEach(title => head.append(node('th', title))); $('sp-summary-head').replaceChildren(head);
  $('sp-summary-body').replaceChildren();
  for (const side of ['home', 'away']) {
    const summary = result.summary[side]; const average = summary.averages || {};
    const values = sport === 'nba' ? [summary.team, summary.matches, `${summary.wins} / ${summary.losses}`, number(summary.pointsFor), number(summary.pointsAgainst), `${number(summary.firstQuarterPoints?.average)} (${summary.firstQuarterPoints?.n ?? 0})`, `${number(summary.halfTimePoints?.average)} (${summary.halfTimePoints?.n ?? 0})`, number(summary.rebounds?.average), number(summary.assists?.average), number(summary.threePointersMade?.average)]
      : [summary.team, summary.n, `${summary.wins} / ${summary.losses}`, number(average.games?.average ?? average.games), number(average.sets?.average ?? average.sets), number(average.aces?.average ?? average.aces), number(average.doubleFaults?.average ?? average.doubleFaults), number(summary.rating)];
    const row = node('tr'); values.forEach(value => row.append(node('td', value ?? 's/d'))); $('sp-summary-body').append(row);
  }
}
function renderMarkets(result) {
  $('sp-markets').replaceChildren();
  for (const market of result.markets) {
    const row = node('div', '', 'market-row'); const description = node('div');
    description.append(node('div', market.label, 'market-title'), node('div', market.probability === null ? 'Datos insuficientes' : 'Estimación exploratoria', 'market-detail'));
    const track = node('div', '', 'prob-track'); const fill = node('div', '', 'prob-fill'); fill.style.width = `${market.probability ?? 0}%`; fill.hidden = market.probability === null; track.append(fill);
    const observed = node('div', '', 'observed');
    for (const side of ['home', 'away']) {
      const sample = market.observed?.[side]; observed.append(node('div', `${side === 'home' ? 'A' : 'B'}: ${sample?.n ? `${sample.hits}/${sample.n} en historial` : 's/d'}`));
    }
    if (market.pushProbability) observed.append(node('div', `Devolución: ${percent(market.pushProbability)}`));
    row.append(description, track, node('div', percent(market.probability), 'prob-value'), observed); $('sp-markets').append(row);
  }
}
function historyRows(result) {
  $('sp-history').replaceChildren();
  for (const side of ['home', 'away']) {
    const team = result.meta[side]; const matches = result.history[side];
    const column = node('div', '', 'history-column'); const heading = node('div', '', 'history-column-head'); heading.append(node('h3', team), node('span', `${matches.length} partidos`));
    const scroll = node('div', '', 'table-scroll'); const table = node('table'); const header = node('thead'); const headings = node('tr');
    const labels = sport === 'nba' ? ['Fecha', 'Rival', 'Puntos', '1Q equipo', 'Descanso equipo', 'Rebotes', 'Asist.', 'Triples'] : ['Fecha / semana', 'Rival', 'Marcador', 'Torneo', 'Superficie', 'Juegos', 'Sets'];
    labels.forEach(title => headings.append(node('th', title))); header.append(headings); const body = node('tbody');
    for (const match of matches) {
      const atHome = (match.home || match.player1) === team;
      const opponent = match.opponent || (atHome ? match.away || match.player2 : match.home || match.player1);
      const values = sport === 'nba' ? [dateLabel(match.date), `${atHome ? 'L' : 'V'} · ${opponent}`, `${match.homePoints}-${match.awayPoints}`, number(match.teamStats?.firstQuarterPoints), number(match.teamStats?.halfTimePoints), number(match.teamStats?.rebounds), number(match.teamStats?.assists), number(match.teamStats?.threePointersMade)]
        : [dateLabel(match.date), opponent, match.score || 's/d', match.tournament, match.surface || 's/d', number(match.totalGames ?? match.games), number(match.totalSets ?? match.sets)];
      const row = node('tr'); row.title = `${match.home || match.player1} - ${match.away || match.player2}${match.availableAfter ? ` · Disponible desde ${dateLabel(match.availableAfter)}` : ''}`;
      values.forEach(value => row.append(node('td', value ?? 's/d'))); body.append(row);
    }
    if (!matches.length) { const row = node('tr'); const cell = node('td', 'Sin partidos previos compatibles con los filtros.'); cell.colSpan = labels.length; row.append(cell); body.append(row); }
    table.append(header, body); scroll.append(table); column.append(heading, scroll); $('sp-history').append(column);
  }
}
function renderReport(result) {
  currentReport = result; reports[sport] = result; $('sp-report').hidden = false;
  renderTeam('home', result.meta.home, result.history.home); renderTeam('away', result.meta.away, result.history.away);
  $('sp-report-context').textContent = result.meta.tournament || result.meta.season;
  $('sp-report-sample').textContent = `${result.history.home.length} partidos de A · ${result.history.away.length} de B · Exploratorio`;
  $('sp-report-cutoff').textContent = `Corte: ${dateLabel(result.meta.cutoff)}`;
  $('sp-method').textContent = [result.meta.model || result.meta.method, result.meta.providerNote].filter(Boolean).join(' ');
  $('sp-quality').replaceChildren(...(result.quality?.messages || []).map(text => node('li', text)));
  renderSummary(result); renderMarkets(result); historyRows(result);
  const direct = result.history.h2h || []; $('sp-h2h-count').textContent = `${direct.length} encuentros`;
  $('sp-h2h').replaceChildren(...direct.map(match => node('div', `${dateLabel(match.date)} · ${match.home || match.player1} ${sport === 'nba' ? `${match.homePoints}-${match.awayPoints}` : match.score || ''} ${match.away || match.player2}`, 'h2h-item')));
  if (!direct.length) $('sp-h2h').append(node('span', 'Sin enfrentamientos directos anteriores al corte.', 'h2h-empty'));
}
async function analyze(extra = {}) {
  const result = await api('/api/sports/report', { ...selection(), ...extra }); renderReport(result);
  $('sp-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function value(match, id) { return match.markets?.find(market => market.id === id)?.probability ?? null; }
function renderCalendar(note) {
  const body = $('sp-fixture-body'); body.replaceChildren(); const market = $('sp-ranking').value;
  const winnerIds = sport === 'nba' ? ['home-win', 'away-win'] : ['player1-win', 'player2-win'];
  for (const match of [...fixtures].sort((a, b) => (value(b, market) ?? -1) - (value(a, market) ?? -1))) {
    const row = node('tr'); const encounter = node('td', `${match.home} - ${match.away}`);
    if (match.manual) encounter.append(node('small', 'Calendario manual', 'manual-tag'));
    row.append(node('td', dateLabel(match.date, true)), encounter, ...[...winnerIds, market].map(id => node('td', percent(value(match, id)))));
    const actions = node('td'); const open = node('button', 'Abrir', 'button button-secondary'); open.type = 'button';
    open.addEventListener('click', () => task(open, 'Abriendo...', async () => {
      $('sp-home').value = match.home; $('sp-away').value = match.away; exactCutoff = match.analysisCutoff; $('sp-cutoff').value = localDate(exactCutoff);
      if (sport === 'tennis') {
        $('sp-category').value = match.category || 'all'; updateTournaments(); $('sp-tournament').value = match.tournament || '';
        $('sp-surface').value = match.surface || 'all'; $('sp-best-of').value = match.bestOf || 3; updateRanking();
      }
      await analyze(match);
    })); actions.append(open);
    if (match.manual) {
      const remove = node('button', 'Quitar', 'button button-secondary'); remove.type = 'button';
      remove.addEventListener('click', () => task(remove, 'Quitando...', async () => {
        const result = await api('/api/sports/fixtures/manual/remove', { sport, season: $('sp-season').value, id: match.id }); state = result.state; updateControls(); await calculateList();
      })); actions.append(remove);
    }
    row.append(actions); body.append(row);
  }
  if (!fixtures.length) { const row = node('tr'); const cell = node('td', 'Sin encuentros calculados.'); cell.colSpan = 6; row.append(cell); body.append(row); }
  $('sp-calendar-note').textContent = note || (dataset()?.fixtureCount ? `${dataset().fixtureCount} encuentros guardados. Estimaciones pendientes de calcular.` : 'Sin calendario guardado. Puedes investigar dos participantes con el historial disponible.');
}
async function calculateList() {
  const result = await api('/api/sports/list', selection()); fixtures = result.fixtures; calendars[sport] = result; renderCalendar(result.note);
}
function exportReport() {
  if (!currentReport) return;
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['deporte', 'temporada', 'participante_a', 'participante_b', 'corte', 'escenario', 'estimacion_porcentaje', 'a_ocurrencias', 'a_muestra', 'b_ocurrencias', 'b_muestra']];
  for (const market of currentReport.markets) rows.push([sport, currentReport.meta.season, currentReport.meta.home, currentReport.meta.away, currentReport.meta.cutoff, market.label, market.probability, market.observed?.home?.hits, market.observed?.home?.n, market.observed?.away?.hits, market.observed?.away?.n]);
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = `analisis-${sport}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll('[data-sport]').forEach(button => {
  button.addEventListener('click', () => task(button, button.textContent, () => activate(button.dataset.sport)));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...document.querySelectorAll('[data-sport]')];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
});
$('sp-load').addEventListener('click', () => task($('sp-load'), 'Descargando...', async () => {
  const result = await api('/api/sports/load', { sport, season: $('sp-season').value }); state = result.state; updateControls(); invalidate();
  message(result.warning || 'Historial guardado en este equipo.');
}));
$('sp-import-form').addEventListener('submit', event => {
  event.preventDefault(); task(event.submitter, 'Importando...', async () => {
    const file = $('sp-csv').files[0]; if (!file) throw new Error('Selecciona un CSV.');
    const result = await api('/api/sports/import', { sport, season: $('sp-season').value, csv: await file.text() }); state = result.state; updateControls(); invalidate();
    message(`${result.imported} resultados importados. ${result.skipped} filas omitidas.`);
  });
});
$('sp-season').addEventListener('change', () => { exactCutoff = null; updateControls(); invalidate(); });
for (const id of ['sp-home', 'sp-away', 'sp-cutoff', 'sp-total', 'sp-spread', 'sp-surface', 'sp-best-of']) $(id).addEventListener('change', () => {
  if (id === 'sp-cutoff') exactCutoff = null; updateRanking(); invalidate();
});
$('sp-category').addEventListener('change', () => { updateTournaments(); $('sp-best-of').value = $('sp-category').value === 'grand-slam' ? 5 : 3; updateRanking(); invalidate(); });
$('sp-tournament').addEventListener('change', () => {
  const tournament = dataset()?.tournaments.find(item => item.name === $('sp-tournament').value);
  if (tournament) { $('sp-surface').value = tournament.surface || 'all'; $('sp-best-of').value = tournament.bestOf || 3; }
  updateRanking(); invalidate();
});
document.querySelectorAll('[data-sport-lookback]').forEach(button => button.addEventListener('click', () => {
  lookback = Number(button.dataset.sportLookback);
  document.querySelectorAll('[data-sport-lookback]').forEach(segment => { const active = Number(segment.dataset.sportLookback) === lookback; segment.classList.toggle('active', active); segment.setAttribute('aria-pressed', String(active)); }); invalidate();
}));
$('sp-analyze').addEventListener('click', () => task($('sp-analyze'), 'Calculando...', analyze));
$('sp-list').addEventListener('click', () => task($('sp-list'), 'Calculando...', calculateList));
$('sp-ranking').addEventListener('change', () => renderCalendar(calendars[sport]?.note));
$('sp-add').addEventListener('click', () => {
  $('sp-fixture-form').hidden = !$('sp-fixture-form').hidden; $('sp-add').setAttribute('aria-expanded', String(!$('sp-fixture-form').hidden));
  if (!$('sp-fixture-form').hidden) { $('sp-fixture-pair').textContent = `${$('sp-home').value} - ${$('sp-away').value}`; $('sp-fixture-date').value = localDate(new Date(new Date(selection().cutoff).valueOf() + 86400000)); $('sp-fixture-date').focus(); }
});
$('sp-fixture-cancel').addEventListener('click', closeFixtureForm);
$('sp-fixture-form').addEventListener('submit', event => {
  event.preventDefault(); task(event.submitter, 'Guardando...', async () => {
    const result = await api('/api/sports/fixtures/manual', { ...selection(), date: $('sp-fixture-date').value, time: $('sp-fixture-time').value }); state = result.state; updateControls(); closeFixtureForm(); await calculateList();
  });
});
$('sp-export').addEventListener('click', exportReport);
onDataRefresh('basketball', () => sport === 'nba' && document.body.dataset.activeSport === 'nba' && !busy,
  () => task($('sp-load'), 'Leyendo datos...', async () => {
    const shown = currentReport !== null, hadList = fixtures.length > 0;
    state = await api('/api/sports/state'); updateControls();
    if (shown && $('sp-home').value && $('sp-away').value) await analyze();
    if (hadList) await calculateList();
  }));
