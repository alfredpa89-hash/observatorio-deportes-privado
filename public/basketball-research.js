import { jsonRequest } from './api-client.js';
import { mountBasketballPlayerTools } from './basketball-player-tools.js';
const $ = id => document.getElementById(id);
const archivePlayerTools = mountBasketballPlayerTools($('br-player-lab'));
const node = (tag, value = '') => { const item = document.createElement(tag); item.textContent = value; return item; };
const option = (value, label) => { const item = node('option', label); item.value = value; return item; };
const row = values => { const item = node('tr'); item.append(...values.map(value => node('td', value))); return item; };
const num = value => value == null || !Number.isFinite(Number(value)) ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value == null ? 's/d' : `${num(value)} %`;
const score = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 4 });
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)) : 's/d';
const instant = value => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value); const get = type => parts.find(part => part.type === type).value; return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`; };
const labels = { winner: 'Ganador FT', total: 'Total FT', spread: 'Hándicap FT', 'q1-total': 'Total 1Q', 'ht-total': 'Total descanso', 'q1-winner': 'Local gana 1Q (sí/no)', 'ht-winner': 'Local gana descanso (sí/no)', 'team-total-home': 'Total equipo local', 'team-total-away': 'Total equipo visitante', 'player-points': 'Jugador: puntos', 'player-rebounds': 'Jugador: rebotes', 'player-assists': 'Jugador: asistencias', 'player-pra': 'Jugador: PRA', 'player-threes': 'Jugador: triples' };
const statuses = { unknown: 'No verificado', active: 'Disponible', questionable: 'En duda', out: 'Baja', minutes_limit: 'Límite de minutos' };
let state, busy = false;
let archiveTab = 'teams', archivePage = 0;
const selection = () => ({ league: $('br-league').value, season: $('br-season').value, lookback: Number($('br-depth').value) });
async function api(path, body) {
  return jsonRequest(`/api/basketball/research/${path}`, body);
}
function message(value = '', error = false) { $('br-message').textContent = value; $('br-message').classList.toggle('error', error); }
function table(id, rows, columns, emptyText) {
  const body = $(id); body.replaceChildren(...rows);
  if (!rows.length) { const cell = node('td', emptyText), item = node('tr'); cell.colSpan = columns; item.append(cell); body.append(item); }
}
function replaceOptions(id, options) { const previous = $(id).value; $(id).replaceChildren(...options); if (options.some(item => item.value === previous)) $(id).value = previous; }
function constraints() {
  const endesa = selection().league === 'endesa'; $('br-seal').disabled = busy || endesa || !state?.fixtures.length; $('br-backtest').disabled = busy || endesa;
  $('br-name').readOnly = Boolean($('br-known-player').value); $('br-team').readOnly = Boolean($('br-known-player').value);
  const player = $('br-mode').value === 'player'; $('br-match-fields').hidden = player; $('br-player-fields').hidden = !player;
  $('br-forecast-player').required = player; $('br-limit').required = $('br-status').value === 'minutes_limit';
  for (const id of ['br-total', 'br-spread', 'br-quarter', 'br-half']) $(id).required = !player;
}
async function task(action) {
  if (busy) return; busy = true; message();
  const controls = [...$('bb-research-view').querySelectorAll('button, input, select')], disabled = controls.map(item => item.disabled);
  controls.forEach(item => { item.disabled = true; }); $('bb-research-view').setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; controls.forEach((item, index) => { item.disabled = disabled[index]; }); constraints(); if (state) renderArchiveData(); $('bb-research-view').setAttribute('aria-busy', 'false'); }
}
function sourceLink(url, label) { const link = node('a', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }
function renderCalibration() {
  const bins = state?.evaluation.summary[$('br-calibration-group').value]?.bins || [];
  table('br-calibration', bins.filter(bin => bin.n).map(bin => row([`${bin.from}–${bin.to} %`, bin.n, pct(bin.predicted), pct(bin.observed), `${pct(bin.low)} a ${pct(bin.high)}`])), 5, 'Sin resultados evaluables para este escenario.');
}
function summary(id, value = {}) { table(id, Object.entries(value).map(([group, result]) => row([labels[group] || group, result.n, pct(result.accuracy), score(result.brier), score(result.logLoss), result.missing])), 6, 'Sin resultados evaluables. No se ha demostrado eficacia.'); }
function playersForFixture() {
  const fixture = state?.fixtures.find(item => item.id === $('br-fixture').value);
  replaceOptions('br-forecast-player', [option('', 'Seleccionar jugador'), ...(state?.players || []).map((player, index) => ({ player, index })).filter(({ player }) => fixture && [fixture.home, fixture.away].includes(player.team)).map(({ player, index }) => option(String(index), `${player.name} · ${player.team}`))]);
}
const searchable = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
function archiveSortOptions() {
  const choices = archiveTab === 'games' ? [['recent', 'Más recientes'], ['oldest', 'Más antiguos']] : archiveTab === 'players' ? [['name', 'Nombre'], ['points', 'Puntos'], ['pra', 'PRA'], ['minutes', 'Minutos'], ['games', 'Partidos con datos']] : [['name', 'Nombre'], ['points', 'Puntos a favor'], ['wins', 'Victorias'], ['games', 'Partidos con datos']];
  $('br-sort').replaceChildren(...choices.map(([value, label]) => option(value, label)));
}
async function renderArchivePlayerMarkets() {
  await archivePlayerTools.setContext({ ...selection(), team: $('br-filter-team').value });
}
function renderArchiveData() {
  if (!state) return;
  const team = $('br-filter-team').value, query = searchable($('br-filter-search').value.trim());
  const sort = $('br-sort').value, size = Number($('br-page-size').value);
  const all = archiveTab === 'games' ? state.games : archiveTab === 'players' ? state.players : state.teams;
  const matches = all.filter(item => {
    const names = archiveTab === 'games' ? [item.home, item.away] : archiveTab === 'players' ? [item.name, item.team] : [item.team];
    const teams = archiveTab === 'games' ? names : [item.team];
    return (!team || teams.includes(team)) && (!query || searchable(names.join(' ')).includes(query));
  });
  const points = item => archiveTab === 'players' ? item.averages[sort]?.value : item.periods.ft.scored;
  const value = item => sort === 'games' ? item.n ?? item.games : sort === 'wins' ? item.wins : points(item);
  matches.sort((a, b) => {
    if (archiveTab === 'games') return (Date.parse(a.date) - Date.parse(b.date)) * (sort === 'oldest' ? 1 : -1);
    if (sort !== 'name') {
      const av = value(a), bv = value(b);
      if (av == null && bv != null) return 1;
      if (bv == null && av != null) return -1;
      if (av != null && bv != null && av !== bv) return bv - av;
    }
    return (a.name || a.team).localeCompare(b.name || b.team, 'es');
  });
  archivePage = Math.max(0, Math.min(archivePage, Math.ceil(matches.length / size) - 1));
  const start = archivePage * size, visible = matches.slice(start, start + size);
  const period = (game, key) => `${num(game.periods.home?.[key])} / ${num(game.periods.away?.[key])}`;
  if (archiveTab === 'games') table('br-games', visible.map(game => row([date(game.date), `${game.home} - ${game.away}`, ...['q1', 'q2', 'ht', 'q3', 'q4', 'ot', 'ft'].map(key => period(game, key)), `${game.source || 'Guardado'}${game.issues?.length ? ` · ${game.issues.join('; ')}` : ''}`])), 10, all.length ? 'No hay partidos que coincidan con los filtros.' : 'No hay resultados guardados de esta temporada.');
  else if (archiveTab === 'players') table('br-players', visible.map(player => row([player.name, player.team, player.games, ...['minutes', 'points', 'rebounds', 'assists', 'pra', 'threes'].map(key => `${num(player.averages[key].value)} · ${player.averages[key].n}`), date(player.latest)])), 10, all.length ? 'No hay jugadores que coincidan con los filtros.' : 'No hay estadísticas individuales guardadas de esta temporada.');
  else table('br-teams', visible.map(item => row([item.team, item.n, item.wins, ...['ft', 'q1', 'ht'].map(key => `${num(item.periods[key].scored)} / ${num(item.periods[key].conceded)} · ${item.periods[key].n}`)])), 6, all.length ? 'No hay equipos que coincidan con los filtros.' : 'No hay datos de equipos guardados de esta temporada.');
  const noun = { teams: 'equipos', games: 'partidos', players: 'jugadores' }[archiveTab];
  $('br-filter-count').textContent = matches.length ? `${start + 1}–${Math.min(start + size, matches.length)} de ${matches.length} ${noun}${matches.length !== all.length ? ` · ${all.length} en la vista` : ''}` : `0 ${noun}${all.length ? ` · ${all.length} en la vista` : ''}`;
  if (archiveTab === 'games' && state.counts.games > all.length) $('br-filter-count').textContent += ` · Vista de los ${all.length} más recientes de ${state.counts.games} guardados`;
  $('br-prev').disabled = busy || archivePage === 0;
  $('br-next').disabled = busy || start + size >= matches.length;
  if (archiveTab === 'players') {
    renderArchivePlayerMarkets();
  }
}
function render() {
  const access = state.access, sync = state.lastSync;
  $('br-access-status').textContent = `${state.connected ? 'Clave conectada al servidor' : 'Sin clave conectada al servidor'} · ${access ? `Ultima comprobacion: ${access.plan} · Cuota informada ${num(access.dailyLimit)}/dia · ${date(access.verifiedAt)}` : 'Plan aun no comprobado'} · Limite activo ${state.requestPolicy?.plan || 'gratuito preventivo'}: ${state.quota.used || 0}/${state.requestPolicy?.usable ?? 90} (${state.quota.day || 'sin solicitudes'}).${sync ? ` Ultima carga: ${sync.key} · ${date(sync.at)} · ${sync.imported} encuentros · ${sync.warning || 'sin advertencias'}` : ''}`;
  $('br-kpis').replaceChildren(...[['Resultados guardados', state.counts.games], ['Con 4 cuartos completos', state.counts.completeQuarters], ['Registros individuales', state.counts.players], ['Encuentros futuros', state.counts.fixtures]].map(([label, value]) => { const item = node('div'); item.append(node('span', label), node('strong', num(value))); return item; }));
  $('br-feed-status').textContent = state.connected ? `API conectada${access?.plan ? ` · ${access.plan}` : ''}` : 'Sin conexión API';
  $('br-feed-status').classList.toggle('unconnected', !state.connected);
  const historical = Number(state.season.slice(0, 4)) < Number(new Date().getFullYear());
  $('br-season-status').textContent = `${historical ? 'Histórico' : 'Temporada'} ${state.season} · ${state.counts.games ? 'Datos guardados' : 'Sin registros guardados'}`;
  const teams = [...new Set([...state.teams.map(item => item.team), ...state.players.map(item => item.team), ...state.games.flatMap(item => [item.home, item.away])])].sort((a, b) => a.localeCompare(b, 'es'));
  replaceOptions('br-filter-team', [option('', 'Todos los equipos'), ...teams.map(name => option(name, name))]);
  renderArchiveData();
  replaceOptions('br-known-player', [option('', 'Registro manual (sin ID del proveedor)'), ...state.players.map((player, index) => option(String(index), `${player.name} · ${player.team}`))]);
  for (const id of ['br-fixture', 'br-report-fixture']) replaceOptions(id, [option('', id === 'br-fixture' ? 'Seleccionar encuentro' : 'Reporte general del equipo'), ...state.fixtures.map(game => option(game.id, `${date(game.date)} · ${game.home} - ${game.away}`))]);
  table('br-availability', state.availability.map(report => {
    const item = row([`${report.name} / ${report.team}`, `${statuses[report.status]}${report.stale ? ' · Vencido' : ''}`, num(report.minutesLimit), date(report.publishedAt), date(report.recordedAt), date(report.expiresAt)]), cell = node('td');
    cell.append(sourceLink(report.sourceUrl, 'Fuente'), node('div', report.note || 'Registro manual')); item.append(cell); return item;
  }), 7, 'Sin reportes. La disponibilidad de los jugadores no está verificada.');
  const evaluation = state.evaluation;
  table('br-forecasts', state.forecasts.flatMap(snapshot => snapshot.markets.map(market => {
    const outcome = evaluation.outcomes.find(item => item.snapshotId === snapshot.id && item.marketId === market.id)?.outcome;
    return row([`${snapshot.fixture.home} - ${snapshot.fixture.away}${snapshot.playerProjection ? ` · ${snapshot.playerProjection.player} · ${num(snapshot.playerProjection.projectedMinutes)} min` : ''}`, date(snapshot.fixture.date), `${date(snapshot.createdAt)} · ${snapshot.version}`, market.label, pct(market.probability), outcome === 1 ? 'Ocurrió' : outcome === 0 ? 'No ocurrió' : outcome === 'push' ? 'Nulo' : outcome === null ? 'Dato faltante' : 'Pendiente', snapshot.valid ? 'Verificada' : 'INVÁLIDA']);
  })), 7, 'No hay pronósticos sellados en este archivo y temporada.');
  summary('br-evaluation', evaluation.summary);
  $('br-evaluation-note').textContent = `${evaluation.completed} registros finalizados · ${evaluation.pending} pendientes · ${evaluation.invalid} inválidos · ${evaluation.rescheduled} reprogramados excluidos. Error total FT: ${num(evaluation.mae.ft.value)} puntos (n=${evaluation.mae.ft.n}); referencia ${num(evaluation.baseline.totalMae)}. Error de minutos: ${num(evaluation.minutesMae.value)} (n=${evaluation.minutesMae.n}). ${Object.entries(evaluation.individualMae).map(([metric, value]) => `${labels[`player-${metric}`]}: error ${num(value.value)} (n=${value.n}).`).join(' ')} ${evaluation.note} Evaluación acumulada por competición, no solo de la temporada visible.`;
  replaceOptions('br-calibration-group', Object.keys(evaluation.summary).map(group => option(group, labels[group] || group))); renderCalibration();
  summary('br-historical', state.historical?.summary);
  $('br-historical-note').textContent = state.historical ? `${state.historical.method} Muestra de validación: ${state.historical.n}. Error total ${num(state.historical.mae.ft)}; referencia ${num(state.historical.mae.baseline)}. ${state.historical.note}` : 'Mínimo 100 resultados. Separación cronológica 70 % / 30 %; no modifica la calibración de octubre.';
  const flag = value => value === true ? 'Anunciada' : value === false ? 'No anunciada' : 'Sin verificar';
  table('br-coverage', state.competitions.map(competition => row([competition.name, competition.id ? `${competition.providerName} · ID ${competition.id} · ${state.season}` : 'Sin catálogo', flag(competition.coverage?.games?.statistics?.teams), flag(competition.coverage?.games?.statistics?.players), flag(competition.coverage?.odds), sync?.key === `${competition.key}:${state.season}` ? sync.warning ? `Carga con advertencia: ${sync.warning}` : `${sync.imported} encuentros recibidos` : competition.key === state.league && state.counts.games ? `${state.counts.games} resultados guardados; fuentes en Partidos. Pro no probado.` : 'No probado para esta selección'])), 6, 'Sin catálogo conectado.');
  playersForFixture(); constraints();
}
async function load() { state = await api(`state?${new URLSearchParams(selection())}`); archivePlayerTools.reset(); render(); }
document.querySelector('[data-basket-view="research"]').addEventListener('click', () => task(load));
document.querySelectorAll('[data-research-view]').forEach(button => button.addEventListener('click', () => {
  for (const view of ['data', 'periods', 'availability', 'forecasts', 'plans']) $(`br-${view}-view`).hidden = view !== button.dataset.researchView;
  document.querySelectorAll('[data-research-view]').forEach(item => { const current = item === button; item.classList.toggle('active', current); item.setAttribute('aria-selected', String(current)); item.tabIndex = current ? 0 : -1; });
}));
for (const id of ['br-league', 'br-season', 'br-depth']) $(id).addEventListener('change', () => task(async () => {
  archivePage = 0;
  if (id !== 'br-depth') { $('br-filter-team').value = ''; $('br-filter-search').value = ''; }
  if (id !== 'br-depth') { $('br-known-player').value = ''; $('br-name').value = ''; $('br-team').value = ''; }
  if (id === 'br-league') { const nba = selection().league === 'nba'; $('br-total').value = nba ? 220.5 : 160.5; $('br-quarter').value = nba ? 55.5 : 40.5; $('br-half').value = nba ? 110.5 : 80.5; }
  await load();
}));
$('br-sync').addEventListener('click', () => task(async () => { message('Consultando la temporada elegida con los límites gratuitos...'); const result = await api('sync', selection()); state = result.state; archivePlayerTools.reset(); render(); message(result.warning || `${result.imported ?? 'En caché:'} encuentros recibidos; ${result.details || 0} consultas de detalle. Los faltantes permanecen s/d.`, Boolean(result.warning)); }));
$('br-access').addEventListener('click', () => task(async () => { await api('access', {}); await load(); message('Plan consultado. No se ha comprado ni cambiado la suscripción.'); }));
$('br-known-player').addEventListener('change', () => {
  const player = state?.players[Number($('br-known-player').value)];
  if ($('br-known-player').value !== '' && player) { $('br-name').value = player.name; $('br-team').value = player.team; }
  else { $('br-name').value = ''; $('br-team').value = ''; } constraints();
});
$('br-status').addEventListener('change', constraints); $('br-mode').addEventListener('change', constraints); $('br-fixture').addEventListener('change', playersForFixture); $('br-calibration-group').addEventListener('change', renderCalibration);
$('br-availability-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  const known = $('br-known-player').value === '' ? null : state.players[Number($('br-known-player').value)];
  await api('availability', { ...selection(), playerKey: known?.playerKey || `manual:${$('br-team').value.trim()}:${$('br-name').value.trim()}`, name: $('br-name').value, team: $('br-team').value, status: $('br-status').value, minutesLimit: $('br-limit').value,
    fixtureId: $('br-report-fixture').value, sourceUrl: $('br-source').value, publishedAt: `${$('br-published').value}:00-05:00`, expiresAt: `${$('br-expires').value}:00-05:00`, note: $('br-report-note').value });
  await load(); message('Reporte guardado con fuente, fecha de registro y caducidad. Los pronósticos ya sellados no cambian.');
}); });
$('br-forecast-form').addEventListener('submit', event => { event.preventDefault(); task(async () => {
  const body = { ...selection(), fixtureId: $('br-fixture').value };
  if ($('br-mode').value === 'player') {
    const player = $('br-forecast-player').value === '' ? null : state.players[Number($('br-forecast-player').value)]; if (!player) throw new Error('Selecciona un jugador del archivo.');
    Object.assign(body, { playerKey: player.playerKey, team: player.team, metric: $('br-metric').value, line: $('br-line').value, projectedMinutes: $('br-minutes').value });
  } else Object.assign(body, { totalLine: Number($('br-total').value), spreadLine: Number($('br-spread').value), quarterLine: Number($('br-quarter').value), halfLine: Number($('br-half').value), teamTotalSide: $('br-team-total-side').value, teamTotalLine: $('br-team-total-line').value });
  await api('forecast', body); await load(); message('Pronóstico sellado antes del inicio. Entradas y versión conservadas para evaluarlo con resultados reales.');
}); });
$('br-backtest').addEventListener('click', () => task(async () => { message('Evaluación cronológica en curso...'); await api('backtest', selection()); await load(); message('Comprobación histórica guardada en el archivo independiente. No altera la prueba de octubre.'); }));
$('br-export').addEventListener('click', () => task(async () => {
  const result = await api('export'), url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })), link = node('a'); link.href = url; link.download = 'archivo-investigacion-baloncesto.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('Archivo exportado sin clave API ni datos personales de la cuenta. Uso privado sujeto a las condiciones de la fuente.');
}));
$('br-published').value = instant(new Date()); $('br-expires').value = instant(new Date(Date.now() + 48 * 3600000));
document.querySelectorAll('[data-archive-tab]').forEach(button => button.addEventListener('click', () => {
  archiveTab = button.dataset.archiveTab; archivePage = 0;
  document.querySelectorAll('[data-archive-tab]').forEach(item => {
    const current = item === button; item.classList.toggle('active', current); item.setAttribute('aria-selected', String(current)); item.tabIndex = current ? 0 : -1;
    $(`br-${item.dataset.archiveTab}-panel`).hidden = !current;
  });
  archiveSortOptions(); renderArchiveData();
}));
for (const id of ['br-filter-team', 'br-sort', 'br-page-size']) $(id).addEventListener('change', () => { archivePage = 0; renderArchiveData(); });
$('br-filter-search').addEventListener('input', () => { archivePage = 0; renderArchiveData(); });
$('br-clear-filters').addEventListener('click', () => { $('br-filter-team').value = ''; $('br-filter-search').value = ''; archivePage = 0; renderArchiveData(); $('br-filter-search').focus(); });
$('br-prev').addEventListener('click', () => { archivePage--; renderArchiveData(); });
$('br-next').addEventListener('click', () => { archivePage++; renderArchiveData(); });
archiveSortOptions();
