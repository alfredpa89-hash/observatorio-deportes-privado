import { mountPlayerMarkets } from './player-markets.js';
import { mountRelevantContext } from './relevant-context.js';

const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const option = (value, text) => { const item = node('option', text); item.value = value; return item; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const date = (value, time = true) => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', ...(time ? { timeStyle: 'short', hourCycle: 'h23' } : {}) }).format(new Date(value)) : 's/d';
const localNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
const periods = [['ft', 'Partido completo'], ['q1', 'Primer cuarto'], ['q2', 'Segundo cuarto'], ['ht', 'Descanso'], ['q3', 'Tercer cuarto'], ['q4', 'Cuarto cuarto']];
const row = (values, header = false) => { const item = node('tr'); item.append(...values.map(value => node(header ? 'th' : 'td', value))); return item; };
function table(headers) {
  const wrapper = node('div', '', 'table-scroll'), table = node('table', '', 'basket-table'), head = node('thead'), body = node('tbody');
  head.append(row(headers, true)); table.append(head, body); wrapper.append(table); return { wrapper, body };
}
function button(label, icon) {
  const item = node('button', '', 'button button-secondary'), glyph = node('i'); glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true');
  item.type = 'button'; item.append(glyph, node('span', label)); return item;
}
async function api(path, body) {
  const response = await fetch(`/api/basketball/teams/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo consultar el equipo.'); return value;
}

export function mountBasketballTeams(root) {
  const form = node('form', '', 'team-profile-filters'), fields = {};
  function select(key, label, choices, parent = form) {
    const wrapper = node('div', '', 'field'), input = node('select'), caption = node('label', label); input.id = `bt-${key}`; caption.htmlFor = input.id;
    input.append(...choices.map(([value, text]) => option(value, text))); wrapper.append(caption, input); parent.append(wrapper); fields[key] = input; return input;
  }
  select('league', 'Competicion del equipo', [['nba', 'NBA / Regular'], ['euroleague', 'Euroliga'], ['endesa', 'Liga Endesa / ACB']]);
  select('season', 'Temporada del equipo', ['2026/2027', '2025/2026', '2024/2025', '2023/2024', '2022/2023'].map(value => [value, value]));
  select('team', 'Equipo a analizar', [['', 'Seleccionar equipo']]);
  select('lookback', 'Muestra del equipo', [['season', 'Temporada completa guardada'], ...[5, 10, 15, 20, 25, 30].map(value => [String(value), `Ultimos ${value} partidos`])]);
  select('venue', 'Localia del equipo', [['all', 'Todas'], ['home', 'Local'], ['away', 'Visitante']]);
  const cutoffWrapper = node('div', '', 'field'), cutoffLabel = node('label', 'Corte del equipo / Guayaquil'), cutoff = node('input');
  cutoff.id = 'bt-cutoff'; cutoffLabel.htmlFor = cutoff.id; cutoff.type = 'datetime-local'; cutoff.value = localNow(); cutoff.required = true; fields.cutoff = cutoff;
  cutoffWrapper.append(cutoffLabel, cutoff); form.append(cutoffWrapper);
  const analyze = button('Analizar equipo', 'chart-no-axes-combined'); analyze.type = 'submit'; analyze.className = 'button button-primary';
  const reload = button('Leer datos guardados', 'refresh-cw'); form.append(analyze, reload);
  const status = node('p', '', 'app-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const result = node('section'), title = node('h3'), context = node('p', '', 'calendar-note'), warnings = node('ul', '', 'prematch-alerts'), kpis = node('div', '', 'basket-kpis'), formNote = node('p', '', 'calendar-note'); result.hidden = true;
  const averages = table(['Periodo', 'A favor / n', 'En contra / n', 'Total / n', 'G / E / P', 'Con resultado / faltantes']);
  const venues = table(['Localia de la muestra', 'Partidos', 'Ganados', 'Perdidos', 'Victorias historicas']);
  const marketSection = node('section'), marketControls = node('div', '', 'team-market-filters'), marketRoot = node('div');
  select('period', 'Periodo de puntos del equipo', periods, marketControls);
  select('direction', 'Puntos a estudiar', [['scored', 'A favor del equipo'], ['conceded', 'En contra del equipo'], ['total', 'Total de ambos equipos']], marketControls);
  marketSection.append(node('h3', 'Over, under y rangos historicos'), marketControls, marketRoot);
  const history = table(['Fecha / Guayaquil', 'Rival', 'Localia', 'G / P', 'Final a favor / contra', '1Q', '2Q', 'Descanso', '3Q', '4Q', 'Fuente']);
  const pagination = node('div', '', 'archive-pagination'), count = node('p', '', 'calendar-note'), previous = button('', 'chevron-left'), next = button('', 'chevron-right');
  for (const [item, label] of [[previous, 'Partidos anteriores de la tabla'], [next, 'Partidos siguientes de la tabla']]) { item.title = label; item.setAttribute('aria-label', label); item.classList.add('icon-button'); }
  pagination.append(count, previous, next);
  const upcoming = table(['Inicio / Guayaquil', 'Encuentro guardado', 'Fuente']);
  result.append(title, context, warnings, kpis, formNote, node('h3', 'Promedios y resultados por periodo'), averages.wrapper, node('h3', 'Local y visitante'), venues.wrapper,
    marketSection, node('h3', 'Partidos de la muestra'), history.wrapper, pagination, node('h3', 'Proximos encuentros guardados'),
    node('p', 'Calendario parcial sujeto a cambios. Sin encuentro guardado no significa que no haya partido.', 'calendar-note'), upcoming.wrapper);
  root.append(form, status, result); window.lucide?.createIcons();
  const relevantContext = mountRelevantContext(result);
  let busy = false, loaded = false, active = false, report, markets, page = 0;
  const selection = () => ({ league: fields.league.value, season: fields.season.value, team: fields.team.value,
    lookback: fields.lookback.value, venue: fields.venue.value, cutoff: `${cutoff.value}:00-05:00` });
  const empty = (body, columns, text) => { const item = row([text]); item.firstChild.colSpan = columns; body.append(item); };
  function constraints() { form.querySelectorAll('input, select, button').forEach(input => { input.disabled = busy; }); analyze.disabled = busy || !fields.team.value; }
  async function task(action) {
    if (busy) return; busy = true; constraints(); root.setAttribute('aria-busy', 'true'); status.textContent = ''; status.classList.remove('error');
    try { await action(); } catch (error) { result.hidden = true; status.textContent = error.message; status.classList.add('error'); }
    finally { busy = false; constraints(); root.setAttribute('aria-busy', 'false'); }
  }
  function renderHistory() {
    const rows = report.history, showScore = value => `${num(value.scored)} / ${num(value.conceded)}`;
    history.body.replaceChildren(...rows.slice(page * 15, page * 15 + 15).map(game => row([date(game.date, game.timeKnown), game.opponent, game.venue === 'home' ? 'Local' : 'Visitante',
      game.periods.ft.scored > game.periods.ft.conceded ? 'G' : 'P', ...['ft', 'q1', 'q2', 'ht', 'q3', 'q4'].map(key => showScore(game.periods[key])), game.source])));
    if (!rows.length) empty(history.body, 11, 'Sin partidos admisibles con estos filtros.');
    count.textContent = rows.length ? `${page * 15 + 1}-${Math.min(page * 15 + 15, rows.length)} de ${rows.length} partidos; reciente primero` : '0 partidos';
    previous.disabled = page === 0; next.disabled = (page + 1) * 15 >= rows.length;
  }
  async function renderMarkets() {
    markets?.dispose(); marketSection.hidden = !report.summary.n;
    if (!report.summary.n) return;
    const period = fields.period.value, direction = fields.direction.value, factor = direction === 'total' ? 2 : 1;
    const base = period === 'ft' ? report.meta.league === 'nba' ? [89.5, 139.5, 5, 10] : [59.5, 109.5, 5, 10]
      : period === 'ht' ? [29.5, 69.5, 5, 10] : [9.5, 39.5, 2, 5];
    markets = mountPlayerMarkets(marketRoot, { metric: 'points', history: report.history.map(game => ({ ...game, season: report.meta.season, values: { points: game.periods[period][direction] } })),
      guidance: { label: `${report.meta.team} / ${fields.period.selectedOptions[0].textContent} / ${fields.direction.selectedOptions[0].textContent}`,
        cutoff: report.meta.cutoff, season: report.meta.season, lookback: report.meta.lookback },
      preset: { from: Math.floor(base[0] * factor) + .5, to: Math.floor(base[1] * factor) + .5, step: base[2] * factor, width: base[3] * factor }, rangeHeading: 'Rangos de puntos del equipo' });
    await markets.ready;
  }
  async function analyzeTeam() {
    report = await api('analysis', selection()); page = 0;
    relevantContext.show({ ...report.meta, sport: 'basketball', kind: 'team', key: report.meta.league, names: [report.meta.team] });
    title.textContent = report.meta.team;
    const venue = { all: 'Todas las localias', home: 'Solo local', away: 'Solo visitante' }[report.meta.venue];
    context.textContent = `${report.meta.competition} / ${report.meta.season} / ${venue} / Corte ${date(report.meta.cutoff)} / ${report.summary.n} de ${report.meta.available} partidos disponibles con estos filtros; ${report.meta.seasonGames} guardados de la temporada. Fuentes: ${report.meta.sources.join(', ') || 'sin resultados'}. ${report.note}`;
    warnings.replaceChildren(...report.warnings.map(text => node('li', text)));
    kpis.replaceChildren(...[['Partidos de la muestra', report.summary.n], ['Ganados', report.summary.wins], ['Perdidos', report.summary.losses], ['Victorias historicas', report.summary.winFrequency == null ? 's/d' : `${num(report.summary.winFrequency)} %`]].map(([label, value]) => {
      const item = node('div'); item.append(node('span', label), node('strong', typeof value === 'number' ? num(value) : value)); return item;
    }));
    formNote.textContent = `Ultimos cinco guardados: ${report.form.map(game => game.won ? 'G' : 'P').join(' - ') || 's/d'}. Ultimo resultado: ${date(report.meta.newest)}.`;
    averages.body.replaceChildren(...periods.map(([key, label]) => {
      const sample = report.periods[key], mean = metric => `${num(sample[metric].average)} / ${sample[metric].n}`;
      return row([label, mean('scored'), mean('conceded'), mean('total'), `${sample.wins} / ${sample.draws} / ${sample.losses}`, `${sample.n} / ${sample.missing}`]);
    }));
    venues.body.replaceChildren(...report.venueSplits.map(sample => row([sample.venue === 'home' ? 'Local' : 'Visitante', sample.n, sample.wins, sample.losses, sample.winFrequency == null ? 's/d' : `${num(sample.winFrequency)} %`])));
    upcoming.body.replaceChildren(...report.upcoming.map(game => row([date(game.date), `${game.home} - ${game.away}`, game.source])));
    if (!report.upcoming.length) empty(upcoming.body, 3, 'Sin proximos encuentros guardados de esta temporada.');
    renderHistory(); await renderMarkets(); result.hidden = false;
  }
  async function load(preferAvailable = false) {
    result.hidden = true; const previousTeam = fields.team.value;
    let catalog = await api(`catalog?${new URLSearchParams(selection())}`);
    const availableSeason = catalog.seasons.find(season => season.results > 0);
    if (preferAvailable && availableSeason && !catalog.seasons.find(season => season.value === fields.season.value)?.results) {
      fields.season.value = availableSeason.value;
      catalog = await api(`catalog?${new URLSearchParams(selection())}`);
    }
    loaded = true;
    fields.season.replaceChildren(...catalog.seasons.map(season => option(season.value, `${season.value} / ${season.results} resultados guardados`))); fields.season.value = catalog.season;
    fields.team.replaceChildren(option('', 'Seleccionar equipo'), ...catalog.teams.map(team => option(team.name, `${team.name} / ${team.seasonGames} partidos de temporada`)));
    fields.team.value = catalog.teams.some(team => team.name === previousTeam) ? previousTeam : catalog.teams.find(team => team.seasonGames)?.name || catalog.teams[0]?.name || '';
    status.textContent = catalog.notice;
    if (fields.team.value) await analyzeTeam();
    else status.textContent = `Sin equipos guardados en esta competicion y corte. ${catalog.notice}`;
  }
  for (const key of ['league', 'season', 'cutoff']) fields[key].addEventListener('change', () => task(async () => { if (key === 'league') fields.team.value = ''; await load(key === 'league'); }));
  for (const key of ['team', 'lookback', 'venue']) fields[key].addEventListener('change', () => task(async () => { result.hidden = true; if (fields.team.value) await analyzeTeam(); }));
  for (const key of ['period', 'direction']) fields[key].addEventListener('change', renderMarkets);
  form.addEventListener('submit', event => { event.preventDefault(); task(analyzeTeam); }); reload.addEventListener('click', () => task(() => load()));
  previous.addEventListener('click', () => { page--; renderHistory(); }); next.addEventListener('click', () => { page++; renderHistory(); });
  constraints();
  return { selection, activate() { active = true; if (!loaded) return task(() => load(true)); }, reload() { if (active) return task(() => load()); } };
}
