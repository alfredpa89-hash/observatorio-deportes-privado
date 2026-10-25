import { mountBasketballPlayerTools } from './basketball-player-tools.js';
import { mountRelevantContext } from './relevant-context.js';
const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const option = (value, label) => { const item = node('option', label); item.value = value; return item; };
const num = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(value)) : 's/d';
const localNow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
const row = (values, header = false) => { const item = node('tr'); item.append(...values.map(value => node(header ? 'th' : 'td', value))); return item; };
const statuses = { unknown: 'No verificada', active: 'Disponible reportado', out: 'Baja reportada', questionable: 'En duda', minutes_limit: 'Limite reportado' };
function table(headers, className = '') {
  const wrapper = node('div', '', 'table-scroll'), table = node('table', '', `basket-table ${className}`), head = node('thead'), body = node('tbody');
  head.append(row(headers, true)); table.append(head, body); wrapper.append(table); return { wrapper, head, body };
}
function button(label, icon, primary = false) {
  const item = node('button', '', `button ${primary ? 'button-primary' : 'button-secondary'}`), glyph = node('i'); glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true');
  item.append(glyph, node('span', label)); item.type = 'button'; return item;
}
async function api(path, body) {
  const response = await fetch(`/api/basketball/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo consultar el prepartido.'); return value;
}

export function mountBasketballPrematch(root) {
  const form = node('form', '', 'prematch-filters'), fields = {};
  function select(key, label, options) {
    const wrapper = node('label', '', 'field'), input = node('select'); wrapper.append(node('span', label), input); form.append(wrapper); fields[key] = input;
    input.append(...options.map(([value, text]) => option(value, text))); return input;
  }
  select('league', 'Competicion prepartido', [['nba', 'NBA / Regular'], ['euroleague', 'Euroliga'], ['endesa', 'Liga Endesa / ACB']]);
  select('season', 'Temporada prepartido', ['2026/2027', '2025/2026', '2024/2025', '2023/2024', '2022/2023'].map(value => [value, value]));
  select('lookback', 'Historial prepartido', [5, 10, 15, 20, 25, 30].map(value => [String(value), `${value} partidos`])); fields.lookback.value = '20';
  const cutoffLabel = node('label', '', 'field'), cutoff = node('input'); cutoff.type = 'datetime-local'; cutoff.value = localNow(); cutoff.required = true; cutoff.dataset.liveCutoff = 'true';
  cutoffLabel.append(node('span', 'Corte prepartido / Guayaquil'), cutoff); form.append(cutoffLabel); fields.cutoff = cutoff;
  select('fixtureId', 'Encuentro del calendario', [['', 'Comparacion sin encuentro confirmado']]).parentElement.classList.add('prematch-fixture-field');
  select('home', 'Equipo local', [['', 'Seleccionar equipo']]); select('away', 'Equipo visitante', [['', 'Seleccionar equipo']]);
  const analyze = button('Ver prepartido', 'clipboard-list', true); analyze.type = 'submit';
  const reload = button('Leer calendario guardado', 'refresh-cw'); form.append(analyze, reload);
  const status = node('p', '', 'app-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const result = node('section'), heading = node('h3'), meta = node('p', '', 'calendar-note'), alerts = node('ul', '', 'prematch-alerts'); result.hidden = true;
  const comparison = table(['Indicador', 'Local', 'Visitante'], 'prematch-comparison');
  const playerHeading = node('h3', 'Jugadores con historial guardado'), playerNote = node('p', 'No es una convocatoria ni una plantilla vigente. Medias por participacion; cada estadistica tiene su muestra. Las identidades se mantienen separadas por proveedor hasta verificar su equivalencia.', 'calendar-note');
  const playerControls = node('div', '', 'prematch-player-filters'), searchLabel = node('label', '', 'field'), search = node('input'); search.type = 'search'; search.placeholder = 'Nombre del jugador';
  searchLabel.append(node('span', 'Buscar jugador prepartido'), search);
  const teamLabel = node('label', '', 'field'), teamFilter = node('select'); teamLabel.append(node('span', 'Equipo de jugadores'), teamFilter);
  const sortLabel = node('label', '', 'field'), sort = node('select'); sortLabel.append(node('span', 'Orden de jugadores'), sort);
  sort.append(...[['points', 'Puntos'], ['rebounds', 'Rebotes'], ['assists', 'Asistencias'], ['pra', 'PRA'], ['threes', 'Triples']].map(([value, label]) => option(value, label)));
  playerControls.append(searchLabel, teamLabel, sortLabel);
  const players = table(['Jugador / equipo / fuente', 'Muestra', 'Puntos / n', 'Rebotes / n', 'Asistencias / n', 'PRA / n', 'Triples / n', 'Ultimo registro', 'Evidencia / disponibilidad', ''], 'prematch-players');
  const availability = table(['Jugador / equipo', 'Estado al corte', 'Publicado', 'Vence', 'Vigencia al inicio', 'Limite / nota del reporte', 'Fuente'], 'prematch-availability');
  const playerDetail = node('section', '', 'prematch-player-detail'), detailHeading = node('div', '', 'fixture-heading'), detailTitle = node('h3'), closeDetail = button('', 'x'), detailRoot = node('div');
  detailRoot.id = 'prematch-player-lab'; playerDetail.hidden = true; closeDetail.classList.add('icon-button'); closeDetail.title = 'Cerrar historial individual'; closeDetail.setAttribute('aria-label', closeDetail.title);
  closeDetail.addEventListener('click', () => { playerDetail.hidden = true; }); detailHeading.append(detailTitle, closeDetail); playerDetail.append(detailHeading, detailRoot);
  const detailTools = mountBasketballPlayerTools(detailRoot);
  const h2h = table(['Fecha', 'Encuentro', 'Resultado FT', 'Fuente']);
  const playerCount = node('p', '', 'calendar-note'), pageControls = node('div', '', 'archive-pagination'), previous = button('Anterior', 'chevron-left'), next = button('Siguiente', 'chevron-right');
  pageControls.append(playerCount, previous, next);
  result.append(heading, meta, alerts, node('h3', 'Comparacion de equipos'), comparison.wrapper, playerHeading, playerNote, playerControls, players.wrapper, pageControls, playerDetail,
    node('h3', 'Disponibilidad y reportes guardados'), availability.wrapper, node('h3', 'Ultimos enfrentamientos guardados'), h2h.wrapper);
  root.append(form, status, result); window.lucide?.createIcons();
  const relevantContext = mountRelevantContext(result);
  let catalog, report, busy = false, active = false, loaded = false, page = 0, pending;
  const selection = () => ({ league: fields.league.value, season: fields.season.value, lookback: Number(fields.lookback.value), cutoff: `${cutoff.value}:00-05:00` });
  function message(value = '', error = false) { status.textContent = value; status.classList.toggle('error', error); }
  function constraints() {
    form.querySelectorAll('input, select, button').forEach(input => { input.disabled = busy; });
    fields.home.disabled = fields.away.disabled = busy || Boolean(fields.fixtureId.value);
    analyze.disabled = busy || !fields.home.value || !fields.away.value || fields.home.value === fields.away.value;
  }
  async function task(action) {
    if (busy) return; busy = true; root.setAttribute('aria-busy', 'true'); constraints(); message();
    try { await action(); } catch (error) { result.hidden = true; message(error.message, true); }
    finally { busy = false; root.setAttribute('aria-busy', 'false'); constraints(); if (pending) { const update = pending; pending = null; await open(update); } }
  }
  function fillFixture() {
    const fixture = catalog?.fixtures.find(row => row.id === fields.fixtureId.value);
    if (fixture) { fields.home.value = fixture.home; fields.away.value = fixture.away; }
    constraints();
  }
  async function load(wanted) {
    result.hidden = true; const previousId = wanted?.fixtureId || fields.fixtureId.value;
    catalog = await api(`prematch/catalog?${new URLSearchParams(selection())}`); loaded = true;
    if (wanted?.fixtureId && !catalog.fixtures.some(game => game.id === wanted.fixtureId)) throw new Error('El encuentro ya no aparece como futuro admisible. Lee el calendario guardado para elegir otro.');
    for (const key of ['home', 'away']) {
      const value = fields[key].value; fields[key].replaceChildren(option('', 'Seleccionar equipo'), ...catalog.teams.map(team => option(team, team)));
      if (catalog.teams.includes(value)) fields[key].value = value;
    }
    fields.fixtureId.replaceChildren(option('', 'Comparacion sin encuentro confirmado'), ...catalog.fixtures.map(game => option(game.id, `${date(game.date)} / ${game.home} - ${game.away}`)));
    if (catalog.fixtures.some(game => game.id === previousId)) fields.fixtureId.value = previousId;
    else if (!wanted && catalog.fixtures.length) fields.fixtureId.value = catalog.fixtures[0].id;
    fillFixture();
    message(`${catalog.fixtures.length} de ${catalog.fixtureCount} encuentros futuros guardados. ${catalog.notice}`);
    if (fields.fixtureId.value || fields.home.value && fields.away.value && fields.home.value !== fields.away.value) await analyzeMatch();
  }
  function empty(body, columns, text) { const item = row([text]); item.firstChild.colSpan = columns; body.append(item); }
  function renderPlayers() {
    if (!report) return;
    const query = search.value.trim().toLocaleLowerCase('es');
    const all = report.teams.flatMap(team => team.players).filter(player => (!teamFilter.value || player.team === teamFilter.value) && (!query || player.name.toLocaleLowerCase('es').includes(query)))
      .sort((a, b) => (b.metrics[sort.value].average ?? -1) - (a.metrics[sort.value].average ?? -1) || a.name.localeCompare(b.name, 'es'));
    page = Math.min(page, Math.max(0, Math.ceil(all.length / 15) - 1));
    players.body.replaceChildren(...all.slice(page * 15, (page + 1) * 15).map(player => {
      const item = row([`${player.name} / ${player.team} / ${player.source.join(', ')}`, player.n, ...['points', 'rebounds', 'assists', 'pra', 'threes'].map(key => `${num(player.metrics[key].average)} / ${player.metrics[key].n}`),
        date(player.latest), `${player.currentSeasonEvidence ? 'Aparicion en temporada elegida, no convocatoria' : 'Solo historico'} / ${statuses[player.availability]}`]);
      const cell = node('td'), detail = button('', 'user-round-search'); detail.classList.add('icon-button'); detail.title = `Ver historial de ${player.name}`; detail.setAttribute('aria-label', detail.title);
      detail.addEventListener('click', () => {
        playerDetail.hidden = false; detailTitle.textContent = `Historial individual / ${player.name}`;
        detailTools.setContext({ league: report.meta.league, season: report.meta.season, lookback: report.meta.lookback, cutoff: report.meta.cutoff, team: player.team, playerKey: player.playerKey });
        playerDetail.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      cell.append(detail); item.append(cell); return item;
    }));
    if (!all.length) empty(players.body, 10, 'Sin referencias individuales con estos filtros. No se presume la plantilla actual.');
    playerCount.textContent = all.length ? `${page * 15 + 1}-${Math.min((page + 1) * 15, all.length)} de ${all.length} referencias individuales` : '0 referencias individuales';
    previous.disabled = page === 0; next.disabled = (page + 1) * 15 >= all.length; window.lucide?.createIcons();
  }
  function render() {
    relevantContext.show({ ...report.meta, sport: 'basketball', key: report.meta.league, kind: 'team',
      names: [report.meta.home, report.meta.away], fixtureId: report.meta.fixture?.id });
    playerDetail.hidden = true;
    const [home, away] = report.teams;
    heading.textContent = `${home.team} - ${away.team}`;
    meta.textContent = `${report.meta.competition} / ${report.meta.season} / Corte ${date(report.meta.cutoff)} / ${report.meta.fixture ? `Inicio ${date(report.meta.fixture.date)} / ${report.meta.fixture.source} / Calendario obtenido ${date(report.meta.fixture.fetchedAt)}` : 'Sin encuentro confirmado'}. ${report.note}`;
    alerts.replaceChildren(...report.alerts.map(value => node('li', value)));
    comparison.head.replaceChildren(row(['Indicador', `${home.team} / Local`, `${away.team} / Visitante`], true));
    const period = (team, key) => `${num(team.periods[key].scored.average)} / ${num(team.periods[key].conceded.average)} (n=${team.periods[key].n}, faltan ${team.periods[key].missing})`;
    const indicators = [
      ['Muestra / temporada elegida', team => `${team.n} / ${team.currentSeasonGames}`],
      ['Victorias / derrotas guardadas', team => `${team.wins} / ${team.losses}`],
      ['Ultimos cinco guardados (reciente primero)', team => team.form.map(game => game.won ? 'G' : 'P').join(' - ') || 's/d'],
      ...[['ft', 'Puntos FT a favor / contra'], ['q1', 'Primer cuarto a favor / contra'], ['ht', 'Descanso a favor / contra'], ['q2', 'Segundo cuarto a favor / contra'], ['q3', 'Tercer cuarto a favor / contra'], ['q4', 'Ultimo cuarto a favor / contra']].map(([key, label]) => [label, team => period(team, key)]),
      ['En su condicion local / visitante', team => `${team.venueSplit.wins} victorias de ${team.venueSplit.n}; ${num(team.venueSplit.scored.average)} a favor / ${num(team.venueSplit.conceded.average)} en contra`],
      ['Ultimo resultado guardado', team => date(team.newest)],
      ['Intervalo entre inicios (misma competicion)', team => team.interval ? `${num(team.interval.hoursBetweenStarts)} horas / ${team.interval.calendarDays} dias de calendario${team.interval.consecutiveDays ? ' / dias consecutivos' : ''}` : 's/d: sin antecedente reciente verificado'],
      ['Partidos guardados en los 7 dias previos al inicio', team => num(team.recordedGamesLast7Days)],
    ];
    comparison.body.replaceChildren(...indicators.map(([label, value]) => row([label, value(home), value(away)])));
    availability.body.replaceChildren(...report.teams.flatMap(team => team.availability.map(record => {
      const item = row([`${record.name} / ${team.team}`, record.current ? statuses[record.status] : 'Reporte vencido / no verificada', date(record.publishedAt), date(record.expiresAt),
        report.meta.fixture ? record.current && record.coversStart ? 'Vigente hasta el inicio; sujeto a cambios' : 'No acredita el inicio' : 'Sin encuentro confirmado',
        `${record.minutesLimit == null ? 'Minutos no confirmados' : `Limite reportado: ${num(record.minutesLimit)} min`}${record.note ? ` / ${record.note}` : ''}`]);
      const cell = node('td'); let url; try { url = new URL(record.sourceUrl); } catch { /* Invalid saved links stay plain text. */ }
      if (url?.protocol === 'https:' && !url.username && !url.password) { const link = node('a', 'Fuente del reporte'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; cell.append(link); }
      else cell.textContent = 'Sin enlace verificado'; item.append(cell); return item;
    })));
    if (!availability.body.children.length) empty(availability.body, 7, 'Sin reportes de disponibilidad aplicables. Lesiones y alineaciones no verificadas.');
    h2h.body.replaceChildren(...report.h2h.map(game => row([date(game.date), `${game.home} - ${game.away}`, `${game.homePoints} - ${game.awayPoints}`, game.source])));
    if (!report.h2h.length) empty(h2h.body, 4, 'Sin enfrentamientos directos anteriores al corte.');
    teamFilter.replaceChildren(option('', 'Ambos equipos'), option(home.team, home.team), option(away.team, away.team));
    page = 0; search.value = ''; renderPlayers(); result.hidden = false;
  }
  async function analyzeMatch() { report = await api('prematch', { ...selection(), fixtureId: fields.fixtureId.value, home: fields.home.value, away: fields.away.value }); render(); }
  async function open(update) {
    if (busy) { pending = update; return; }
    fields.league.value = update.league; fields.season.value = update.season; fields.fixtureId.value = '';
    await task(() => load(update));
  }
  for (const key of ['league', 'season', 'lookback', 'cutoff']) fields[key].addEventListener('change', () => task(async () => {
    if (['league', 'season'].includes(key)) { fields.fixtureId.value = ''; fields.home.value = ''; fields.away.value = ''; }
    await load();
  }));
  fields.fixtureId.addEventListener('change', () => task(async () => { result.hidden = true; fillFixture(); if (fields.fixtureId.value) await analyzeMatch(); }));
  for (const key of ['home', 'away']) fields[key].addEventListener('change', () => { result.hidden = true; constraints(); });
  form.addEventListener('submit', event => { event.preventDefault(); task(analyzeMatch); }); reload.addEventListener('click', () => task(() => load()));
  for (const input of [search, teamFilter, sort]) input.addEventListener(input === search ? 'input' : 'change', () => { page = 0; renderPlayers(); });
  previous.addEventListener('click', () => { page--; renderPlayers(); }); next.addEventListener('click', () => { page++; renderPlayers(); });
  constraints();
  return { selection, open, activate() { active = true; if (!loaded) return task(() => load()); }, reload() {
    if (active) return task(async () => {
      const previous = { query: search.value, team: teamFilter.value, page };
      await load(); search.value = previous.query;
      if ([...teamFilter.options].some(option => option.value === previous.team)) teamFilter.value = previous.team;
      page = previous.page; renderPlayers();
    });
  } };
}
