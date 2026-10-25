import { mountPlayerMarkets } from './player-markets.js';
import { mountRelevantContext } from './relevant-context.js';
import { footballSourceMode, filterFootballSources, footballFieldLabel } from './football-source.js';
import { createProfileRefresh } from './profile-refresh.js';
import { HANDICAP_GROUPS, SETTLEMENTS, handicapLabel, validHandicap, configureHandicapInput } from './football-handicap.js';
const $ = id => document.getElementById(id);
const relevantContext = mountRelevantContext($('profile-report'));
const node = (tag, text = '', className) => { const item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; };
const option = (value, text) => { const item = node('option', text); item.value = value; return item; };
const number = value => value === null || value === undefined ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 1 });
const dateLabel = value => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value));
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
};
let sport = 'football';
let individual = false;
let footballPlayersMode = false;
let busy = false;
let revision = 0;
let state;
let catalog;
let report;
let playerMarkets;
let lookback = 10;
let scenarioLines = {};
const preferences = {};
const handicapSelections = {};
const dataRefresh = createProfileRefresh({
  current: () => {
    if (!individual || sport !== 'football' || document.body.dataset.activeSport !== 'football' || !report) return null;
    const body = { ...selection(), metric: report.meta.metric, thresholds: scenarioLines };
    return { body, key: JSON.stringify({ ...body, cutoff: $('profile-cutoff').value }),
      defer: busy || Boolean(document.activeElement?.closest('#profile-report form')) };
  },
  load: item => api('/api/profiles/report', item.body), apply: render,
  onError: () => message('No se completo la actualizacion del analisis. Se conserva el resultado anterior.', true),
});
const SCENARIO_GROUPS = { ...Object.fromEntries(Object.entries(HANDICAP_GROUPS).map(([key, config]) => [key, config.label])), resultado: 'Resultado: gana, empata o pierde', 'doble-oportunidad': 'Doble oportunidad', 'ambos-marcan': 'Ambos marcan',
  goles: 'Goles', corners: 'Córners', tarjetas: 'Tarjetas (amarillas + rojas)', 'tarjetas-amarillas': 'Amarillas', 'tarjetas-rojas': 'Tarjetas rojas', 'fuera-de-juego': 'Fuera de juego', faltas: 'Faltas', tiros: 'Tiros', 'tiros-al-arco': 'Tiros al arco',
  'resultado-1t': 'Resultado al descanso', 'goles-1t': 'Goles del primer tiempo', 'corners-1t': 'Córners del primer tiempo' };

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo consultar el historial.');
  return result;
}
function message(text = '', error = false) { $('profile-message').textContent = text; $('profile-message').classList.toggle('error', error); }
function selection() {
  return { sport, leagueKey: $('profile-league').value, season: $('profile-season').value,
    kind: sport === 'tennis' ? 'player' : $('profile-kind').value, name: $('profile-name').value,
    playerTeam: sport === 'nba' && $('profile-kind').value === 'player' ? $('profile-player-team').value : '',
    cutoff: $('profile-cutoff').value === today() ? new Date().toISOString() : `${$('profile-cutoff').value}T23:59:59-05:00`, lookback, venue: sport === 'tennis' ? 'all' : $('profile-venue').value,
    category: sport === 'tennis' ? $('profile-category').value : 'all', surface: sport === 'tennis' ? $('profile-surface').value : 'all' };
}
function buttons() {
  $('profile-analyze').disabled = busy || !$('profile-name').value;
  $('profile-import-button').disabled = busy || !$('profile-season').value || (sport === 'football' && !$('profile-league').value);
  $('profile-load-nba').disabled = busy || !$('profile-season').value || !($('profile-kind').value === 'player' ? $('profile-player-team').value : $('profile-name').value);
  $('profile-load-nba').textContent = busy ? 'Cargando...' : 'Cargar jugadores del equipo';
}
function invalidate() { dataRefresh.cancel(); relevantContext.hide(); report = null; scenarioLines = {}; $('profile-report').hidden = true; $('profile-empty').hidden = false; message(); buttons(); }
async function task(action) {
  if (busy) return;
  busy = true; buttons();
  const shell = document.querySelector('.app-shell'); const main = document.querySelector('main');
  main.inert = true; shell.setAttribute('aria-busy', 'true'); message();
  try { await action(); } catch (error) { message(error.message, true); }
  finally { busy = false; main.inert = false; shell.setAttribute('aria-busy', 'false'); buttons(); }
}
function visibility() {
  $('profile-history-field').classList.toggle('football-history-six', sport !== 'tennis');
  document.querySelectorAll('[data-profile-lookback="25"], [data-profile-lookback="30"]').forEach(button => { button.hidden = sport === 'tennis'; });
  const players = sport === 'football' && footballPlayersMode;
  const footyPlayers = players && footballSourceMode() === 'footystats';
  $('view-football-players').hidden = sport !== 'football';
  $('football-players-workspace').hidden = !players || footyPlayers;
  $('fs-players-workspace').hidden = !footyPlayers;
  $('individual-workspace').hidden = !individual || players;
  $('individual-workspace').setAttribute('aria-labelledby', `sport-${sport}`);
  document.querySelectorAll('[data-sport]').forEach(button => button.setAttribute('aria-controls', button.dataset.sport === 'basketball' ? 'basketball-workspace' : button.dataset.sport === 'football' && players ? 'football-players-workspace' : individual ? 'individual-workspace' : button.dataset.sport === 'football' ? 'football-workspace' : 'sports-workspace'));
  $('football-workspace').hidden = individual || sport !== 'football' || players;
  $('sports-workspace').hidden = individual || sport === 'football';
  for (const [id, active] of [['view-match', !individual && !players], ['view-individual', individual && !players], ['view-football-players', players]]) {
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active));
  }
  document.dispatchEvent(new CustomEvent('observatorio:football-view', { detail: players ? 'players' : individual ? 'individual' : 'matches' }));
}
function seasons(preferred) {
  const available = sport === 'football' ? state.football.find(league => league.key === $('profile-league').value)?.seasons || [] : state.sports[sport].seasons;
  $('profile-season').replaceChildren(...available.map(season => option(season, season)));
  const chosen = available.find(season => String(season) === String(preferred) || String(season).split('/')[0] === String(preferred));
  if (chosen !== undefined) $('profile-season').value = chosen;
  $('profile-season').disabled = !available.length;
}
async function names(preferred, preferredTeam = $('profile-player-team').value) {
  const current = ++revision;
  if (!$('profile-season').value) { catalog = { teams: [], players: [] }; }
  else {
    const result = await api('/api/profiles/catalog', { ...selection(), playerTeam: sport === 'nba' && $('profile-kind').value === 'player' ? preferredTeam : '' });
    if (current !== revision) return;
    catalog = result;
  }
  const player = sport === 'tennis' || $('profile-kind').value === 'player';
  $('profile-player-team-field').hidden = sport !== 'nba' || !player;
  $('profile-load-nba').hidden = sport !== 'nba';
  $('profile-player-team').replaceChildren(option('', 'Todos'), ...catalog.teams.map(team => option(team, team)));
  if (catalog.teams.includes(preferredTeam)) $('profile-player-team').value = preferredTeam;
  const available = player ? catalog.players : catalog.teams;
  $('profile-name-label').textContent = player ? 'Jugador' : 'Equipo';
  $('profile-name').replaceChildren(option('', player ? 'Seleccionar jugador' : 'Seleccionar equipo'), ...available.map(name => option(name, name)));
  if (available.includes(preferred)) $('profile-name').value = preferred;
  $('profile-name').disabled = !available.length;
  $('profile-import-form').hidden = !player || sport === 'tennis' || sport === 'football' && footballSourceMode() === 'footystats';
  $('profile-template').href = `/templates/${sport}-players.csv`;
  $('profile-empty').textContent = available.length ? 'Selecciona un equipo o jugador.' : player && sport !== 'tennis'
    ? 'Sin registros individuales de jugadores. Los datos de equipos no incluyen sus estadísticas personales.'
    : 'Sin resultados guardados para esta temporada.';
  buttons();
}
async function activate() {
  visibility(); invalidate();
  const selectedSport = sport;
  const result = await api('/api/profiles/state');
  if (selectedSport !== sport || !individual) return;
  state = result;
  state.football = filterFootballSources(footballSourceMode() === 'combined' ? state.football : state.footballRaw || state.football);
  const saved = preferences[sport] || {};
  $('profile-league-field').hidden = sport !== 'football'; $('profile-kind-field').hidden = sport === 'tennis';
  $('profile-venue-field').hidden = sport === 'tennis'; $('profile-category-field').hidden = sport !== 'tennis'; $('profile-surface-field').hidden = sport !== 'tennis';
  $('profile-league').replaceChildren(...state.football.map(league => option(league.key, `${league.name}${league.country ? ` / ${league.country}` : ''}${league.source === 'FootyStats' && !league.seasons.length ? ' / sin historial autorizado' : ''}`)));
  const currentLeague = saved.leagueKey || $('league-select').value;
  const current = state.football.find(league => league.key === currentLeague || league.sourceKeys?.includes(currentLeague));
  if (current) $('profile-league').value = current.key;
  seasons(saved.season || $(sport === 'football' ? 'season-select' : 'sp-season').value);
  $('profile-kind').value = saved.kind || 'team'; $('profile-venue').value = saved.venue || 'all';
  const footy = sport === 'football' && footballSourceMode() === 'footystats';
  $('profile-kind').querySelector('option[value="player"]').disabled = footy;
  if (footy) $('profile-kind').value = 'team';
  $('profile-category').value = saved.category || 'all'; $('profile-surface').value = saved.surface || 'all';
  const savedDate = saved.cutoff?.slice(0, 10);
  $('profile-cutoff').value = /^\d{4}-\d{2}-\d{2}$/.test(savedDate || '') ? savedDate : today(); lookback = saved.lookback || 10;
  document.querySelectorAll('[data-profile-lookback]').forEach(button => { const active = Number(button.dataset.profileLookback) === lookback; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  await names(saved.name || $(sport === 'football' ? 'home-select' : 'sp-home').value, saved.playerTeam || '');
}
function row(values, header = false) {
  const item = node('tr'); values.forEach(value => item.append(node(header ? 'th' : 'td', value))); return item;
}
function renderScenarios(prefix, period) {
  const group = $(`${prefix}-scenario-group`).value, scope = $(`${prefix}-scenario-scope`).value;
  const candidates = (report?.scenarios || []).filter(item => item.period === period && item.group === group);
  const config = HANDICAP_GROUPS[group], asian = config?.kind === 'asian';
  const count = !config && candidates.some(item => item.scope !== null);
  $(`${prefix}-scenario-scope-field`).hidden = !count;
  $(`${prefix}-scenario-form`).hidden = !count && !config;
  $(`${prefix}-handicap-field`).hidden = !config;
  $(`${prefix}-handicap-note`).hidden = !config;
  configureHandicapInput($(`${prefix}-scenario-line`), group);
  if (config) {
    const lines = [...new Set(candidates.map(item => item.line))];
    if (!lines.includes(handicapSelections[group])) handicapSelections[group] = config.kind === 'european' ? -1 : 0;
    $(`${prefix}-handicap-line`).replaceChildren(...lines.map(line => option(line, handicapLabel(line))));
    $(`${prefix}-handicap-line`).value = String(handicapSelections[group]);
    $(`${prefix}-handicap-note`).textContent = asian ? 'Frecuencias del equipo seleccionado: victoria completa, media victoria, devolucion, media perdida y derrota. Un empate devuelto no cuenta como victoria.' : 'La linea se aplica al equipo seleccionado, no necesariamente al local del partido historico. Tres resultados tras el ajuste; sin devolucion.';
  }
  const visible = candidates.filter(item => (!count || item.scope === scope) && (!config || item.line === handicapSelections[group]));
  const table = $(`${prefix}-scenario-body`).closest('table');
  table.classList.toggle('handicap-settlement-table', asian);
  table.tHead.replaceChildren(row(asian ? ['Equipo y linea', ...Object.values(SETTLEMENTS)] : ['Escenario', 'Cumplidos / con datos', 'Prob. historica', 'Intervalo 95%'], true));
  $(`${prefix}-scenario-body`).replaceChildren(...visible.map(item => {
    if (asian) {
      const entry = row([`${item.label}${item.splitLines.length === 2 ? ` (${item.splitLines.map(handicapLabel).join(' / ')})` : ''}`,
        ...Object.keys(SETTLEMENTS).map(key => item.n ? `${item.historicalSettlement.counts[key]}/${item.n} · ${item.settlement ? number(item.settlement[key]) + ' %' : 's/d'}` : 's/d')]);
      entry.title = `${item.missing} partidos sin marcador del periodo. Porcentajes historicos, no pronosticos calibrados.`;
      return entry;
    }
    const interval = item.interval95 ? `${number(item.interval95.low)}–${number(item.interval95.high)} %` : 's/d';
    const entry = row([item.label, item.n ? `${item.hits} / ${item.n}` : 's/d', item.probability === null ? 's/d' : `${number(item.probability)} %`, interval]);
    entry.children[1].title = `${item.missing} partidos sin datos para este escenario.`;
    entry.children[2].title = item.n < 3 ? 'Menos de 3 partidos con datos; no se muestra un porcentaje.' : 'Frecuencia histórica del equipo, sin ajuste por rival.';
    if (item.probability === null) entry.children[2].classList.add('profile-missing');
    return entry;
  }));
  const metric = visible[0]?.metric;
  if (metric) $(`${prefix}-scenario-line`).value = Math.min(99.5, Math.max(...report.summary.find(field => field.id === metric).lines) + 1);
}
function renderFootballScenarios(result) {
  const btts = result.scenarios.find(item => item.id === 'btts-yes');
  $('profile-btts').textContent = `Ambos marcan (hist.): ${btts.probability === null ? 's/d' : `${number(btts.probability)} %`} / ${btts.hits} de ${btts.n}`;
  $('profile-scenario-note').textContent = result.scenarioNote;
  $('profile-team-note').textContent = result.note + ' La ventana puede incluir temporadas anteriores.';
  const half = result.record.halfTime;
  $('profile-half-record').textContent = `${half.played} con marcador al descanso / ${half.wins} ganados / ${half.draws} empatados / ${half.losses} perdidos / ${result.history.length - half.played} sin marcador 1T`;
  $('profile-half-summary-body').replaceChildren(...['halfTimeGoals', 'halfTimeCorners'].map(id => {
    const fields = ['', 'Against', 'Total'].map(suffix => result.summary.find(field => field.id === id + suffix));
    return row([id === 'halfTimeGoals' ? 'Goles 1T' : 'Córners 1T', ...fields.map(field => `${number(field.average)} (${field.n})`)]);
  }));
  for (const [prefix, period] of [['profile-ft', 'ft'], ['profile-ht', 'ht']]) {
    const current = $(`${prefix}-scenario-group`).value;
    const groups = [...new Set(result.scenarios.filter(item => item.period === period).map(item => item.group))];
    $(`${prefix}-scenario-group`).replaceChildren(...groups.map(group => option(group, SCENARIO_GROUPS[group])));
    if (groups.includes(current)) $(`${prefix}-scenario-group`).value = current;
    renderScenarios(prefix, period);
  }
}
function render(result) {
  report = result; $('profile-report').hidden = false; $('profile-empty').hidden = true;
  if (result.meta.kind === 'team') relevantContext.show({ ...result.meta, key: result.meta.leagueKey || 'nba', names: [result.meta.name] });
  else relevantContext.hide();
  $('profile-title').textContent = result.meta.name;
  $('profile-context').textContent = `${result.meta.competition} · ${result.meta.season} · ${result.meta.kind === 'team' ? 'Equipo' : 'Jugador'}`;
  $('profile-sample').textContent = `${result.record.played} de ${result.meta.lookback} partidos · ${result.meta.venue === 'home' ? 'Local' : result.meta.venue === 'away' ? 'Visitante' : 'Todas las condiciones'}`;
  $('profile-record').hidden = !result.record.resultsN;
  $('profile-record').textContent = `${result.record.wins} victorias · ${result.record.draws} empates · ${result.record.losses} derrotas`;
  $('profile-date').textContent = `Corte: ${dateLabel(result.meta.cutoff)}`;
  const footballTeam = result.meta.sport === 'football' && result.meta.kind === 'team';
  $('profile-football-scenarios').hidden = !footballTeam;
  $('profile-half-section').hidden = !footballTeam;
  $('profile-btts').hidden = !footballTeam;
  $('profile-frequency-section').hidden = footballTeam;
  $('profile-history-body').closest('table').classList.toggle('profile-football-history', footballTeam);
  if (footballTeam) {
    $('profile-summary-head').replaceChildren(row(['Estadística', 'A favor (n)', 'En contra (n)', 'Total del encuentro (n)'], true));
    const fields = result.summary.filter(field => !field.id.endsWith('Against') && !field.id.endsWith('Total') && !field.id.startsWith('halfTime'));
    $('profile-summary-body').replaceChildren(...fields.map(field => {
      const averages = [field, ...['Against', 'Total'].map(suffix => result.summary.find(item => item.id === field.id + suffix))];
      return row([field.label.replace(' a favor', ''), ...averages.map(item => `${number(item.average)} (${item.n})`)]);
    }));
  } else {
    $('profile-summary-head').replaceChildren(row(['Estadística', 'Promedio', 'Mínimo', 'Máximo', 'Con datos'], true));
    $('profile-summary-body').replaceChildren(...result.summary.map(field => row([field.label, number(field.average), number(field.min), number(field.max), field.n])));
  }
  $('profile-metric').replaceChildren(...result.summary.map(field => option(field.id, field.label)));
  $('profile-metric').value = result.meta.metric;
  if (footballTeam) renderFootballScenarios(result);
  $('profile-frequency-body').replaceChildren(...result.frequencies.map(item => row([item.label, `${item.hits} / ${item.n}`, item.frequency === null ? 's/d' : `${number(item.frequency)}%`])));
  playerMarkets?.dispose();
  const player = result.meta.kind === 'player', playerRoot = $('profile-player-markets');
  playerRoot.hidden = !player; $('profile-line-form').hidden = player;
  $('profile-frequency-body').closest('.table-scroll').hidden = player;
  if (player) {
    const originalLines = result.summary.find(field => field.id === result.meta.metric)?.lines || [];
    playerMarkets = mountPlayerMarkets(playerRoot, { metric: result.meta.metric, history: result.history, initialLines: result.frequencies.map(item => item.line), defaultLine: result.frequencies.find(item => !originalLines.includes(item.line))?.line });
  }
  $('profile-note').textContent = result.note + ' La muestra puede incluir temporadas anteriores.' + (result.meta.sport === 'tennis' ? ' Las fechas semanales se incluyen solo cuando el torneo ya había finalizado.' : '');
  const selected = result.summary.find(field => field.id === result.meta.metric);
  const ids = footballTeam ? ['goals', 'corners', 'cards', 'yellow', 'red', 'offsides', 'fouls', 'shots', 'shotsOnTarget', 'halfTimeGoals', 'halfTimeCorners']
    : [...new Set([selected.id, ...(sport === 'football' ? ['goals', 'assists', 'shots_on_target', 'yellow', 'red'] : sport === 'nba' ? ['points', 'assists', 'rebounds', 'threes', ...(result.meta.kind === 'player' ? ['pra'] : ['firstQuarterPoints', 'halfTimePoints'])] : ['aces', 'games', 'gamesTotal', 'sets'])])];
  const fields = ids.map(id => result.summary.find(field => field.id === id)).filter(Boolean);
  $('profile-history-head').replaceChildren(row(['Fecha', sport === 'tennis' ? 'Torneo' : 'Equipo / condición', 'Rival', 'Resultado', ...fields.map(field => footballTeam ? field.label.replace(' a favor', '') + ' (F / C)' : field.label)], true));
  $('profile-history-body').replaceChildren(...result.history.map(item => row([dateLabel(item.date),
    sport === 'tennis' ? `${item.tournament} · ${item.surface}` : `${item.team} · ${item.venue === 'home' ? 'Local' : item.venue === 'away' ? 'Visitante' : 's/d'}`,
    item.opponent, item.result ? `${{ W: 'G', D: 'E', L: 'P' }[item.result]} ${item.score || ''}` : 's/d', ...fields.map(field => footballTeam ? `${number(item.values[field.id])} / ${number(item.values[field.id + 'Against'])}` : number(item.values[field.id]))])));
  if (!result.history.length) { const cell = node('td', 'Sin partidos anteriores disponibles.'); cell.colSpan = fields.length + 4; const empty = node('tr'); empty.append(cell); $('profile-history-body').append(empty); }
  [...$('profile-history-body').children].forEach((element, index) => {
    const item = result.history[index]; if (!item) return;
    element.title = [item.source, item.integrityWarning, ...Object.entries(item.fieldSources || {}).map(([field, ref]) => `${footballFieldLabel(field)}: ${ref.source} / ${ref.id}`)].filter(Boolean).join('\n');
  });
}
async function analyze(extra = {}) { render(await api('/api/profiles/report', { ...selection(), ...(sport === 'football' && $('profile-kind').value === 'team' ? { thresholds: scenarioLines } : {}), ...extra })); }

for (const [prefix, period] of [['profile-ft', 'ft'], ['profile-ht', 'ht']]) {
  for (const suffix of ['group', 'scope']) $(`${prefix}-scenario-${suffix}`).addEventListener('change', () => renderScenarios(prefix, period));
  $(`${prefix}-scenario-form`).addEventListener('submit', event => {
    event.preventDefault();
    const group = $(`${prefix}-scenario-group`).value, config = HANDICAP_GROUPS[group];
    const item = report?.scenarios.find(item => item.period === period && item.group === group && (config || item.scope === $(`${prefix}-scenario-scope`).value));
    if (!item?.metric && !config) return;
    const line = Number($(`${prefix}-scenario-line`).value);
    if (config && !validHandicap(line, config.kind)) { message('Linea de handicap no valida.', true); return; }
    const key = config?.key || item.metric;
    scenarioLines[key] = [...new Set([...(scenarioLines[key] || []), line])];
    if (config) handicapSelections[group] = line;
    task(() => analyze(config ? {} : { metric: item.metric }));
  });
  $(`${prefix}-handicap-line`).addEventListener('change', () => { handicapSelections[$(`${prefix}-scenario-group`).value] = Number($(`${prefix}-handicap-line`).value); renderScenarios(prefix, period); });
}

for (const [id, enabled] of [['view-match', false], ['view-individual', true]]) $(id).addEventListener('click', () => {
  if (individual) preferences[sport] = selection(); footballPlayersMode = false; individual = enabled; revision += 1; visibility();
  if (individual) task(activate);
});
$('view-football-players').addEventListener('click', () => {
  if (individual) preferences[sport] = selection(); individual = false; footballPlayersMode = true; revision += 1; visibility();
});
document.addEventListener('observatorio:sport', event => {
  document.querySelector('.research-mode').hidden = ['basketball', 'tennis'].includes(event.detail);
  if (['basketball', 'tennis'].includes(event.detail)) { $('individual-workspace').hidden = true; $('football-players-workspace').hidden = true; $('fs-players-workspace').hidden = true; $('view-football-players').hidden = true; revision += 1; return; }
  if (individual) preferences[sport] = selection(); sport = event.detail; revision += 1; visibility();
  if (individual) activate().catch(error => message(error.message, true));
});
document.addEventListener('observatorio:data', () => dataRefresh.notify());
document.addEventListener('observatorio:football-source', () => {
  if (sport !== 'football') return;
  revision++; visibility();
  if (individual) activate().catch(error => message(error.message, true));
});
$('profile-league').addEventListener('change', () => task(async () => { seasons(); invalidate(); await names(); }));
for (const id of ['profile-season', 'profile-kind']) $(id).addEventListener('change', () => task(async () => { invalidate(); await names(); }));
$('profile-player-team').addEventListener('change', () => task(async () => { invalidate(); await names(); }));
for (const id of ['profile-name', 'profile-venue', 'profile-cutoff', 'profile-category', 'profile-surface']) $(id).addEventListener('change', invalidate);
document.querySelectorAll('[data-profile-lookback]').forEach(button => button.addEventListener('click', () => {
  lookback = Number(button.dataset.profileLookback);
  document.querySelectorAll('[data-profile-lookback]').forEach(item => { const active = Number(item.dataset.profileLookback) === lookback; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); invalidate();
}));
$('profile-form').addEventListener('submit', event => { event.preventDefault(); task(() => analyze()); });
$('profile-load-nba').addEventListener('click', () => task(async () => {
  const selected = selection(); const team = selected.kind === 'player' ? selected.playerTeam : selected.name;
  message(`Consultando los últimos ${lookback} partidos de ${team}...`);
  const result = await api('/api/profiles/nba-load', { ...selected, team });
  invalidate(); await names(selected.name, selected.playerTeam);
  message(`${result.available} de ${result.games} partidos con registros de jugadores. ${result.imported} registros nuevos.${result.warning ? ` ${result.warning}` : ''}`);
}));
$('profile-metric').addEventListener('change', () => task(() => analyze({ metric: $('profile-metric').value })));
$('profile-line-form').addEventListener('submit', event => { event.preventDefault(); task(() => analyze({ metric: $('profile-metric').value, line: Number($('profile-line').value) })); });
$('profile-import-form').addEventListener('submit', event => {
  event.preventDefault(); task(async () => {
    const file = $('profile-file').files[0]; if (!file) throw new Error('Selecciona un CSV.');
    const result = await api('/api/profiles/import', { ...selection(), csv: await file.text() });
    const name = $('profile-name').value; invalidate(); await names(name); message(`${result.imported} registros importados · ${result.skipped} filas omitidas.`); $('profile-file').value = '';
  });
});
$('profile-export').addEventListener('click', () => {
  if (!report) return;
  const fields = report.summary;
  const rows = [['sport', 'participant', 'season', 'cutoff', 'date', 'team', 'opponent', 'venue', 'result', ...fields.map(field => field.id)],
    ...report.history.map(item => [report.meta.sport, report.meta.name, item.season, report.meta.cutoff, item.date, item.team, item.opponent, item.venue, item.result, ...fields.map(field => item.values[field.id])])];
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\uFEFF' + rows.map(values => values.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `individual-${report.meta.name}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
