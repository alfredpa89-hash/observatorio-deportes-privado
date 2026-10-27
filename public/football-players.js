import { jsonRequest } from './api-client.js';
import { mountPlayerMarkets } from './player-markets.js';
import { mountFootballSeasonAggregates } from './football-season.js';
import { mountRelevantContext } from './relevant-context.js';
import { footballSourceMode } from './football-source.js';
import { leagueSearch, searchApiLeagues, matchesLeague, individualLeagues } from './football-leagues.js';
const $ = id => document.getElementById(id);
const relevantContext = mountRelevantContext($('fp-profile'));
const renderSeasonAggregates = mountFootballSeasonAggregates($('fp-directory-panel'));
const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
const option = (value, label) => { const item = node('option', label); item.value = value; return item; };
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const norm = value => String(value).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const date = value => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value));
let active = false, busy = false, pendingActivation = false, revision = 0, leagueKey = '', state, directory, profile, markets, page = 0;
let apiLeagues = [], assistReport = null;
const basisLabels = { total: 'Total de la muestra', average: 'Por partido', per90: 'Por 90 min' };
const positions = { G: 'Portero', D: 'Defensa', M: 'Mediocampista', F: 'Delantero' };
function icons() { window.lucide?.createIcons(); }
async function api(path, body) {
  return jsonRequest(path, body);
}
function message(text = '', error = false) { $('fp-message').textContent = text; $('fp-message').classList.toggle('error', error); }
function selectedLeague() { return state?.catalog.find(league => league.key === leagueKey); }
function selection() {
  return { leagueKey, season: $('fp-season').value, team: $('fp-team').value, window: $('fp-window').value,
    position: $('fp-position').value,
    cutoff: $('fp-cutoff').value === today() ? new Date().toISOString() : `${$('fp-cutoff').value}T23:59:59-05:00`, metric: $('fp-metric').value, basis: $('fp-basis').value };
}
function controls() {
  const sameDay = state?.quota?.checkedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const quotaBlocked = state?.connection?.lastIssue?.code === 'quota_exceeded' || (sameDay && state?.quota?.remaining != null && state.quota.remaining <= 5);
  const loadable = selectedLeague()?.source === 'api-football' || selectedLeague()?.seasonsInfo[$('fp-season').value]?.apiLoadable;
  const unavailable = busy || quotaBlocked || !state?.connected || !loadable || !$('fp-season').value || selectedLeague()?.seasonsInfo[$('fp-season').value]?.apiCoverage === false;
  $('fp-load').disabled = unavailable || !$('fp-team').value;
  $('fp-load-league').disabled = unavailable;
  $('fp-export').disabled = busy || !filtered().length;
  $('fp-api-find').disabled = busy || !state?.connected;
  $('fp-api-load').disabled = busy || quotaBlocked || !state?.connected || !$('fp-api-league').value || !$('fp-api-season').value;
  $('fp-assist-load').disabled = busy || quotaBlocked || !state?.connected || !loadable || !$('fp-season').value || selectedLeague()?.seasonsInfo[$('fp-season').value]?.topAssistCoverage === false;
  $('fp-connection').textContent = state?.connection?.verified ? `API / ${state.connection.plan}` : state?.connected ? 'Clave pendiente de verificar' : 'API sin conectar';
  $('fp-connection').classList.toggle('unconnected', !state?.connected);
  $('fp-load-note').textContent = !loadable
    ? 'Esta temporada tiene datos de equipos, pero no partidos API-Football para cargar jugadores. Las participaciones de otras temporadas se conservan en la misma liga.'
    : !state?.connected ? 'Conecta tu clave en el campo protegido de Fuentes de datos. El guardado cifrado es opcional.'
      : quotaBlocked ? 'Descargas pausadas por limite de consultas o reserva gratuita. Los registros guardados siguen disponibles. Comprueba conexion y plan en Fuentes de datos cuando se recupere la cuota; no necesitas cambiar de clave.'
      : selectedLeague()?.seasonsInfo[$('fp-season').value]?.apiCoverage === false ? 'La temporada no declara cobertura individual en el proveedor. CSV sigue disponible.'
        : 'Carga por equipo o amplia la liga en lotes de hasta 5 encuentros, priorizando equipos sin registros. La ventana elegida corresponde a cada equipo. Conserva lo guardado y reserva las ultimas 5 consultas diarias.';
  const allowed = state?.connection?.allowedSeasons;
  $('fp-api-access').textContent = !state?.connected ? 'API sin conectar. Tu historial guardado sigue disponible.'
    : allowed ? `Plan ${state.connection.plan}: temporadas ${allowed.join(', ')} (ano de inicio). Historicos, no datos actuales. Cargar una temporada no descarga automaticamente todos sus jugadores.`
      : `Plan ${state?.connection?.plan || 'pendiente de verificar'}. El catalogo muestra temporadas del proveedor; su disponibilidad se confirma al cargar. La cobertura individual varia.`;
  if (state?.connection?.lastIssue?.code === 'quota_exceeded') $('fp-api-access').textContent = 'El proveedor alcanzo el limite de consultas. El ultimo saldo reportado no confirma cuota disponible. ' + $('fp-api-access').textContent;
}
async function task(action) {
  if (busy) return;
  busy = true; message(); $('football-players-workspace').setAttribute('aria-busy', 'true');
  $('football-players-workspace').querySelectorAll('input, select, button').forEach(element => { element.disabled = true; });
  try { await action(); } catch (error) {
    if (error.allowedSeasons && state) { state.connection ||= {}; state.connection.allowedSeasons = error.allowedSeasons; renderApiSeasons(); }
    if (active) message(error.message, true);
  }
  finally {
    busy = false; $('football-players-workspace').setAttribute('aria-busy', 'false');
    $('football-players-workspace').querySelectorAll('input, select, button').forEach(element => { element.disabled = false; });
    controls(); paginationButtons();
    if (pendingActivation && active) { pendingActivation = false; task(activate); }
  }
}
function hideProfile() { profile = null; markets?.dispose(); $('fp-profile').hidden = true; $('fp-directory-panel').hidden = false; }
function renderLeagues() {
  const query = $('fp-league-search').value;
  const leagues = individualLeagues(state.catalog, $('fp-league-mode').value).filter(league => matchesLeague(league, query));
  $('fp-league-list').replaceChildren(...leagues.map(league => {
    const button = node('button', '', 'fp-league'); button.type = 'button'; button.disabled = busy; button.setAttribute('aria-pressed', String(league.key === leagueKey));
    button.classList.toggle('active', league.key === leagueKey);
    const content = node('span'); content.append(node('strong', league.name), node('small', `${league.country || 'Liga guardada'} / ${league.seasons.join(', ')}`));
    const countedSeason = league.seasons.find(season => String(season) === $('fp-season').value && league.seasonsInfo[season]?.records)
      || league.seasons.find(season => league.seasonsInfo[season]?.records) || league.seasons[0];
    const count = league.seasonsInfo[countedSeason]?.players || 0;
    const badge = node('span', count, 'fp-league-count'); badge.title = `Jugadores guardados de ${countedSeason}; no acredita la plantilla actual.`;
    button.append(content, badge);
    button.addEventListener('click', () => task(async () => { leagueKey = league.key; setSeasons(); setTeams(); renderLeagues(); await loadDirectory(); }));
    return button;
  }));
  if (!leagues.length) $('fp-league-list').append(node('p', 'Sin ligas individuales guardadas para esta busqueda. Buscar otra liga consulta el proveedor.', 'table-note'));
  const pending = (state.pending || []).filter(league => matchesLeague(league, query));
  $('fp-pending').hidden = !pending.length;
  $('fp-pending-title').textContent = `Competiciones por cargar (${pending.length})`;
  if (query && pending.length) $('fp-pending').open = true;
  $('fp-pending-list').replaceChildren(...pending.map(league => {
    const button = node('button', '', 'fp-league'); button.type = 'button'; button.disabled = busy;
    const content = node('span'); content.append(node('strong', league.name), node('small', `${league.country} / Sin historial descargado`));
    button.append(content);
    button.addEventListener('click', () => {
      showData(); $('fp-api-search').value = league.name; $('fp-api-search').focus();
      message(`No hay datos descargados de ${league.name}. ${state.connected ? 'Selecciona una temporada permitida tras consultar el proveedor.' : 'Conecta API-Football en Fuentes de datos para consultar las temporadas disponibles.'}`);
    });
    return button;
  }));
}
function setSeasons(preferred = $('fp-season').value) {
  const league = selectedLeague();
  $('fp-season').replaceChildren(...(league?.seasons || []).map(season => option(season, `${season} / ${league.seasonsInfo[season]?.records || 0} participaciones`)));
  const chosen = league?.seasons.find(season => String(season) === String(preferred) || String(season).split('/')[0] === String(preferred))
    || league?.seasons.find(season => league.seasonsInfo[season]?.records > 0);
  if (chosen !== undefined) $('fp-season').value = chosen;
  $('fp-title').textContent = league?.name || 'Rendimiento individual';
  $('fp-source').textContent = league ? `${league.country || 'Liga guardada'} / ${(league.sources || [{ source: league.source }]).map(source => source.source || 'CSV').join(' + ')}. ${league.coverageNote || ''}` : 'Carga una competicion en Encuentros';
  if (!$('fp-api-search').value) $('fp-api-search').value = league?.name || '';
}
function setTeams(preferred = $('fp-team').value) {
  const league = selectedLeague();
  const teams = league?.seasonsInfo[$('fp-season').value]?.teams || league?.teams || [];
  const coverage = league?.seasonsInfo[$('fp-season').value]?.teamCoverage || {};
  $('fp-team').replaceChildren(option('', 'Todos'), ...teams.map(team => option(team, `${team} (${coverage[team]?.games || 0})`)));
  $('fp-team').title = 'Entre parentesis: encuentros con registros individuales guardados en esta temporada, no partidos oficiales jugados.';
  if (teams.includes(preferred)) $('fp-team').value = preferred;
  controls();
}
async function activate() {
  const token = ++revision, preferredMetric = $('fp-metric').value;
  const result = await api('/api/football/players/state?sourceMode=' + encodeURIComponent(footballSourceMode()));
  if (!active || token !== revision) return;
  state = result;
  const mapped = state.catalog.find(league => league.key === leagueKey || league.sourceKeys?.includes(leagueKey));
  leagueKey = mapped?.key || state.catalog.find(league => Object.values(league.seasonsInfo).some(season => season.records))?.key || state.catalog.find(league => league.key === $('league-select').value)?.key || state.catalog[0]?.key || '';
  $('fp-metric').replaceChildren(...state.metrics.map(field => option(field.id, field.label)));
  if (state.metrics.some(field => field.id === preferredMetric)) $('fp-metric').value = preferredMetric;
  setSeasons(); setTeams(); renderLeagues(); if (apiLeagues.length) renderApiSeasons(); await loadDirectory(); icons();
}
async function loadDirectory() {
  const token = ++revision; hideProfile(); directory = null; assistReport = null; page = 0; renderRanking(); renderAssistLeaders();
  renderSeasonAggregates([]);
  $('fp-records').textContent = 'Sin registros individuales para esta seleccion';
  $('fp-directory-note').textContent = ''; $('fp-coverage-body').replaceChildren();
  $('fp-ranking-context').textContent = 'Consultando registros guardados...';
  if (!leagueKey || !$('fp-season').value) { $('fp-ranking-context').textContent = 'Sin competiciones cargadas'; return; }
  const result = await api('/api/football/players', selection());
  if (!active || token !== revision) return;
  directory = result;
  renderSeasonAggregates(result.seasonAggregates);
  $('fp-records').textContent = `${result.savedPlayers} jugadores / ${result.records} participaciones / ${result.gameCount} encuentros con registros`;
  $('fp-directory-note').textContent = result.note;
  $('fp-coverage-body').replaceChildren(...result.coverage.map(field => row([field.label, `${field.n} / ${field.records}`, field.records ? `${number(100 * field.n / field.records)} %` : 's/d'])));
  renderRanking(); controls();
  if (selectedLeague()?.source === 'api-football' || selectedLeague()?.seasonsInfo[$('fp-season').value]?.apiLoadable) {
    const saved = await api('/api/football/players/assist-leaders', selection());
    if (!active || token !== revision) return;
    assistReport = saved.report; renderAssistLeaders();
  }
}
function renderAssistLeaders() {
  $('fp-assist-scroll').hidden = !assistReport?.rows.length;
  $('fp-assist-body').replaceChildren(...(assistReport?.rows || []).map(player => row([player.providerRank, player.name, player.team, number(player.assists), number(player.appearances), number(player.minutes)])));
  $('fp-assist-context').textContent = assistReport ? `${assistReport.rows.length} jugadores / Temporada API ${assistReport.season} / Consulta ${date(assistReport.fetchedAt)}` : 'Sin ranking del proveedor guardado para esta temporada';
  $('fp-assist-note').textContent = assistReport?.note || 'Agregados de temporada del proveedor, separados del ranking de la muestra. No hay clasificacion del torneo descargada para esta seleccion.';
}
function row(values, header = false) { const item = node('tr'); item.append(...values.map(value => node(header ? 'th' : 'td', value))); return item; }
function filtered() {
  const query = norm($('fp-player-search').value), min = Number($('fp-min-games').value);
  return (directory?.players || []).filter(player => (!query || norm(`${player.name} ${player.team}`).includes(query)) && player.appearances >= (Number.isInteger(min) && min >= 1 && min <= 100 ? min : 1));
}
function paginationButtons() {
  const count = filtered().length, size = Number($('fp-page-size').value);
  $('fp-prev').disabled = busy || page <= 0;
  $('fp-next').disabled = busy || (page + 1) * size >= count;
}
function avatar(player, className) {
  const item = node('span', '', className), initials = player.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  item.append(node('span', initials));
  if (player.photo) {
    const img = node('img'); img.src = player.photo; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true }); item.append(img);
  }
  return item;
}
function renderRanking() {
  const players = filtered(), size = Number($('fp-page-size').value), fields = state?.metrics || [];
  page = Math.max(0, Math.min(page, Math.ceil(players.length / size) - 1));
  const basis = $('fp-basis').value;
  $('fp-ranking-head').replaceChildren(row(['Jugador / equipo', 'PJ', 'Minutos (n)', ...fields.map(field => field.label), 'n del orden'], true));
  $('fp-ranking-body').replaceChildren(...players.slice(page * size, (page + 1) * size).map(player => {
    const item = node('tr'), person = node('td'), button = node('button', '', 'fp-person'); button.type = 'button';
    const info = node('span'); info.append(node('strong', player.name), node('small', player.team));
    button.append(avatar(player, 'fp-small-avatar'), info); button.addEventListener('click', () => task(() => openProfile(player)));
    person.append(button); item.append(person, node('td', player.appearances), node('td', `${number(player.minutes)} (${player.minutesN})`));
    for (const field of fields) {
      const summary = player.summary.find(value => value.id === field.id), cell = node('td', number(summary[basis]));
      if (field.id === $('fp-metric').value) cell.className = 'fp-selected-metric';
      cell.title = `${summary.n} con dato; ${summary.missing} sin dato. Por 90: ${summary.per90N} con dato y minutos.`;
      item.append(cell);
    }
    const selected = player.summary.find(field => field.id === $('fp-metric').value);
    item.append(node('td', basis === 'per90' ? selected.per90N : selected.n)); return item;
  }));
  const empty = !players.length; $('fp-empty').hidden = !empty; $('fp-ranking-scroll').hidden = empty;
  $('fp-empty-title').textContent = directory?.savedPlayers ? 'Sin jugadores para estos filtros' : 'Sin registros individuales';
  $('fp-empty-note').textContent = directory?.savedPlayers ? 'Cambia la busqueda, el minimo de participaciones o el equipo.' : `Sin participaciones guardadas para la posicion, equipo y temporada ${$('fp-season').value || 'elegida'}. Los goles o tiros de un equipo no identifican que jugador los realizo.`;
  $('fp-ranking-context').textContent = `${players.length} jugadores / ${basisLabels[basis]} / ${$('fp-window').value === 'season' ? 'Temporada guardada' : `Ultimas ${$('fp-window').value} participaciones`}`;
  $('fp-page-count').textContent = players.length ? `${page * size + 1}-${Math.min((page + 1) * size, players.length)} de ${players.length}` : '0 jugadores';
  controls(); paginationButtons();
}
async function openProfile(player) {
  const token = ++revision;
  const result = await api('/api/football/players/profile', { ...selection(), playerKey: player.playerKey, team: player.team });
  if (!active || token !== revision) return;
  profile = result; $('fp-directory-panel').hidden = true; $('fp-profile').hidden = false;
  relevantContext.show({ sport: 'football', kind: 'player', key: leagueKey, season: result.meta.season,
    team: result.team, playerKey: result.playerKey, lookback: result.meta.window === 'season' ? 30 : Number(result.meta.window || 20), cutoff: result.meta.cutoff });
  $('fp-avatar').replaceChildren(avatar(result, 'fp-large-avatar'));
  $('fp-player-name').textContent = result.name;
  $('fp-player-context').textContent = `${result.team} / ${result.competition} / ${result.meta.season}${result.position ? ` / ${positions[result.position] || result.position}` : ''}`;
  $('fp-player-rating').textContent = result.averageRating === null ? 'Sin valoracion del proveedor' : `${number(result.averageRating)} / 10 / Valoracion API-Football (${result.ratingN} partidos)`;
  $('fp-player-games').textContent = result.appearances;
  $('fp-player-minutes').textContent = `${number(result.minutes)} (${result.minutesN})`;
  $('fp-player-goals-label').textContent = result.position === 'G' ? 'Atajadas' : 'Goles';
  $('fp-player-goals').textContent = number(result.summary.find(field => field.id === (result.position === 'G' ? 'saves' : 'goals')).total);
  $('fp-player-assists').textContent = number(result.summary.find(field => field.id === 'assists').total);
  $('fp-summary-body').replaceChildren(...result.summary.map(field => row([field.label, number(field.total), number(field.average), number(field.per90), `${field.n} / ${result.appearances}`, `${field.per90N} (${number(field.per90Minutes)} min)`])));
  $('fp-profile-metric').replaceChildren(...result.summary.map(field => option(field.id, field.label))); $('fp-profile-metric').value = $('fp-metric').value;
  $('fp-profile-note').textContent = `${result.note} ${result.appearances - result.minutesN} registros sin minutos; aparecen en frecuencias historicas, pero no en calculos por 90. Corte: ${date(result.meta.cutoff)}. Fuentes: ${result.sources.join(', ')}.`;
  $('fp-history-head').replaceChildren(row(['Fecha', 'Rival / condicion', 'Minutos', ...state.metrics.map(field => field.label), 'Fuente'], true));
  $('fp-history-body').replaceChildren(...result.history.map(record => row([date(record.date), `${record.opponent} / ${record.venue === 'home' ? 'Local' : record.venue === 'away' ? 'Visitante' : 's/d'}`, number(record.minutes), ...state.metrics.map(field => number(record.values[field.id])), record.source])));
  renderPlayerMetric(); $('fp-profile').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderPlayerMetric() {
  if (!profile) return;
  const metric = $('fp-profile-metric').value, field = profile.summary.find(field => field.id === metric);
  markets?.dispose();
  const history = profile.history.map(record => {
    const result = { ...record }; if (result.minutes === null) delete result.minutes; return result;
  });
  markets = mountPlayerMarkets($('fp-markets'), { metric, history, initialLines: field.lines, maximum: 49.5,
    preset: { from: .5, to: Math.max(2.5, field.lines.at(-1)), step: 1, width: 1 } });
  const records = [...profile.history].reverse().slice(-20), max = Math.max(1, ...records.map(record => record.values[metric] ?? 0));
  $('fp-trend').replaceChildren(...records.map(record => {
    const value = record.values[metric], item = node('div', '', 'fp-trend-item'), track = node('div', '', 'fp-trend-track'), bar = node('span', '', 'fp-trend-bar');
    if (value === null) { bar.classList.add('missing'); bar.style.height = '12px'; } else bar.style.height = `${Math.max(3, Math.round(value / max * 62))}px`;
    track.append(bar); item.title = `${date(record.date)} / ${record.opponent}: ${number(value)}`;
    item.append(node('strong', number(value)), track, node('small', date(record.date).slice(0, 5))); return item;
  }));
  $('fp-trend').setAttribute('aria-label', `${field.label}, de mas antiguo a reciente: ${records.map(record => `${date(record.date)}: ${number(record.values[metric])}`).join('; ')}. Barras discontinuas: dato ausente.`);
}
function exportCsv(rows, name) {
  const cell = value => { const text = String(value ?? ''); return `"${(typeof value === 'string' && /^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showData() { $('fp-data').open = true; $('fp-data').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function findLeague() { showData(); $('fp-api-search').value = $('fp-league-search').value || selectedLeague()?.name || ''; $('fp-api-search').focus(); }
function renderApiSeasons() {
  const league = apiLeagues.find(item => String(item.id) === $('fp-api-league').value), allowed = state?.connection?.allowedSeasons;
  const preferred = $('fp-api-season').value;
  $('fp-api-season').replaceChildren(...(league?.seasons || []).map(season => {
    const item = option(season, season); if (allowed && !allowed.includes(Number(season))) { item.disabled = true; item.textContent += ' / bloqueada en Free'; } return item;
  }));
  const saved = state?.catalog.find(item => item.key === `api:${league?.id}` || item.sourceKeys?.includes(`api:${league?.id}`));
  const choices = [...$('fp-api-season').options].filter(item => !item.disabled);
  $('fp-api-season').value = choices.find(item => item.value === preferred)?.value || choices.find(item => saved?.seasons.some(season => String(season).split('/')[0] === item.value && (saved.source === 'api-football' || saved.seasonsInfo[season]?.apiLoadable)))?.value || choices[0]?.value || '';
  controls();
}
function connect() { if ($('sources-panel').hidden) $('toggle-sources').click(); $('api-key').focus(); $('sources-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
document.addEventListener('observatorio:football-view', event => {
  active = event.detail === 'players' && footballSourceMode() !== 'footystats'; if (active) { if (busy) pendingActivation = true; else task(activate); } else { revision++; markets?.dispose(); }
});
document.addEventListener('observatorio:sport', event => { if (event.detail !== 'football') { active = false; revision++; } });
document.addEventListener('observatorio:data', () => { if (active && !busy) {
  const selected = profile;
  task(async () => { await activate(); if (selected && selected.playerKey && active) await openProfile(selected); });
} });
$('fp-cutoff').value = today(); $('fp-cutoff').max = today();
$('fp-league-search').addEventListener('input', renderLeagues);
$('fp-league-mode').addEventListener('change', renderLeagues);
$('fp-find-league').addEventListener('click', findLeague);
$('fp-api-search-form').addEventListener('submit', event => {
  event.preventDefault(); task(async () => {
    const target = leagueSearch($('fp-api-search').value);
    const result = await api(`/api/search?q=${encodeURIComponent(target.query)}`);
    if (!active) return;
    apiLeagues = searchApiLeagues(result.results, target);
    $('fp-api-league').replaceChildren(...apiLeagues.map(item => option(item.id, `${item.name} / ${item.country || 'Sin pais'} / #${item.id}`)));
    $('fp-api-selection').hidden = !apiLeagues.length;
    $('fp-api-season').replaceChildren(); renderApiSeasons(); icons();
    message(result.note || (apiLeagues.length ? `${apiLeagues.length} competiciones API encontradas.` : 'Sin resultados API. Prueba el pais o el nombre usado por el proveedor.'), Boolean(result.note));
  });
});
$('fp-api-league').addEventListener('change', () => { $('fp-api-season').replaceChildren(); renderApiSeasons(); });
$('fp-api-season').addEventListener('change', controls);
$('fp-api-load').addEventListener('click', () => task(async () => {
  const season = $('fp-api-season').value;
  message('Cargando calendario e historial de la temporada desde API-Football...');
  const result = await api('/api/load', { id: Number($('fp-api-league').value), season: Number(season) });
  if (!active) return;
  leagueKey = result.league.key; await activate(); setSeasons(season); setTeams(''); renderLeagues(); await loadDirectory();
  message(`${result.imported} resultados guardados de la temporada ${season} (ano de inicio). Selecciona un equipo y carga sus jugadores. No se necesitan CSV.`);
  document.dispatchEvent(new CustomEvent('observatorio:football-players-data', { detail: { leagueKey, season } }));
}));
$('fp-connect').addEventListener('click', connect);
$('fp-assist-load').addEventListener('click', () => task(async () => {
  const token = revision;
  const result = await api('/api/football/players/assist-leaders', { ...selection(), refresh: true });
  if (!active || token !== revision) return;
  assistReport = result.report; renderAssistLeaders();
  message(`${result.report.rows.length} asistentes del torneo guardados. ${result.requests} consultas API. No se mezclan con el historial por partido.`);
}));
$('fp-empty-data').addEventListener('click', showData);
$('fp-refresh').addEventListener('click', () => task(activate));
$('fp-filters').addEventListener('submit', event => { event.preventDefault(); if ($('fp-filters').reportValidity()) task(loadDirectory); });
for (const id of ['fp-team', 'fp-window', 'fp-cutoff', 'fp-metric', 'fp-basis', 'fp-position']) $(id).addEventListener('change', () => { if ($('fp-filters').reportValidity()) task(loadDirectory); });
$('fp-season').addEventListener('change', () => task(async () => { setTeams(''); renderLeagues(); await loadDirectory(); }));
for (const id of ['fp-player-search', 'fp-min-games']) $(id).addEventListener('input', () => { page = 0; renderRanking(); });
$('fp-page-size').addEventListener('change', () => { page = 0; renderRanking(); });
$('fp-prev').addEventListener('click', () => { page--; renderRanking(); });
$('fp-next').addEventListener('click', () => { page++; renderRanking(); });
$('fp-back').addEventListener('click', () => { hideProfile(); $('fp-directory-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('fp-profile-metric').addEventListener('change', renderPlayerMetric);
$('fp-load').addEventListener('click', () => task(async () => {
  message('Consultando encuentros finalizados. La carga puede tardar unos segundos por el limite gratuito.');
  const result = await api('/api/football/players/load', { ...selection(), lookback: Number($('fp-load-window').value) });
  if (!active) return;
  await activate();
  message(`${result.imported} registros nuevos / ${result.available} de ${result.games} encuentros con jugadores / ${result.remainingGames} pendientes / ${result.emptyGames} sin registros. ${result.requests} consultas API.${result.warning ? ` ${result.warning}` : ''}`, Boolean(result.warning));
}));
$('fp-load-league').addEventListener('click', () => task(async () => {
  message('Ampliando los registros de la liga. Hasta cinco encuentros por lote; puede tardar unos segundos.');
  const result = await api('/api/football/players/load', { ...selection(), team: '', scope: 'league', lookback: Number($('fp-load-window').value) });
  if (!active) return;
  await activate();
  message(`${result.imported} participaciones nuevas / ${result.teamsCovered} de ${result.teamsTotal} equipos con registros en la ventana / ${result.available} de ${result.games} encuentros cargados / ${result.remainingGames} pendientes. ${result.requests} consultas API.${result.warning ? ` ${result.warning}` : ''}`, Boolean(result.warning));
}));
$('fp-import').addEventListener('submit', event => {
  event.preventDefault(); task(async () => {
    const file = $('fp-file').files[0]; if (!file) throw new Error('Selecciona un CSV individual.');
    const result = await api('/api/profiles/import', { ...selection(), sport: 'football', csv: await file.text() });
    if (!active) return;
    await activate(); $('fp-file').value = ''; message(`${result.imported} registros importados / ${result.skipped} filas omitidas.`);
    document.dispatchEvent(new CustomEvent('observatorio:football-players-data'));
  });
});
$('fp-export').addEventListener('click', () => {
  const selected = selection(), fields = state.metrics, basis = selected.basis;
  exportCsv([['liga', 'temporada', 'corte', 'muestra', 'valores', 'jugador', 'equipo', 'participaciones', 'minutos', 'minutos_n', ...fields.flatMap(field => [field.id, `${field.id}_n`])],
    ...filtered().map(player => [directory.competition, selected.season, selected.cutoff, selected.window, basis, player.name, player.team, player.appearances, player.minutes, player.minutesN,
      ...fields.flatMap(field => { const item = player.summary.find(item => item.id === field.id); return [item[basis], basis === 'per90' ? item.per90N : item.n]; })])], 'futbol-ranking-jugadores.csv');
});
$('fp-profile-export').addEventListener('click', () => {
  if (!profile) return;
  exportCsv([['liga', 'temporada', 'jugador', 'equipo', 'fecha', 'disponible_desde', 'rival', 'condicion', 'minutos', ...state.metrics.map(field => field.id), 'fuente'],
    ...profile.history.map(record => [profile.competition, record.season, record.name, record.team, record.date, record.availableAfter || record.date, record.opponent, record.venue, record.minutes, ...state.metrics.map(field => record.values[field.id]), record.source])], 'futbol-historial-jugador.csv');
});
