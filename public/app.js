import { footballSourceMode, filterFootballSources, footballFieldLabel } from './football-source.js';
import { onDataRefresh } from './live-refresh.js';
import { mountRelevantContext } from './relevant-context.js';
import { HANDICAP_GROUPS, SETTLEMENTS, handicapDefinitions, handicapLabel, validHandicap, configureHandicapInput } from './football-handicap.js';
const $ = (id) => document.getElementById(id);
const relevantContext = mountRelevantContext($('report'));
const GROUPS = {
  resultado: 'Resultado',
  'doble-oportunidad': 'Doble oportunidad',
  'ambos-marcan': 'Ambos marcan',
  handicap: 'Handicap europeo',
  'asian-handicap': 'Handicap asiatico',
  goles: 'Goles',
  corners: 'Córners',
  tarjetas: 'Tarjetas',
  'tarjetas-amarillas': 'Amarillas',
  'tarjetas-rojas': 'Tarjetas rojas',
  'fuera-de-juego': 'Fuera de juego',
  faltas: 'Faltas',
  'tiros-al-arco': 'Tiros al arco',
};
const METRICS = { goles: 'goals', corners: 'corners', tarjetas: 'cards', 'tarjetas-amarillas': 'yellow', 'tarjetas-rojas': 'red', 'fuera-de-juego': 'offsides', faltas: 'fouls', 'tiros-al-arco': 'shotsOnTarget' };
const HALF_GROUPS = { 'resultado-1t': 'Resultado 1T', 'goles-1t': 'Goles 1T', 'corners-1t': 'Córners 1T', 'handicap-1t': 'Handicap europeo 1T', 'asian-handicap-1t': 'Handicap asiatico 1T' };
const handicapSelections = {};
let catalog = [];
let freeLeagues = [];
let apiLeagues = [];
let lookback = 10;
let report = null;
let activeGroup = 'resultado';
let activeHalfGroup = 'resultado-1t';
let rankings = [];
let rankingNote = null;
let thresholds = {};
let selectedCutoff = null;
let busy = false;
let footballAccess = null;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function teamKey(value) { return String(value ?? '').trim().toLocaleLowerCase('es'); }
function sameTeam(left, right) { return teamKey(left) === teamKey(right); }

function localDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 's/d' : new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}

function cutoff() {
  return selectedCutoff || ($('cutoff-date').value === localDate() ? new Date().toISOString() : `${$('cutoff-date').value}T23:59:59-05:00`);
}

function message(text = '', error = false, target = 'app-message') {
  $(target).textContent = text;
  $(target).classList.toggle('error', error);
}

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la consulta.');
  return result;
}

async function task(button, pendingLabel, action, target = 'app-message') {
  if (busy) return;
  busy = true;
  const content = [...button.childNodes];
  button.disabled = true;
  button.textContent = pendingLabel;
  const surfaces = [...document.querySelectorAll('main, .topbar, #sources-panel')];
  surfaces.forEach((surface) => { surface.inert = true; });
  document.querySelector('.app-shell').setAttribute('aria-busy', 'true');
  message('', false, target);
  try { await action(); } catch (error) { message(error.message, true, target); }
  finally {
    busy = false; button.replaceChildren(...content); button.disabled = false;
    surfaces.forEach((surface) => { surface.inert = false; });
    document.querySelector('.app-shell').setAttribute('aria-busy', 'false');
    updateAnalyzeButton();
  }
}

function option(value, text) {
  const result = make('option', '', text);
  result.value = value;
  return result;
}

function selectedLeague() { return catalog.find((item) => item.key === $('league-select').value); }

function updateFreeSeasons() {
  const league = freeLeagues.find((item) => item.division === $('europe-division').value);
  if (!league) return;
  $('free-source-link').href = league.sourcePage || 'https://football-data.co.uk/downloadm.php';
  const previous = $('europe-season').value;
  $('europe-season').replaceChildren(...league.seasons.map((season) => option(season.value, season.label)));
  if (league.seasons.some((season) => season.value === previous)) $('europe-season').value = previous;
}

function renderRankingControls() {
  const select = $('ranking-market');
  select.replaceChildren();
  const result = make('optgroup'); result.label = 'Resultado y ambos marcan';
  for (const [id, label] of [['btts-yes', 'Ambos marcan'], ['btts-no', 'No marcan ambos'], ['result-home', 'Gana local'], ['result-draw', 'Empate'], ['result-away', 'Gana visitante']]) result.append(option(id, label));
  select.append(result);
  const doubleChance = make('optgroup'); doubleChance.label = 'Doble oportunidad';
  for (const [id, label] of [['double-chance-1x', '1X · Local o empate'], ['double-chance-x2', 'X2 · Visitante o empate'], ['double-chance-12', '12 · Local o visitante']]) doubleChance.append(option(id, label));
  select.append(doubleChance);
  const halfResult = make('optgroup'); halfResult.label = 'Resultado del primer tiempo';
  for (const [id, label] of [['half-time-result-home', 'Gana local 1T'], ['half-time-result-draw', 'Empate 1T'], ['half-time-result-away', 'Gana visitante 1T']]) halfResult.append(option(id, label));
  select.append(halfResult);
  for (const [key, config] of Object.entries(HANDICAP_GROUPS)) {
    const group = make('optgroup'); group.label = config.label;
    for (const market of handicapDefinitions().filter(item => item.group === key)) group.append(option(market.id, `${market.label}${config.kind === 'asian' ? ' / victoria completa' : ''}`));
    select.append(group);
  }
  for (const [id, label, lines] of [
    ['goals', 'goles', [1.5, 2.5, 3.5, 4.5]],
    ['corners', 'córners', [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]],
    ['cards', 'tarjetas', [2.5, 3.5, 4.5, 5.5, 6.5]],
    ['yellow-cards', 'tarjetas amarillas', [2.5, 3.5, 4.5, 5.5, 6.5]],
    ['red-cards', 'tarjetas rojas', [0.5, 1.5, 2.5]],
    ['offsides', 'fueras de juego', [1.5, 2.5, 3.5, 4.5]],
    ['fouls', 'faltas', [21.5, 24.5, 27.5]],
    ['shots-on-target', 'tiros al arco', [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]],
    ['half-time-goals', 'goles 1T', [0.5, 1.5, 2.5]],
    ['half-time-corners', 'córners 1T', [1.5, 2.5, 3.5, 4.5]],
  ]) {
    const group = make('optgroup'); group.label = label[0].toUpperCase() + label.slice(1);
    const directions = id === 'red-cards' ? ['over'] : ['over', 'under'];
    for (const line of lines) for (const direction of directions) group.append(option(`${id}-${direction}-${line}`, `${direction === 'over' ? 'Over' : 'Under'} ${line} ${label}`));
    select.append(group);
  }
}

function updateState(state, selectKey = null) {
  footballAccess = state.connection || null;
  if (state.catalog) catalog = filterFootballSources(footballSourceMode() === 'combined' ? state.competitions || state.catalog : state.catalog);
  if (state.apiLeagues) apiLeagues = state.apiLeagues;
  if (state.freeLeagues) {
    freeLeagues = state.freeLeagues;
    const previous = $('europe-division').value;
    $('europe-division').replaceChildren(...freeLeagues.map((league) => option(league.division, league.name)));
    if (freeLeagues.some((league) => league.division === previous)) $('europe-division').value = previous;
    updateFreeSeasons();
  }
  const oldKey = $('league-select').value;
  const requested = selectKey || $('league-select').value;
  const previous = catalog.find(league => league.key === requested || league.sourceKeys?.includes(requested))?.key || requested;
  $('league-select').replaceChildren(option('', 'Selecciona una liga'), ...catalog.map((league) => option(league.key, `${league.name}${league.country ? ` · ${league.country}` : ''}${league.source === 'OpenFootball' ? ' · histórico parcial 2025' : ''}${league.source === 'FootyStats' && !league.seasons.length ? ' / sin historial autorizado' : ''}`)));
  const pending = make('optgroup'); pending.label = 'Sin datos: conectar API o importar CSV';
  if (footballSourceMode() !== 'footystats') pending.append(...apiLeagues.filter(league => !league.loadedKeys?.length && !catalog.some(saved =>
    saved.name.localeCompare(league.name, 'es', { sensitivity: 'base' }) === 0 &&
    (saved.country === league.country || league.country === 'World' && saved.key.startsWith('competition:world:'))
  )).map(league => option(league.key, `${league.name} · API o CSV`)));
  if (pending.children.length) $('league-select').append(pending);
  $('league-select').value = previous && [...$('league-select').options].some(item => item.value === previous) ? previous : catalog[0]?.key || '';
  const footyOnly = footballSourceMode() === 'footystats';
  $('football-league-lookup').hidden = footyOnly;
  $('add-fixture-button').hidden = footyOnly;
  $('football-empty-note').textContent = footyOnly ? 'Solo FootyStats. Selecciona una temporada autorizada y dos equipos; las ligas restringidas no tienen historial.' : 'Carga una liga gratuita, conecta API-Football o importa un CSV.';
  const status = $('source-status');
  if (!document.body.dataset.activeSport || document.body.dataset.activeSport === 'football') {
    status.textContent = footballSourceMode() === 'footystats' ? `FootyStats / ${catalog.filter(league => league.seasons.length).length} ligas con historial` : footballAccess?.verified ? `API-Football / ${footballAccess.plan}` : state.connected ? 'Clave pendiente de verificar' : `${catalog.length} ${catalog.length === 1 ? 'liga guardada' : 'ligas guardadas'}`;
    status.classList.toggle('connected', Boolean(state.connected || catalog.length));
  }
  const remaining = state.quota?.remaining;
  $('quota-status').hidden = remaining === null || remaining === undefined;
  if (remaining !== null && remaining !== undefined) $('quota-status').textContent = footballAccess?.lastIssue?.code === 'quota_exceeded' ? 'API: limite de consultas' : `${remaining} consultas API restantes`;
  $('football-verify').disabled = !state.connected;
  $('football-access-status').textContent = !state.connected ? 'API sin conectar. Los datos guardados siguen disponibles.'
    : !footballAccess?.verified ? 'Clave configurada, acceso todavia no verificado.'
      : `Clave verificada / Plan ${footballAccess.plan}${remaining == null ? '' : ` / ${remaining} consultas restantes`}.${footballAccess.allowedSeasons ? ` Temporadas permitidas: ${footballAccess.allowedSeasons.join(', ')} (ano de inicio).` : /free/i.test(footballAccess.plan) ? ' Free limita las temporadas: aparecer en el catalogo no garantiza acceso a la temporada actual.' : ' La cobertura de jugadores depende de cada liga y temporada.'}`;
  if (footballAccess?.lastIssue?.code === 'quota_exceeded') $('football-access-status').textContent = `Clave verificada / Plan ${footballAccess.plan}. Limite de consultas alcanzado; ultimo saldo sin confirmar. Los datos guardados siguen disponibles.`;
  updateLeagueControls(oldKey !== $('league-select').value);
  document.dispatchEvent(new CustomEvent('observatorio:data'));
}

async function refreshState(selectKey = null) { updateState(await api('/api/state'), selectKey); }
onDataRefresh('football', () => !busy && document.body.dataset.activeSport === 'football', async () => {
  const shown = report !== null, hadList = rankings.length > 0;
  await refreshState();
  if (shown && $('home-select').value && $('away-select').value) await analyze();
  if (hadList && $('league-select').value) await calculateList();
}, error => message(error.message, true));

document.addEventListener('observatorio:football-source', () => { invalidateReport(true); refreshState().catch(error => message(error.message, true)); });
document.addEventListener('observatorio:footystats-data', event => { invalidateReport(true); refreshState(event.detail?.leagueKey).catch(error => message(error.message, true)); });

document.addEventListener('observatorio:football-players-data', async event => {
  try {
    await refreshState(event.detail?.leagueKey);
    if (event.detail?.season) selectLoadedSeason(event.detail.season);
  } catch (error) { message(error.message); }
});

function updateLeagueControls(resetList = true) {
  const league = selectedLeague();
  const oldSeason = $('season-select').value;
  const seasons = (league?.seasons || []).map((season) => typeof season === 'object' ? season.year : season);
  $('season-select').replaceChildren(...(seasons.length ? seasons.map((season) => option(String(season), String(season))) : [option('', 'Temporada')]));
  if (seasons.some((season) => String(season) === oldSeason)) $('season-select').value = oldSeason;
  $('season-select').disabled = !league || !seasons.length;
  updateTeamControls();
  $('fixture-section').hidden = !league;
  if (resetList) { rankings = []; rankingNote = null; $('manual-fixture-form').hidden = true; $('add-fixture-button').setAttribute('aria-expanded', 'false'); renderRankings(); }
}

function updateTeamControls() {
  const league = selectedLeague();
  const teams = league?.teamsBySeason?.[$('season-select').value] || league?.teams || [];
  $('league-history-note').textContent = league?.coverageNote || '';
  $('league-source-details').hidden = !league?.sources?.length;
  $('league-source-body').replaceChildren(...(league?.sources || []).map(source => {
    const row = make('tr');
    for (const value of [source.source || 'Archivo', source.seasons.join(', '), source.matchCount,
      source.firstResult ? dateLabel(source.firstResult) : 's/d', source.lastResult ? dateLabel(source.lastResult) : 's/d']) row.append(make('td', '', String(value)));
    return row;
  }));
  const names = teams.map((team) => typeof team === 'string' ? team : team.name).filter(Boolean);
  for (const [id, placeholder] of [['home-select', 'Equipo local'], ['away-select', 'Equipo visitante'], ['fixture-home', 'Equipo local'], ['fixture-away', 'Equipo visitante']]) {
    const old = $(id).value;
    $(id).replaceChildren(option('', placeholder), ...names.map((name) => option(name, name)));
    if (names.includes(old)) $(id).value = old;
    $(id).disabled = !names.length;
  }
  updateAnalyzeButton();
}

function updateAnalyzeButton() {
  $('analyze-button').disabled = busy || !$('league-select').value || !$('home-select').value || !$('away-select').value || sameTeam($('home-select').value, $('away-select').value);
}

function invalidateReport(resetList = false) {
  report = null;
  $('report').hidden = true;
  $('empty-state').hidden = false;
  message('');
  if (resetList) { rankings = []; rankingNote = null; $('manual-fixture-form').hidden = true; $('add-fixture-button').setAttribute('aria-expanded', 'false'); renderRankings(); }
}

function selectLoadedSeason(season) {
  const loaded = [...$('season-select').options].find(item => item.value === String(season) || item.value.split('/')[0] === String(season));
  if (loaded) $('season-select').value = loaded.value;
  selectedCutoff = null;
  thresholds = {};
  updateTeamControls();
  invalidateReport(true);
}

function toggleSources(force) {
  const open = typeof force === 'boolean' ? force : $('sources-panel').hidden;
  $('sources-panel').hidden = !open;
  $('toggle-sources').setAttribute('aria-expanded', String(open));
}

function renderSearch(results, requiresKey = false) {
  $('search-results').replaceChildren();
  if (!results.length) {
    $('search-results').append(make('span', 'search-note', 'Sin competiciones gratuitas o guardadas para esa búsqueda.'));
    if (requiresKey) {
      const connect = make('button', 'button button-secondary', 'Conectar API-Football'); connect.type = 'button';
      connect.addEventListener('click', () => { toggleSources(true); $('api-key').focus(); });
      $('search-results').append(connect);
    }
    return;
  }
  for (const league of results.slice(0, 24)) {
    const item = make('div', 'search-hit');
    if (league.sourceType === 'api-required') {
      item.append(make('strong', '', league.name), make('span', '', `${league.country} · Sin historial conectado: API propia o CSV`));
      const controls = make('div', 'search-hit-controls');
      const connect = make('button', 'button button-secondary', 'Conectar API-Football'); connect.type = 'button';
      connect.addEventListener('click', () => { toggleSources(true); $('api-key').focus(); });
      const csv = make('button', 'button button-secondary', 'Importar CSV'); csv.type = 'button';
      csv.addEventListener('click', () => {
        toggleSources(true); $('import-league').value = league.name;
        $('import-season').value = new Date().getFullYear(); $('csv-file').focus();
      });
      controls.append(connect, csv); item.append(controls); $('search-results').append(item);
      continue;
    }
    const source = league.sourceType === 'free' ? `Gratis, sin clave${league.historical ? ' · histórico parcial 2025' : ''}` : league.sourceType === 'saved' ? 'Guardada en este equipo' : 'API-Football';
    item.append(make('strong', '', league.name), make('span', '', `${league.country || ''} · ${source}`));
    const controls = make('div', 'search-hit-controls');
    const seasons = make('select');
    seasons.setAttribute('aria-label', `Temporada de ${league.name}`);
    const values = [...(league.seasons || [])];
    seasons.append(...values.map((s) => option(String(s.value ?? s.year ?? s), `${s.label ?? s.year ?? s}${s.current ? ' · actual' : ''}`)));
    if (league.sourceType === 'api' && footballAccess?.allowedSeasons) {
      for (const item of seasons.options) if (!footballAccess.allowedSeasons.includes(Number(item.value))) { item.disabled = true; item.textContent += ' / no disponible en Free'; }
      seasons.value = [...seasons.options].find(item => !item.disabled)?.value || '';
    }
    const current = values.find((s) => s.current);
    if (current) seasons.value = String(current.year);
    const button = make('button', 'button button-secondary', 'Cargar');
    button.type = 'button';
    button.addEventListener('click', () => task(button, 'Cargando…', async () => {
      const label = values.find((s) => String(s.value ?? s.year ?? s) === seasons.value)?.label || seasons.value;
      const saved = catalog.find((item) => item.key === league.key || item.sourceKeys?.includes(league.key));
      if (league.sourceType === 'saved' || saved?.seasons.some((s) => String(s) === label)) {
        await refreshState(league.key); selectLoadedSeason(label);
        message('Liga seleccionada con los datos guardados.');
        return;
      }
      const loaded = league.sourceType === 'free'
        ? await api('/api/free', { division: league.division, season: seasons.value })
        : await api('/api/load', { id: league.id, season: seasons.value });
      await refreshState(loaded.league.key);
      selectLoadedSeason(loaded.selectedSeason || seasons.value);
      message(`${loaded.imported ?? 0} resultados guardados. ${loaded.warning || (league.sourceType === 'api' ? 'Las estadísticas del historial se consultarán al analizar.' : '')}`);
    }));
    controls.append(seasons, button); item.append(controls); $('search-results').append(item);
  }
}

function logoFor(team, history) {
  const match = history.find((m) => (sameTeam(m.home, team) && m.homeLogo) || (sameTeam(m.away, team) && m.awayLogo));
  return match ? sameTeam(match.home, team) ? match.homeLogo : match.awayLogo : null;
}

function renderTeam(side, name, history) {
  $(`${side}-name`).textContent = name;
  $(`${side}-initial`).textContent = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const image = $(`${side}-logo`);
  const logo = logoFor(name, history);
  image.hidden = !logo;
  $(`${side}-initial`).hidden = Boolean(logo);
  if (logo) {
    image.src = logo;
    image.onerror = () => { image.hidden = true; $(`${side}-initial`).hidden = false; };
  }
}

function numberLabel(value) { return value === null || value === undefined ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 }); }
function percentage(value) { return value === null || value === undefined ? 's/d' : `${value}%`; }

function renderAverages() {
  $('averages-body').replaceChildren();
  for (const side of ['home', 'away']) {
    const summary = report.summary[side];
    const row = make('tr');
    row.append(make('td', '', summary.team));
    for (const metric of ['goals', 'corners', 'cards', 'yellow', 'red', 'offsides', 'fouls', 'shotsOnTarget']) {
      const average = summary.averages?.[metric];
      const cell = make('td', '', `${numberLabel(average?.for)} / ${numberLabel(average?.against)}`);
      cell.title = `${average?.n || 0} partidos con datos`;
      row.append(cell);
    }
    row.append(make('td', '', `${summary.wins} / ${summary.draws} / ${summary.losses}`));
    $('averages-body').append(row);
  }
}

function renderMarkets() {
  const scrollLeft = $('market-tabs').scrollLeft;
  const groups = Object.keys(GROUPS).filter((group) => report.markets.some((m) => m.group === group));
  if (!groups.includes(activeGroup)) activeGroup = groups[0];
  $('market-tabs').replaceChildren(...groups.map((group) => {
    const button = make('button', `market-tab${activeGroup === group ? ' active' : ''}`, GROUPS[group]);
    button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(activeGroup === group));
    button.addEventListener('click', () => { activeGroup = group; renderMarkets(); });
    return button;
  }));
  renderMarketRows('market-content', activeGroup);
  $('market-tabs').scrollLeft = scrollLeft;
  $('threshold-form').hidden = !METRICS[activeGroup] && !HANDICAP_GROUPS[activeGroup];
  configureHandicapInput($('custom-line'), activeGroup);
  document.querySelector('label[for="custom-line"]').textContent = HANDICAP_GROUPS[activeGroup] ? 'Otra linea de handicap' : 'Otro limite para este escenario';
}

function renderMarketRows(target, group) {
  $(target).replaceChildren();
  const config = HANDICAP_GROUPS[group], prefix = target === 'half-market-content' ? 'half-handicap' : 'handicap';
  $(`${prefix}-line-field`).hidden = !config;
  const candidates = report.markets.filter(m => m.group === group);
  if (config) {
    const lines = [...new Set(candidates.map(m => m.line))];
    if (!lines.includes(handicapSelections[group])) handicapSelections[group] = lines.includes(config.kind === 'european' ? -1 : 0) ? config.kind === 'european' ? -1 : 0 : lines[0];
    $(`${prefix}-line`).replaceChildren(...lines.map(line => option(line, handicapLabel(line))));
    $(`${prefix}-line`).value = String(handicapSelections[group]);
    $(target).append(make('p', 'handicap-note', config.kind === 'european' ? 'Tres resultados despues de aplicar la linea al local. El empate con handicap es un resultado, no una devolucion.' : 'Porcentaje principal: victoria completa. Las medias victorias y devoluciones se muestran por separado.'));
  }
  for (const market of candidates.filter(m => !config || m.line === handicapSelections[group])) {
    const row = make('div', 'market-row');
    const title = make('div');
    title.append(make('div', 'market-title', market.label));
    title.append(make('div', 'market-detail', `${market.samples?.league ?? 0} partidos de referencia · ${market.quality === 'adequate' ? 'muestra disponible' : market.quality === 'unavailable' ? 'datos insuficientes' : 'muestra reducida'}`));
    const track = make('div', 'prob-track');
    const fill = make('div', 'prob-fill'); fill.style.width = `${market.probability ?? 0}%`; track.append(fill);
    if (market.probability === null || market.probability === undefined) fill.hidden = true;
    const observed = make('div', 'observed');
    for (const side of ['home', 'away']) {
      const sample = market.observed?.[side];
      const line = make('div', '', `${side === 'home' ? 'Local' : 'Visitante'}: ${sample?.n ? `${sample.hits}/${sample.n} en historial` : 's/d'}`);
      if (sample?.interval95) line.title = `Intervalo 95% de la frecuencia observada: ${sample.interval95.low}% a ${sample.interval95.high}%`;
      observed.append(line);
    }
    const probability = make('div', 'prob-value', percentage(market.probability));
    if (market.handicapKind === 'asian') { probability.title = 'Probabilidad de victoria completa'; title.append(make('div', 'market-detail', `Victoria completa${market.splitLines.length === 2 ? ` / dividida en ${market.splitLines.map(handicapLabel).join(' y ')}` : ''}`)); }
    row.append(title, track, probability, observed);
    if (market.handicapKind === 'asian') {
      const strip = make('div', 'handicap-settlement');
      for (const [key, label] of Object.entries(SETTLEMENTS)) { const cell = make('div'); cell.append(make('span', '', label), make('strong', '', percentage(market.settlement?.[key]))); strip.append(cell); }
      row.append(strip);
      for (const side of ['home', 'away']) {
        const sample = market.historicalSettlement[side];
        observed.children[side === 'home' ? 0 : 1].textContent = `${side === 'home' ? 'Local' : 'Visitante'}: ${sample.n ? `${sample.counts.fullWin}/${sample.n} victorias completas` : 's/d'}`;
        observed.children[side === 'home' ? 0 : 1].title = Object.entries(SETTLEMENTS).map(([key, label]) => `${label}: ${sample.counts[key]}/${sample.n}`).join(' / ');
      }
    }
    $(target).append(row);
  }
}

function renderHalfMarkets() {
  $('half-market-tabs').replaceChildren(...Object.entries(HALF_GROUPS).map(([group, label]) => {
    const button = make('button', `market-tab${activeHalfGroup === group ? ' active' : ''}`, label);
    button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(activeHalfGroup === group));
    button.addEventListener('click', () => { activeHalfGroup = group; renderHalfMarkets(); });
    return button;
  }));
  renderMarketRows('half-market-content', activeHalfGroup);
  $('half-handicap-form').hidden = !HANDICAP_GROUPS[activeHalfGroup];
  configureHandicapInput($('half-handicap-custom'), activeHalfGroup);
  $('half-averages-body').replaceChildren();
  for (const side of ['home', 'away']) {
    const summary = report.summary[side];
    const row = make('tr'); row.append(make('td', '', summary.team));
    for (const metric of ['halfTimeGoals', 'halfTimeCorners']) {
      const average = summary.averages[metric];
      row.append(make('td', '', `${numberLabel(average?.for)} / ${numberLabel(average?.against)}`), make('td', '', String(average?.n || 0)));
    }
    $('half-averages-body').append(row);
  }
}

function statPair(match, team, metric) {
  if (metric === 'halfTimeCorners') {
    const atHome = sameTeam(match.home, team);
    return `${numberLabel(match.halfTime?.[atHome ? 'homeCorners' : 'awayCorners'])} / ${numberLabel(match.halfTime?.[atHome ? 'awayCorners' : 'homeCorners'])}`;
  }
  const own = sameTeam(match.home, team) ? match.stats?.home : match.stats?.away;
  const other = sameTeam(match.home, team) ? match.stats?.away : match.stats?.home;
  const value = (stats) => metric === 'cards' ? stats?.yellow !== null && stats?.yellow !== undefined && stats?.red !== null && stats?.red !== undefined ? stats.yellow + stats.red : null : stats?.[metric];
  return `${numberLabel(value(own))} / ${numberLabel(value(other))}`;
}

function renderHistory(side) {
  const name = report.meta[side];
  const history = report.history[side];
  $(`${side}-history-title`).textContent = name;
  $(`${side}-history-count`).textContent = `${history.length} partidos`;
  const body = $(`${side}-history-body`); body.replaceChildren();
  for (const match of history) {
    const atHome = sameTeam(match.home, name);
    const ownGoals = atHome ? match.homeGoals : match.awayGoals;
    const against = atHome ? match.awayGoals : match.homeGoals;
    const row = make('tr');
    const opponent = atHome ? match.away : match.home;
    const teamCell = make('td', '', `${atHome ? 'L' : 'V'} · ${opponent}`); teamCell.title = `${match.home} - ${match.away} · ${match.source || 'archivo'}`;
    row.append(make('td', '', dateLabel(match.date)), teamCell, make('td', ownGoals > against ? 'result-win' : ownGoals < against ? 'result-loss' : 'result-draw', `${match.homeGoals}-${match.awayGoals}`));
    for (const metric of ['corners', 'cards', 'red', 'offsides', 'fouls', 'shotsOnTarget']) row.append(make('td', '', statPair(match, name, metric)));
    row.append(make('td', '', `${numberLabel(match.halfTime?.homeGoals)}-${numberLabel(match.halfTime?.awayGoals)}`), make('td', '', statPair(match, name, 'halfTimeCorners')));
    row.title = [match.integrityWarning, ...Object.entries(match.fieldSources || {}).map(([field, ref]) => `${footballFieldLabel(field)}: ${ref.source} / ${ref.id}`)].filter(Boolean).join('\n');
    if (match.sourceRefs?.length > 1 || match.integrityWarning) {
      const details = make('details'), summary = make('summary', '', 'Fuentes'); details.append(summary);
      for (const [field, ref] of Object.entries(match.fieldSources || {})) details.append(make('p', '', `${footballFieldLabel(field)}: ${ref.source} / ${ref.id}`));
      for (const conflict of match.fieldConflicts || []) details.append(make('p', '', `${footballFieldLabel(conflict.field)} / discrepancia: ${conflict.values.map(row => `${row.source}: ${row.value}`).join('; ')}`));
      if (match.integrityWarning) details.append(make('p', '', match.integrityWarning)); teamCell.append(details);
    }
    body.append(row);
  }
  if (!history.length) { const row = make('tr'); const cell = make('td', '', 'No hay historial antes de la fecha de corte.'); cell.colSpan = 11; row.append(cell); body.append(row); }
}

function renderReport(value) {
  report = value;
  relevantContext.show({ sport: 'football', kind: 'team', key: value.meta.leagueKey || $('league-select').value,
    season: String(value.meta.season), names: [value.meta.home, value.meta.away], lookback: value.meta.lookback || lookback, cutoff: value.meta.cutoff });
  $('empty-state').hidden = true; $('report').hidden = false;
  renderTeam('home', value.meta.home, value.history.home); renderTeam('away', value.meta.away, value.history.away);
  $('match-context').textContent = `${value.meta.leagueName || selectedLeague()?.name || ''} · ${value.meta.season || ''}`;
  $('report-sample').textContent = `${value.history.home.length} partidos del local · ${value.history.away.length} del visitante`;
  $('report-coverage').textContent = `Corte: ${dateLabel(value.meta.cutoff)}`;
  $('method-description').textContent = `${value.meta.model}. Las medias se suavizan hacia la liga; el resultado, ambos marcan y los totales de goles provienen de la misma distribución de marcadores. El modelo aún no está calibrado con una evaluación independiente por liga.`;
  $('quality-messages').replaceChildren(...(value.quality?.messages || []).map((text) => make('li', '', text)));
  renderAverages(); renderMarkets(); renderHalfMarkets(); renderHistory('home'); renderHistory('away');
  $('h2h-count').textContent = `${value.history.h2h.length} encuentros`;
  $('h2h-list').replaceChildren(...value.history.h2h.map((match) => {
    const item = make('div', 'h2h-item'); item.append(make('span', '', `${dateLabel(match.date)} · ${match.home} `), make('strong', '', `${match.homeGoals}-${match.awayGoals}`), make('span', '', ` ${match.away}`)); return item;
  }));
  if (!value.history.h2h.length) $('h2h-list').append(make('span', 'h2h-empty', 'Sin enfrentamientos directos en el archivo previo al corte.'));
  message(value.meta.providerWarning || 'Análisis calculado con el historial disponible.');
  $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function analyze() {
  const value = await api('/api/report', { leagueKey: $('league-select').value, season: $('season-select').value, home: $('home-select').value, away: $('away-select').value, lookback, cutoff: cutoff(), thresholds });
  renderReport(value); await refreshState($('league-select').value);
}

function marketValue(fixture, id) { return fixture.markets?.find((m) => m.id === id)?.probability ?? null; }

function renderRankings() {
  const body = $('fixture-body'); body.replaceChildren();
  const marketId = $('ranking-market').value;
  const sorted = [...rankings].sort((a, b) => (marketValue(b, marketId) ?? -1) - (marketValue(a, marketId) ?? -1));
  for (const fixture of sorted) {
    const row = make('tr');
    const encounter = make('td', '', `${fixture.home} - ${fixture.away}`);
    if (fixture.manual) encounter.append(make('small', 'manual-tag', 'Calendario manual'));
    row.append(make('td', '', dateLabel(fixture.date)), encounter);
    for (const id of ['btts-yes', 'goals-over-1.5', 'goals-over-2.5', 'goals-over-3.5', marketId]) {
      const cell = make('td', '', percentage(marketValue(fixture, id))), market = fixture.markets?.find(item => item.id === id);
      if (market?.handicapKind === 'asian') cell.title = `Victoria completa. ${Object.entries(SETTLEMENTS).map(([key, label]) => `${label}: ${percentage(market.settlement?.[key])}`).join(' / ')}`;
      row.append(cell);
    }
    const cell = make('td'); const button = make('button', 'button button-secondary', 'Abrir'); button.type = 'button';
    button.addEventListener('click', () => {
      $('home-select').value = fixture.home; $('away-select').value = fixture.away;
      selectedCutoff = fixture.analysisCutoff || cutoff(); $('cutoff-date').value = localDate(selectedCutoff);
      task(button, 'Abriendo…', analyze);
    });
    cell.append(button);
    if (fixture.manual) {
      const remove = make('button', 'button button-secondary', 'Quitar'); remove.type = 'button';
      remove.addEventListener('click', () => task(remove, 'Quitando...', async () => {
        await api('/api/fixtures/manual/remove', { leagueKey: $('league-select').value, season: $('season-select').value, id: fixture.id });
        await refreshState($('league-select').value); await calculateList();
      }));
      cell.append(remove);
    }
    row.append(cell); body.append(row);
  }
  const saved = selectedLeague()?.fixtureCountBySeason?.[$('season-select').value] || 0;
  $('calendar-note').textContent = rankingNote || (saved ? `${saved} encuentros en el calendario guardado. Estimaciones pendientes de calcular.` : 'Sin calendario guardado para esta temporada. Hay historial de resultados, pero no próximos encuentros cargados.');
  if (!rankings.length) { const row = make('tr'); const cell = make('td', '', 'Sin encuentros calculados.'); cell.colSpan = 8; row.append(cell); body.append(row); }
}

async function calculateList() {
  const result = await api('/api/list', { leagueKey: $('league-select').value, season: $('season-select').value, lookback, cutoff: cutoff() });
  rankings = result.fixtures || [];
  rankingNote = [result.note, result.coverageNote].filter(Boolean).join(' ');
  renderRankings();
}

async function search() {
  if (footballSourceMode() === 'footystats') return;
  const query = $('league-search').value.trim();
  if (!query) throw new Error('Escribe una liga o país.');
  const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
  renderSearch(result.results || [], result.requiresKey); await refreshState(); message(result.note || '');
}

function exportReport() {
  if (!report) return;
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['liga', 'temporada', 'local', 'visitante', 'corte', 'escenario', 'estimacion_porcentaje', 'local_ocurrencias', 'local_muestra', 'visitante_ocurrencias', 'visitante_muestra', 'partidos_liga', 'calidad', 'tipo_handicap', 'linea_handicap', 'significado_porcentaje', ...Object.keys(SETTLEMENTS)]];
  for (const market of report.markets) rows.push([report.meta.leagueName, report.meta.season, report.meta.home, report.meta.away, report.meta.cutoff, market.label, market.probability, market.observed.home.hits, market.observed.home.n, market.observed.away.hits, market.observed.away.n, market.samples.league, market.quality, market.handicapKind, market.line, market.probabilityMeaning, ...Object.keys(SETTLEMENTS).map(key => market.settlement?.[key])]);
  const blob = new Blob(['\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = make('a'); link.href = URL.createObjectURL(blob); link.download = `analisis-${report.meta.home}-${report.meta.away}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('workspace-date').textContent = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'long' }).format(new Date());
renderRankingControls();
$('cutoff-date').value = localDate();
$('toggle-sources').addEventListener('click', () => toggleSources());
$('empty-connect').addEventListener('click', () => toggleSources(true));
$('league-select').addEventListener('change', () => {
  thresholds = {}; selectedCutoff = null; updateLeagueControls(); invalidateReport(true);
  const pending = apiLeagues.find(league => league.key === $('league-select').value);
  if (pending) { $('league-search').value = pending.name; task($('search-button'), 'Buscando...', search); }
});
$('season-select').addEventListener('change', () => { thresholds = {}; selectedCutoff = null; updateTeamControls(); invalidateReport(true); });
for (const id of ['home-select', 'away-select']) $(id).addEventListener('change', () => { selectedCutoff = null; updateAnalyzeButton(); invalidateReport(); });
$('cutoff-date').addEventListener('change', () => { selectedCutoff = null; invalidateReport(true); });
document.querySelectorAll('[data-lookback]').forEach((button) => button.addEventListener('click', () => {
  lookback = Number(button.dataset.lookback);
  document.querySelectorAll('[data-lookback]').forEach((segment) => { const active = Number(segment.dataset.lookback) === lookback; segment.classList.toggle('active', active); segment.setAttribute('aria-pressed', String(active)); });
  invalidateReport(true);
}));
$('analyze-button').addEventListener('click', () => task($('analyze-button'), 'Calculando…', analyze));
$('search-button').addEventListener('click', () => task($('search-button'), 'Buscando...', search));
$('league-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('search-button').click(); } });
$('key-form').addEventListener('submit', (event) => { event.preventDefault(); task(event.submitter, 'Verificando...', async () => {
  const key = $('api-key').value.trim(); $('api-key').value = '';
  let result; try { result = await api('/api/key', { key, remember: $('api-remember')?.checked ?? true }); } finally { await refreshState(); document.dispatchEvent(new Event('observatorio:credentials')); }
  message(`Clave verificada. Plan ${result.connection.plan}. ${/free/i.test(result.connection.plan) ? 'Las temporadas actuales pueden estar bloqueadas. En Jugadores, selecciona una liga API y una temporada disponible.' : 'Selecciona una liga API y comprueba su cobertura individual.'}`, false, 'source-message');
}, 'source-message'); });
$('football-verify').addEventListener('click', event => task(event.currentTarget, '...', async () => {
  try { await api('/api/football/connection', {}); } finally { await refreshState(); }
  message('Conexion y plan comprobados. No se cambio ni contrato ninguna suscripcion.', false, 'source-message');
}, 'source-message'));
$('import-form').addEventListener('submit', (event) => { event.preventDefault(); task(event.submitter, 'Importando…', async () => { const file = $('csv-file').files[0]; if (!file) throw new Error('Selecciona un CSV.'); const season = $('import-season').value.trim(); const loaded = await api('/api/import', { csv: await file.text(), leagueName: $('import-league').value.trim(), season, timeZone: $('import-timezone').value }); await refreshState(loaded.league.key); selectLoadedSeason(season); message(`${loaded.imported} partidos guardados${loaded.skipped ? `; ${loaded.skipped} filas sin marcador omitidas` : ''}.`, false, 'source-message'); }, 'source-message'); });
$('europe-division').addEventListener('change', () => { updateFreeSeasons(); message('', false, 'source-message'); });
$('europe-season').addEventListener('change', () => message('', false, 'source-message'));
$('europe-form').addEventListener('submit', (event) => { event.preventDefault(); task(event.submitter, 'Descargando…', async () => { const season = $('europe-season').value; const loaded = await api('/api/free', { division: $('europe-division').value, season }); await refreshState(loaded.league.key); selectLoadedSeason(loaded.selectedSeason || season); message(`${loaded.imported} resultados guardados y ${loaded.previousImported || 0} de la temporada anterior. ${loaded.warning || ''}`, false, 'source-message'); }, 'source-message'); });
$('list-button').addEventListener('click', () => task($('list-button'), 'Calculando...', calculateList));
$('add-fixture-button').addEventListener('click', () => {
  const form = $('manual-fixture-form'); form.hidden = !form.hidden;
  $('add-fixture-button').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) {
    if ($('home-select').value) $('fixture-home').value = $('home-select').value;
    if ($('away-select').value) $('fixture-away').value = $('away-select').value;
    $('fixture-date').value = localDate(new Date(new Date(cutoff()).valueOf() + 86400000));
    $('fixture-home').focus();
  }
});
$('cancel-fixture-button').addEventListener('click', () => { $('manual-fixture-form').hidden = true; $('add-fixture-button').setAttribute('aria-expanded', 'false'); });
$('manual-fixture-form').addEventListener('submit', event => {
  event.preventDefault(); task(event.submitter, 'Guardando...', async () => {
    await api('/api/fixtures/manual', { leagueKey: $('league-select').value, season: $('season-select').value,
      home: $('fixture-home').value, away: $('fixture-away').value, date: $('fixture-date').value, time: $('fixture-time').value, cutoff: cutoff() });
    $('manual-fixture-form').hidden = true; $('add-fixture-button').setAttribute('aria-expanded', 'false');
    await refreshState($('league-select').value); await calculateList();
  });
});
$('ranking-market').addEventListener('change', renderRankings);
$('threshold-form').addEventListener('submit', (event) => {
  event.preventDefault(); const config = HANDICAP_GROUPS[activeGroup], metric = config?.key || METRICS[activeGroup], line = Number($('custom-line').value);
  if (!metric || (config ? !validHandicap(line, config.kind) : !Number.isFinite(line) || line <= 0 || line >= 100 || line % 1 !== .5)) { message(config ? `Usa una linea entre -10 y +10 en pasos de ${config.step}.` : 'El limite debe terminar en .5 y estar entre 0.5 y 99.5.', true); return; }
  thresholds[metric] = [...new Set([...(thresholds[metric] || []), line])];
  if (config) handicapSelections[activeGroup] = line;
  task(event.submitter, 'Calculando...', analyze);
});
for (const [id, group] of [['handicap-line', () => activeGroup], ['half-handicap-line', () => activeHalfGroup]]) $(id).addEventListener('change', () => {
  handicapSelections[group()] = Number($(id).value); renderMarketRows(id === 'handicap-line' ? 'market-content' : 'half-market-content', group());
});
$('half-handicap-form').addEventListener('submit', event => {
  event.preventDefault(); const config = HANDICAP_GROUPS[activeHalfGroup], line = Number($('half-handicap-custom').value);
  if (!config || !validHandicap(line, config.kind)) { message('Linea de handicap 1T no valida.', true); return; }
  thresholds[config.key] = [...new Set([...(thresholds[config.key] || []), line])]; handicapSelections[activeHalfGroup] = line;
  task(event.submitter, 'Calculando...', analyze);
});
$('export-button').addEventListener('click', exportReport);
refreshState().catch((error) => message(error.message, true));
