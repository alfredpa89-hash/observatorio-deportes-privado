import { setFootballSource, footballSourceMode } from './football-source.js';
import { onDataRefresh } from './live-refresh.js';
const $ = id => document.getElementById(id);
let access = null, report = null, busy = false;
let playerPage = 1;
onDataRefresh('football', () => !busy && document.body.dataset.activeSport === 'football', async () => renderState(await api('/api/footystats/state')));

async function api(route, body) {
  const response = await fetch(route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se completo la consulta de FootyStats.');
  return data;
}

function node(tag, text, className = '') {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}

function option(value, label) {
  const element = node('option', label); element.value = value; return element;
}

function seasonLabel(value) {
  const text = String(value);
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}/${text.slice(4)}` : text;
}

function controls() {
  $('fs-connect').disabled = busy; $('fs-key').disabled = busy;
  for (const id of ['fs-disconnect', 'fs-catalog-refresh', 'fs-catalog-mode', 'fs-league', 'fs-season', 'fs-page']) $(id).disabled = busy || !access?.connected;
  $('fs-audit').disabled = busy || !access?.connected || !$('fs-season').value;
  $('fs-sync').disabled = busy || !access?.connected;
  $('fs-coverage-export').disabled = busy || !access?.coverage?.some(row => row.checkedAt);
}

async function task(callback) {
  if (busy) return;
  busy = true; controls(); $('fs-message').textContent = 'Consultando FootyStats...'; $('fs-message').classList.remove('error');
  try { await callback(); }
  catch (error) { $('fs-message').textContent = error.message; $('fs-message').classList.add('error'); }
  finally { busy = false; controls(); }
}

function seasons() {
  const selected = access?.catalog[Number($('fs-league').value)];
  $('fs-season').replaceChildren(...(selected?.seasons || []).map(season => option(season.id, seasonLabel(season.year))));
  controls();
}

function renderState(state) {
  const previous = $('fs-season').value;
  access = state; $('fs-controls').hidden = !state.connected;
  $('fs-badge').textContent = state.connected ? state.mode === 'public-example' ? 'Ejemplo publico' : 'Clave conectada' : 'Sin conectar';
  $('fs-badge').className = `status-pill ${state.connected ? 'connected' : 'unconnected'}`;
  $('fs-status').textContent = state.connected ? state.checkedAt ? `Clave aceptada por el catalogo. ${state.catalog.length} competiciones devueltas. Plan de pago no verificado.` : 'Clave recuperada del almacen cifrado. Catalogo y permisos pendientes de comprobar.' : 'FootyStats sin conectar. Las muestras guardadas siguen disponibles.';
  $('fs-quota').textContent = state.quota?.remaining !== null && state.quota?.remaining !== undefined ? `${state.quota.remaining} consultas restantes${state.quota.limit !== null ? ` de ${state.quota.limit}` : ''} en la ventana del proveedor` : 'Cuota no informada por el proveedor';
  $('fs-catalog-mode').value = state.selectedOnly ? 'selected' : 'all';
  $('fs-catalog-note').textContent = !state.catalog.length ? 'Sin temporadas en este catalogo. Revisa las ligas elegidas en tu cuenta de FootyStats.' : state.selectedOnly ? 'Ligas elegidas en la cuenta. El acceso a cada temporada se comprueba al consultar su muestra.' : 'Catalogo general: aparecer aqui no confirma acceso con tu clave.';
  const previousLeague = state.catalog.findIndex(league => league.seasons.some(season => String(season.id) === previous));
  $('fs-league').replaceChildren(...state.catalog.map((league, index) => option(index, `${league.name}${league.country ? ` / ${league.country}` : ''}`)));
  if (previousLeague >= 0) $('fs-league').value = String(previousLeague);
  seasons();
  if ([...$('fs-season').options].some(item => item.value === previous)) $('fs-season').value = previous;
  if (!report && state.audits[0]) renderReport(state.audits[0]);
  const tested = (state.coverage || []).filter(row => row.checkedAt).length;
  $('fs-sync-status').textContent = `${tested} / 27 competiciones comprobadas / ${(state.coverage || []).filter(row => row.imported?.results).length} con historial FootyStats`;
  const labels = { available: 'Datos recibidos', empty: 'Sin partidos', restricted: 'Acceso restringido', error: 'Consulta fallida', pending: 'Pendiente', 'not-in-catalog': 'No encontrada' };
  rows('fs-league-coverage', state.coverage || [], [row => `${row.name} / ${row.country}`, row => row.currentSeason || 's/d', row => labels[row.access],
    row => row.imported ? `${row.imported.season}: ${row.imported.results} partidos / ${row.imported.players} jugadores${row.imported.matchesPartial || row.imported.playersPartial ? ' / parcial' : ''}` : 'Sin datos autorizados',
    row => row.imported ? `${row.imported.fields.find(field => field.id === 'goalsHt')?.n ?? 0} / ${row.imported.fields.find(field => field.id === 'cornersHt')?.n ?? 0}` : 's/d']);
  const previousDataset = $('fs-player-dataset').value;
  $('fs-player-dataset').replaceChildren(...(state.datasets || []).map((dataset, index) => option(index, `${dataset.league} / ${dataset.season}`)));
  if ([...$('fs-player-dataset').options].some(item => item.value === previousDataset)) $('fs-player-dataset').value = previousDataset;
  renderSeasonPlayers();
  controls();
}

function renderSeasonPlayers() {
  const dataset = access?.datasets?.[Number($('fs-player-dataset').value)];
  const query = $('fs-player-search').value.trim().toLocaleLowerCase('es');
  const order = $('fs-player-order').value;
  const players = (dataset?.players || []).filter(player => (!query || `${player.name} ${player.team || ''}`.toLocaleLowerCase('es').includes(query)) &&
    ($('fs-player-position').value !== 'goalkeeper' || /^(goalkeeper|gk|g)$/i.test(player.position || '')))
    .sort((a, b) => (b[order] ?? -1) - (a[order] ?? -1) || a.name.localeCompare(b.name, 'es'));
  const pages = Math.max(1, Math.ceil(players.length / 20)); playerPage = Math.min(playerPage, pages);
  rows('fs-season-players', players.slice((playerPage - 1) * 20, playerPage * 20), [player => player.name, player => player.team || player.teamId,
    player => player.position, ...['appearances', 'minutes', 'goals', 'assists', 'yellow', 'red', 'shotsAvg', 'shotsOnTargetAvg', 'foulsAvg', 'saves', 'savesAvg'].map(field => player => player[field])]);
  $('fs-players-scope').textContent = dataset ? `Solo FootyStats / ${dataset.season} / acumulados del torneo. No son actuaciones individuales por partido ni una plantilla actual.` : 'Sin jugadores de temporada FootyStats guardados.';
  $('fs-players-count').textContent = `${players.length} jugadores / ${players.filter(player => player[order] !== null && player[order] !== undefined).length} con dato para el orden elegido${dataset?.playersPartial ? ' / descarga parcial' : ''}`;
  $('fs-player-page').textContent = `Pagina ${playerPage} de ${pages}`;
  $('fs-player-prev').disabled = playerPage <= 1; $('fs-player-next').disabled = playerPage >= pages;
}

for (const id of ['fs-player-dataset', 'fs-player-position', 'fs-player-order', 'fs-player-search']) $(id).addEventListener(id === 'fs-player-search' ? 'input' : 'change', () => { playerPage = 1; renderSeasonPlayers(); });
$('fs-player-prev').addEventListener('click', () => { playerPage--; renderSeasonPlayers(); });
$('fs-player-next').addEventListener('click', () => { playerPage++; renderSeasonPlayers(); });
$('fs-sync').addEventListener('click', () => task(async () => {
  const result = await api('/api/footystats/sync', { maxLeagues: 3 });
  renderState(result.state); if (footballSourceMode() !== 'footystats') setFootballSource('combined');
  document.dispatchEvent(new CustomEvent('observatorio:footystats-data', { detail: { leagueKey: result.updated.find(row => row.imported?.results)?.key } }));
  $('fs-coverage-details').open = true;
  $('fs-message').textContent = `${result.requests} consultas / ${result.pending} competiciones pendientes. Solo se importaron datos autorizados de FootyStats.`;
}));
document.addEventListener('observatorio:footystats-data', () => api('/api/footystats/state').then(renderState).catch(error => { $('fs-message').textContent = error.message; }));

function rows(id, data, columns) {
  $(id).replaceChildren(...data.map(item => {
    const row = document.createElement('tr');
    for (const get of columns) row.append(node('td', String(get(item) ?? 's/d')));
    return row;
  }));
}

function coverage(id, fields) {
  rows(id, fields, [row => row.label, row => `${row.n} / ${row.total}`, row => !row.total ? 'Sin muestra' : row.status === 'missing' ? 'Sin dato' : row.status === 'zeros-only' ? 'Solo ceros: verificar' : `${row.positive} con valores positivos; ${row.zeros} con ceros`]);
  [...$(id).children].forEach((row, index) => { if (fields[index].status !== 'reported') row.lastChild.className = fields[index].status === 'missing' ? 'fs-missing' : 'fs-zero'; });
}

const pair = value => Array.isArray(value) ? value.join(' - ') : 's/d';
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value * 1000)) : 's/d';

function renderReport(value) {
  report = value; $('fs-report').hidden = false;
  $('fs-report-title').textContent = `Muestra puntual / ${value.league} / ${seasonLabel(value.season)}`;
  $('fs-report-meta').textContent = `${value.mode === 'public-example' ? 'Ejemplo publico / ' : ''}${value.matches.completed} partidos terminados de ${value.matches.returned} recibidos / pagina ${value.page}${value.matches.totalPages ? ` de ${value.matches.totalPages}` : ''} / ${value.players.returned} jugadores de temporada / ${value.requests} consultas. Revisado: ${new Date(value.checkedAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`;
  coverage('fs-match-coverage', value.matches.coverage);
  coverage('fs-player-coverage', value.players.coverage);
  $('fs-individual-report').hidden = !value.individual;
  if (value.individual) coverage('fs-individual-coverage', value.individual.coverage);
  rows('fs-match-sample', value.matches.sample, [row => date(row.date), row => `${row.home || row.id} - ${row.away || ''}`, row => pair(row.goals), row => pair(row.goalsHt), row => pair(row.corners), row => pair(row.cornersHt)]);
  const players = [...(value.individual?.sample || []), ...value.players.sample.filter(row => !(value.individual?.sample || []).some(other => other.id === row.id))];
  rows('fs-player-sample', players, [row => row.name || row.id, row => row.position, row => row.minutes, row => row.goals, row => row.assists, row => row.saves, row => row.savesAvg]);
  const observations = [...value.notes.map(note => `${note.endpoint}: ${note.message}`), ...(value.individual ? ['La consulta individual devolvio acumulados de temporada; no un registro por partido.'] : []), ...value.limits];
  $('fs-report-notes').replaceChildren(...observations.map(note => node('li', note)));
}

$('fs-key-form').addEventListener('submit', event => {
  event.preventDefault(); const key = $('fs-key').value.trim(); $('fs-key').value = '';
  task(async () => {
    renderState(await api('/api/footystats/key', { key, remember: $('fs-remember')?.checked ?? true })); document.dispatchEvent(new Event('observatorio:credentials'));
    $('fs-message').textContent = 'FootyStats conectado. No se cambio ni contrato ninguna suscripcion.';
  });
});
$('fs-disconnect').addEventListener('click', () => task(async () => {
  const result = await api('/api/footystats/key', { key: '' }); renderState(result); document.dispatchEvent(new Event('observatorio:credentials'));
  $('fs-message').textContent = result.credentials?.saved?.footystats ? 'Desconectada de esta sesion; no se pudo retirar la copia cifrada. Revisa el aviso del guardado.' : 'Clave desconectada y retirada del almacen cifrado. Muestras conservadas.';
}));
$('fs-league').addEventListener('change', seasons);
for (const id of ['fs-catalog-mode', 'fs-catalog-refresh']) $(id).addEventListener(id === 'fs-catalog-mode' ? 'change' : 'click', () => task(async () => {
  renderState(await api('/api/footystats/catalog', { all: $('fs-catalog-mode').value === 'all' })); $('fs-message').textContent = 'Catalogo consultado. La cobertura se verifica por temporada.';
}));
$('fs-audit-form').addEventListener('submit', event => {
  event.preventDefault(); task(async () => {
    const result = await api('/api/footystats/audit', { seasonId: Number($('fs-season').value), page: Number($('fs-page').value) });
    renderState(result.state); renderReport(result.report);
    $('fs-message').textContent = result.report.notes.length ? `Muestra parcial guardada: ${result.report.notes.length} consulta(s) no completada(s). Revisa las observaciones.` : 'Muestra guardada por separado. El historial y los modelos existentes no cambiaron.';
    $('fs-message').classList.toggle('error', Boolean(result.report.notes.length));
  });
});
$('fs-export').addEventListener('click', () => {
  if (!report) return;
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = `footystats-cobertura-${report.seasonId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('fs-coverage-export').addEventListener('click', () => {
  if (!access?.coverage?.some(row => row.checkedAt)) return;
  const value = { source: 'FootyStats', downloadedAt: new Date().toISOString(), coverage: access.coverage,
    datasets: (access.datasets || []).map(({ league, season, playerCount, playersPartial, scope }) => ({ league, season, playerCount, playersPartial, scope })),
    limits: ['El catalogo general no certifica permiso de acceso.', 'Los historicos no acreditan datos de la temporada actual.',
      'Los porcentajes prepartido los calcula la app, no son probabilidades oficiales del proveedor.', 'Los jugadores son acumulados de temporada, no registros por partido.'] };
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'footystats-cobertura-27-ligas.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function openConnection() {
  if (location.hash !== '#footystats') return;
  $('sources-panel').hidden = false; $('toggle-sources').setAttribute('aria-expanded', 'true');
  $('footystats').scrollIntoView({ block: 'start' }); $('fs-key').focus({ preventScroll: true });
}
window.addEventListener('hashchange', openConnection);
document.addEventListener('observatorio:sport', event => {
  if (event.detail === 'football' && location.hash === '#footystats') queueMicrotask(openConnection);
});
api('/api/footystats/state').then(renderState).catch(error => { $('fs-status').textContent = error.message; });
openConnection();
