import { renderBasketballEvidence } from './basketball-evidence.js';
import { periodReference, combinedTotalReference, spreadTeamLabel, spreadRule } from './resumen-nba.js';
const node = (tag, text = '', cls = '') => { const item = document.createElement(tag); item.textContent = text; item.className = cls; return item; };
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value)) : 's/d';
const time = value => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
function link(label, url) { const item = node('a', label); item.href = url; item.target = '_blank'; item.rel = 'noopener noreferrer'; return item; }
function table(headers, rows) {
  const wrap = node('div', '', 'brief-scroll'), item = node('table', '', 'brief-table'), head = node('thead'), tr = node('tr'), body = node('tbody');
  tr.append(...headers.map(text => node('th', text))); head.append(tr);
  body.append(...rows.map(values => { const row = node('tr'); row.append(...values.map(text => node('td', text))); return row; }));
  item.append(head, body); wrap.append(item); return wrap;
}
function header(game) {
  const article = node('article', '', 'brief-game'); article.id = game.id;
  const top = node('div', '', 'brief-game-header'), names = node('div'), clock = node('div', '', 'brief-time');
  names.append(node('h3', `${game.home} - ${game.away}`), node('p', game.competition));
  if (game.logos?.length) { const logos = node('div', '', 'brief-logos');
    for (const [i, url] of game.logos.entries()) { if (!url) continue; const img = document.createElement('img'); img.src = url; img.alt = i ? game.away : game.home; logos.append(img); } names.prepend(logos); }
  clock.append(node('strong', `${time(game.start)} / Guayaquil`), node('span', '', 'brief-status')); clock.lastChild.dataset.start = game.start;
  top.append(names, clock); article.append(top); return article;
}
function sample(team, key) { const metric = team.summary.find(item => item.id === key); return `${number(metric?.average)} (n=${metric?.n || 0})`; }
function football(game) {
  const item = header(game), teams = game.teams;
  item.append(node('p', game.limitation, 'brief-notice'), node('p', game.note, 'brief-sample'));
  item.append(table(['Champions antes de hoy', ...game.europe.map(team => team.name)], [
    ['Partidos de la fase liga', ...game.europe.map(team => team.n)],
    ['Goles a favor / en contra', ...game.europe.map(team => `${team.goalsFor} / ${team.goalsAgainst}`)] ]));
  const details = node('details'), summary = node('summary', 'Historial domestico / ultimos 20 partidos guardados'); details.append(summary);
  details.append(node('p', teams.map(team => `${team.name}: ${team.competition}; ${team.n} partidos; ultimo ${date(team.latest)}; temporadas ${team.seasons.join(', ')}.`).join(' '), 'brief-sample'));
  details.append(table(['Promedio por partido', ...teams.map(team => team.name)], [
    ['Ganados / empatados / perdidos', ...teams.map(team => `${team.record.wins} / ${team.record.draws} / ${team.record.losses}`)],
    ...teams[0].summary.map(metric => [metric.label, ...teams.map(team => sample(team, metric.id))]) ]));
  item.append(details);
  const frequencies = node('details'); frequencies.append(node('summary', 'Condiciones: cumplidos / con datos de cada equipo'));
  const frequency = row => row?.n ? `${row.hits}/${row.n} (${number(row.frequency)} %)` : 's/d';
  frequencies.append(node('p', 'Cada columna resume los rivales de la liga domestica de ese club. Las columnas no se suman ni equivalen al porcentaje del partido de hoy.', 'brief-sample'));
  frequencies.append(table(['Condicion historica', ...teams.map(team => team.name)], [
    ['Ambos marcaron', ...teams.map(team => frequency(team.btts))],
    ...teams[0].conditions.map((condition, index) => [condition.label, ...teams.map(team => frequency(team.conditions[index]))]) ])); item.append(frequencies);
  const sources = node('div', '', 'brief-source'); sources.append(link('Partido UEFA', game.source), ...game.sources.map(source => link(source.title, source.url)));
  item.append(sources, node('p', `Historial local: ${[...new Set(teams.flatMap(team => team.sources))].join(', ')}.`, 'brief-sample')); return item;
}
function basketball(game) {
  const item = header(game), columns = node('div', '', 'brief-columns'), history = node('div'), context = node('div');
  history.append(node('h4', 'Referencia de los ultimos 20 partidos guardados'));
  const period = (team, id) => { const value = team.periods[id];
    return `${number(value?.scored.average)} / ${number(value?.conceded.average)}${value?.n === team.n ? '' : ` (${value?.n || 0} partidos con datos)`}`; };
  history.append(table(['A favor / en contra', ...game.teams.map(team => team.name)], [
    ['Puntos, incluye prorroga', ...game.teams.map(team => period(team, 'ft'))],
    ['Primer cuarto', ...game.teams.map(team => period(team, 'q1'))], ['Al descanso', ...game.teams.map(team => period(team, 'ht'))],
    ['Ganados / perdidos', ...game.teams.map(team => `${team.wins} / ${team.losses}`)],
    ['Margen medio: anotados menos recibidos', ...game.teams.map(team => number(periodReference(team, 'ft')?.margin))],
    ['Partidos con datos del total', ...game.teams.map(team => team.periods.ft?.n || 0)],
    ['Ultimo resultado guardado', ...game.teams.map(team => date(team.latest))],
    ['Partidos actuales en la muestra', ...game.teams.map(team => team.currentSeasonGames)] ]));
  context.append(node('h4', 'Contexto relevante con fuente'));
  const news = node('ul', '', 'brief-news');
  for (const report of game.news) { const li = node('li', report.text + ' '); li.append(link(`Fuente / ${date(report.published + 'T12:00:00Z')}`, report.url)); news.append(li); }
  if (!game.news.length) news.append(node('li', 'Sin reporte actual contrastado en esta revision. Confirmar disponibilidad y quintetos en el parte oficial.'));
  context.append(news, node('p', 'Sin muestra individual actual de cinco participaciones por jugador. Los registros antiguos se muestran por separado; disponibilidad y minutos futuros sin verificar.', 'brief-sample'));
  columns.append(history, context); item.append(columns);
  item.append(node('h4', 'Totales de puntos / ambos equipos del encuentro'));
  item.append(table(['Periodo', ...game.teams.map(team => `Historial ${team.name}`), 'Media de los dos historiales'],
    [['ft', 'Partido, incluye prorroga'], ['q1', 'Primer cuarto'], ['ht', 'Al descanso']].map(([id, label]) => [label,
      ...game.teams.map(team => { const value = periodReference(team, id);
        return value ? `${number(value.total)} (${value.n} partidos)` : 's/d'; }), number(combinedTotalReference(game.teams, id))])));
  item.append(node('p', 'Total historico = puntos anotados + recibidos en cada encuentro. La ultima columna es la media simple de ambos historiales, no un marcador esperado ni una probabilidad; pueden compartir partidos. Las muestras siguen siendo de temporadas anteriores.', 'brief-sample'));
  const spreads = game.markets.filter(market => market.spec?.type === 'spread');
  item.append(node('h4', 'Handicap / partido completo con prorroga'));
  if (spreads.length) {
    item.append(table(['Equipo y linea de estudio', 'Se cumple al', 'Estimacion historica del modelo'], spreads.map(market => [
      spreadTeamLabel(game, market), spreadRule(market), `${number(market.probability)} %`])));
    item.append(node('p', 'Lineas de estudio guardadas, no cuotas vigentes de una casa. Porcentajes experimentales con historial antiguo, sin ajustar bajas ni plantillas; no son recomendaciones.', 'brief-notice'));
  } else item.append(node('p', 'Sin handicap calculado antes del inicio. No se reconstruyen pronosticos.', 'brief-sample'));
  const individuals = node('details', '', 'brief-individuals'); individuals.append(node('summary', 'Jugadores / registros historicos parciales'));
  individuals.append(node('p', 'Medias por participacion guardada, no por los 20 partidos del equipo. Con una sola participacion, el valor es el de ese unico partido. No acredita plantilla actual, titularidad ni disponibilidad.', 'brief-notice'));
  for (const team of game.teams) {
    const players = team.playerReferences || team.currentPlayers || [];
    individuals.append(node('h4', `${team.name} / ${players.length} referencias guardadas`));
    if (!players.length) { individuals.append(node('p', 'Sin registros individuales guardados.', 'brief-sample')); continue; }
    const rows = [...players].sort((a, b) => (b.latest || '').localeCompare(a.latest || '') || a.name.localeCompare(b.name, 'es'));
    const values = player => ['points', 'rebounds', 'assists', 'pra', 'threes'].map(id => {
      const metric = player.metrics[id]; return `${number(metric?.average)}${metric?.n && metric.n !== player.n ? ` (${metric.n} con datos)` : ''}`; });
    const playersTable = table(['Jugador', 'Participaciones', 'Ultimo dato', 'Temporada', 'Puntos', 'Rebotes', 'Asistencias', 'PRA', 'Triples'],
      rows.map(player => [player.name, player.n, date(player.latest), player.seasons?.join(', ') || 's/d', ...values(player)]));
    playersTable.classList.add('brief-player-table'); individuals.append(playersTable,
      node('p', `Fuente de los registros: ${[...new Set(players.flatMap(player => player.source || []))].join(', ') || 'Base local'}. PRA = puntos + rebotes + asistencias del mismo partido.`, 'brief-sample'));
  }
  item.append(individuals, node('p', game.note, 'brief-notice'));
  if (game.markets.length) {
    const field = node('label', '', 'field basket-condition'), select = node('select'), evidence = node('div'); field.append(node('span', 'Condicion de estudio'), select);
    select.setAttribute('aria-label', 'Condicion de estudio');
    const marketLabel = market => market.spec?.type === 'spread' ? `${spreadTeamLabel(game, market)} (incluye prorroga)` : market.label;
    select.append(...game.markets.map(market => { const option = node('option', marketLabel(market)); option.value = market.id; return option; }));
    select.value = game.markets.find(market => market.id === 'total-over')?.id || game.markets[0].id;
    const render = () => { const market = game.markets.find(row => row.id === select.value); renderBasketballEvidence(evidence, market.evidence, { label: marketLabel(market), probability: market.probability, modeled: true }); };
    select.addEventListener('change', render); render(); item.append(field, evidence);
  }
  const source = node('div', '', 'brief-source'); source.append(link('Calendario / partido NBA', game.source), link('Parte oficial NBA', 'https://official.nba.com/'));
  item.append(source); return item;
}
function updateStatus() {
  document.querySelectorAll('[data-start]').forEach(item => { item.textContent = Date.parse(item.dataset.start) <= Date.now()
    ? 'Inicio ya transcurrido / estado final sin verificar' : 'Horario programado'; });
}
try {
  const response = await fetch('/resumen-2026-10-21.json', { cache: 'no-store' }); if (!response.ok) throw new Error('No se pudo abrir el resumen de esta fecha.');
  const data = await response.json();
  document.getElementById('brief-asof').textContent = `Consulta guardada: ${date(data.asOf)}, ${time(data.asOf)} / America/Guayaquil`;
  document.getElementById('brief-notice').textContent = data.notice;
  document.getElementById('brief-basket-games').replaceChildren(...data.basketball.map(basketball));
  document.getElementById('brief-football-games').replaceChildren(...data.football.map(football));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
  if (today !== data.day) document.getElementById('brief-message').textContent = 'Archivo del 21 de octubre de 2026. Esta seleccion ya no corresponde al dia actual.';
  updateStatus(); setInterval(updateStatus, 60000); window.lucide?.createIcons();
} catch (error) { document.getElementById('brief-message').textContent = error.message; }
