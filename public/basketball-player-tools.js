import { mountPlayerMarkets } from './player-markets.js';
import { mountRelevantContext } from './relevant-context.js';
import { BASKETBALL_PLAYER_METRICS as metrics, defaultTargets, targetRates } from './basketball-player-metrics.js';
import { jsonRequest } from './api-client.js';
import { mountBasketballAvailabilityLinks } from './basketball-availability-links.js';

const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const option = (value, label) => { const item = node('option', label); item.value = value; return item; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value == null ? 's/d' : `${num(value)} %`;
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value)) : 's/d';
const row = (values, header = false) => { const item = node('tr'); item.append(...values.map(value => node(header ? 'th' : 'td', value))); return item; };
const icons = () => window.lucide?.createIcons();
function button(label, icon, primary = false) {
  const item = node('button', '', `button ${primary ? 'button-primary' : 'button-secondary'}`), glyph = node('i');
  glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true'); item.append(glyph, node('span', label)); item.type = 'button'; return item;
}
function table(headers) {
  const wrapper = node('div', '', 'table-scroll'), table = node('table', '', 'basket-table'), head = node('thead'), body = node('tbody');
  head.append(row(headers, true)); table.append(head, body); wrapper.append(table); return { wrapper, head, body };
}
async function api(path, body) {
  return jsonRequest(`/api/basketball/${path}`, body);
}

export function mountBasketballPlayerTools(root) {
  const form = node('form', '', 'player-lab-filters'), fields = {};
  function field(parent, key, label, values) {
    const wrapper = node('label', '', 'field'), input = node('select'); input.id = `${root.id}-${key}`; wrapper.htmlFor = input.id;
    wrapper.append(node('span', label), input); parent.append(wrapper); fields[key] = input;
    if (values) input.append(...values.map(([value, text]) => option(value, text))); return input;
  }
  field(form, 'team', 'Equipo del historial', [['', 'Todos los equipos']]);
  field(form, 'player', 'Jugador del historial', [['', 'Seleccionar jugador']]);
  field(form, 'venue', 'Localia', [['all', 'Todos'], ['home', 'Local'], ['away', 'Visitante']]);
  field(form, 'metric', 'Estadistica del historial', Object.entries(metrics));
  const analyzeButton = button('Analizar historial', 'chart-no-axes-combined', true); analyzeButton.type = 'submit';
  const syncButton = button('Completar historial del equipo', 'cloud-download'); form.append(analyzeButton, syncButton);
  const coverageNote = node('p', '', 'calendar-note');
  const status = node('p', '', 'app-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = node('section'), title = node('h3'), kpis = node('div', '', 'basket-kpis'), warnings = node('ul', '', 'player-lab-warnings'); results.hidden = true;
  const markets = node('div'), shooting = table(['Lanzamiento', 'Anotados', 'Intentados', 'Acierto', 'Partidos con par', 'Sin par completo']);
  const goalGroup = node('select'); goalGroup.setAttribute('aria-label', 'Grupo de objetivos');
  goalGroup.append(...[['points', 'Puntos'], ['rebounds', 'Rebotes'], ['assists', 'Asistencias'], ['threes', 'Triples'], ['combined', 'Combinados']].map(([value, label]) => option(value, label)));
  const goalHeading = node('div', '', 'fixture-heading'); goalHeading.append(node('h3', 'Objetivos individuales'), goalGroup);
  const goals = table(['Objetivo', 'Frecuencia historica', 'Cumplidos / con datos', 'Sin datos', 'Intervalo 95 %', '']);
  const goalForm = node('form', '', 'player-goal-form'), ruleFields = [];
  for (let index = 0; index < 3; index++) {
    const wrapper = node('div', '', 'player-goal-rule'), enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = index === 0;
    const toggle = node('label', '', 'player-goal-toggle'); toggle.append(enabled, node('span', index === 0 ? 'Primer requisito' : index === 1 ? 'Segundo requisito' : 'Tercer requisito'));
    if (index === 0) enabled.disabled = true;
    const controls = node('div', '', 'player-goal-fields'), metric = field(controls, `goal-metric-${index}`, `Estadistica del requisito ${index + 1}`, Object.entries(metrics));
    metric.value = ['points', 'rebounds', 'assists'][index];
    const label = node('label', '', 'field'), minimum = node('input'); minimum.type = 'number'; minimum.min = 1; minimum.max = 499; minimum.step = 1; minimum.value = [10, 5, 3][index];
    label.append(node('span', `Al menos, requisito ${index + 1}`), minimum); controls.append(label); wrapper.append(toggle, controls); goalForm.append(wrapper);
    const update = () => { controls.hidden = !enabled.checked; metric.disabled = minimum.disabled = !enabled.checked; minimum.required = enabled.checked; };
    enabled.addEventListener('change', update); update(); ruleFields.push({ enabled, metric, minimum });
  }
  const addGoal = button('Agregar objetivo', 'plus'); addGoal.type = 'submit'; goalForm.append(addGoal);
  const previous = table(['Fecha', 'Equipo', 'Rival', 'Localia', 'Puntos', 'Rebotes', 'Asistencias', 'PRA', 'Triples']);
  results.append(title, kpis, warnings, node('h3', 'Over, under y rangos'), markets, node('h3', 'Volumen de lanzamiento'), shooting.wrapper,
    goalHeading, goalForm, goals.wrapper, node('h3', 'Participaciones de la muestra'), previous.wrapper);
  root.replaceChildren(coverageNote, form, status, results); icons();
  const availabilityLinks = mountBasketballAvailabilityLinks(root);
  const relevantContext = mountRelevantContext(results);
  let base, contextKey = '', result, market, revision = 0, busy = false, customGoals = [], goalPlayer, pendingContext;
  const body = () => ({ ...base, team: fields.team.value, venue: fields.venue.value, playerKey: fields.player.value });
  function message(text = '', error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function constraints() {
    form.querySelectorAll('input, select, button').forEach(input => { input.disabled = busy; });
    analyzeButton.disabled = busy || !fields.player.value;
    syncButton.disabled = busy || !fields.team.value;
  }
  async function task(action) {
    if (busy) return; busy = true; root.setAttribute('aria-busy', 'true'); constraints(); message();
    try { await action(); } catch (error) { message(error.message, true); }
    finally {
      busy = false; root.setAttribute('aria-busy', 'false'); constraints();
      if (pendingContext) { const next = pendingContext; pendingContext = null; contextKey = ''; await setContext(next); }
    }
  }
  function clear() { revision++; market?.dispose(); result = null; results.hidden = true; }
  async function loadCatalog(team = fields.team.value) {
    const token = ++revision, oldTeam = team, oldPlayer = fields.player.value;
    const data = await api(`players/catalog?${new URLSearchParams({ ...base, team: oldTeam })}`);
    if (token !== revision) return;
    const coverage = new Map(data.teamCoverage.map(item => [item.team, item]));
    fields.team.replaceChildren(option('', 'Todos los equipos'), ...data.teams.map(team => option(team,
      `${team} (${coverage.get(team).players ? `${coverage.get(team).players} jugadores con historial` : 'sin jugadores guardados'})`)));
    if (data.teams.includes(oldTeam)) fields.team.value = oldTeam;
    fields.player.replaceChildren(option('', 'Seleccionar jugador'), ...data.players.map(player => option(player.key, `${player.name} / ${player.teams.join(', ')}`)));
    if (data.players.some(player => player.key === oldPlayer)) fields.player.value = oldPlayer;
    coverageNote.textContent = `${data.coverage.players} jugadores con participaciones / ${data.coverage.teamsWithPlayers} de ${data.coverage.teams} equipos del archivo con jugadores. Historial individual: ${data.coverage.seasons.join(', ') || 'sin datos'}. No acredita plantillas actuales.`;
    const selected = coverage.get(fields.team.value);
    if (!data.players.length) message(selected
      ? `${selected.team}: sin participaciones individuales guardadas. Temporadas con resultados del equipo: ${selected.gameSeasons.join(', ') || 'sin datos'}.`
      : 'No hay participaciones con minutos positivos para esta seleccion. Los historicos no acreditan la plantilla actual.');
    if (selected && !selected.seasonGames) message(`${selected.team}: sin partidos finalizados guardados de ${base.season}. Historial del equipo: ${selected.gameSeasons.join(', ') || 'sin datos'}. No hay una plantilla actual verificada.`);
    constraints();
  }
  function renderGoals() {
    if (!result) return;
    const definitions = [...defaultTargets(goalGroup.value).map(rules => ({ rules })), ...customGoals.map((rules, index) => ({ rules, index }))];
    goals.body.replaceChildren(...definitions.map(({ rules, index }) => {
      const rates = targetRates(result.history, rules), text = rules.map(rule => `${rule.minimum}+ ${metrics[rule.metric].toLowerCase()}`).join(' y ');
      const item = row([text, pct(rates.frequency), `${rates.hits} / ${rates.n}`, rates.missing, rates.interval ? `${pct(rates.interval[0])} a ${pct(rates.interval[1])}` : 's/d']);
      const cell = node('td');
      if (index !== undefined) {
        const remove = button('', 'trash-2'); remove.classList.add('icon-button'); remove.title = `Quitar objetivo: ${text}`; remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => { customGoals.splice(index, 1); renderGoals(); }); cell.append(remove);
      }
      item.append(cell); return item;
    })); icons();
  }
  function renderMarkets() {
    if (!result) return;
    const metric = fields.metric.value, sample = result.metrics[metric];
    market?.dispose(); market = mountPlayerMarkets(markets, { metric, history: result.history,
      guidance: { kind: 'player', label: `${result.name} / ${metrics[metric]}`, cutoff: result.cutoff, season: result.season, lookback: result.lookback } });
    title.textContent = `${result.name} / ${metrics[metric]}`;
    kpis.replaceChildren(...[['Participaciones', result.history.length], ['Con esta estadistica', sample.n], ['Media', num(sample.average)], ['Ultimo registro', date(result.quality.newest)]].map(([label, value]) => {
      const item = node('div'); item.append(node('span', label), node('strong', String(value))); return item;
    }));
    const extra = !['points', 'rebounds', 'assists', 'pra', 'threes'].includes(metric);
    previous.head.replaceChildren(row(['Fecha', 'Equipo', 'Rival', 'Localia', 'Puntos', 'Rebotes', 'Asistencias', 'PRA', 'Triples', ...(extra ? [metrics[metric]] : [])], true));
    previous.body.replaceChildren(...result.history.map(item => row([date(item.date), item.team, item.opponent || 's/d', { home: 'Local', away: 'Visitante' }[item.venue] || 's/d',
      ...['points', 'rebounds', 'assists', 'pra', 'threes'].map(key => num(item.values[key])), ...(extra ? [num(item.values[metric])] : [])])));
    if (!result.history.length) { const empty = row(['Sin participaciones con estos filtros.']); empty.firstChild.colSpan = extra ? 10 : 9; previous.body.append(empty); }
  }
  async function analyze() {
    if (!fields.player.value) { clear(); return; }
    const token = ++revision, data = await api('players/analysis', body());
    if (token !== revision) return;
    result = data; results.hidden = false;
    relevantContext.show({ sport: 'basketball', kind: 'player', key: result.league, season: result.season,
      team: fields.team.value, playerKey: result.playerKey, lookback: result.lookback, cutoff: result.cutoff });
    if (goalPlayer !== result.playerKey) { customGoals = []; goalPlayer = result.playerKey; }
    warnings.replaceChildren(...result.quality.warnings.map(warning => node('li', warning)));
    shooting.body.replaceChildren(...result.shooting.map(item => row([item.label, num(item.made), num(item.attempts), pct(item.percentage), item.n, item.missing])));
    renderMarkets(); renderGoals(); await market.ready;
  }
  form.addEventListener('submit', event => { event.preventDefault(); task(analyze); });
  fields.team.addEventListener('change', () => { clear(); task(async () => { await loadCatalog(); if (fields.player.value) await analyze(); }); });
  fields.player.addEventListener('change', () => { clear(); task(analyze); });
  fields.venue.addEventListener('change', () => { clear(); task(analyze); });
  fields.metric.addEventListener('change', () => { renderMarkets(); });
  goalGroup.addEventListener('change', renderGoals);
  goalForm.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!result) return;
      if (customGoals.length >= 10) throw new Error('Maximo diez objetivos personalizados por jugador.');
      const rules = ruleFields.filter(item => item.enabled.checked).map(item => ({ metric: item.metric.value, minimum: Number(item.minimum.value) }));
      targetRates(result.history, rules);
      if (!customGoals.some(existing => JSON.stringify(existing) === JSON.stringify(rules))) customGoals.push(rules);
      message(); renderGoals();
    } catch (error) { message(error.message, true); }
  });
  syncButton.addEventListener('click', () => task(async () => {
    message('Completando un encuentro del equipo; se conserva el avance para continuar despues...');
    const loaded = await api('research/player-sync', {...body(),maxGames:1,resume:true});
    await loadCatalog(); if (fields.player.value) await analyze();
    message(`${loaded.cached ? 'Lote en cache. ' : ''}${loaded.calls} consultas; ${loaded.records} registros recibidos; ${loaded.pending} encuentros pendientes dentro de la ventana.${loaded.withoutApi ? ` ${loaded.withoutApi} encuentros sin identificador API no se consultaron.` : ''} ${loaded.warning || ''}`, Boolean(loaded.warning));
  }));
  constraints();
  async function setContext(context) {
      const next = JSON.stringify(context); if (next === contextKey) return;
      if (busy) { pendingContext = { ...context }; revision++; return; }
      const changed = base && (base.league !== context.league || base.season !== context.season);
      clear(); base = { ...context }; contextKey = next;
      availabilityLinks.setLeague(base.league);
      if (changed) { fields.player.value = ''; fields.team.value = ''; }
      const team = Object.hasOwn(context, 'team') ? context.team || '' : fields.team.value;
      await task(async () => {
        await loadCatalog(team);
        if (context.playerKey && [...fields.player.options].some(option => option.value === context.playerKey)) fields.player.value = context.playerKey;
        if (fields.player.value) await analyze();
      });
  }
  return { setContext,
    reload() { if (base) { contextKey = ''; return setContext({ ...base }); } },
    reset() { contextKey = ''; clear(); },
  };
}
