const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC');
export function mountFootballSeasonAggregates(root) {
  const panel = node('details'); panel.hidden = true; panel.className = 'method-details';
  panel.append(node('summary', 'Acumulados de temporada / FootyStats'));
  const note = node('p'), label = node('label', 'Orden del acumulado'), order = node('select');
  const fields = { goals: 'Goles', assists: 'Asistencias', minutes: 'Minutos', yellow: 'Amarillas', red: 'Rojas', saves: 'Atajadas' };
  for (const [value, text] of Object.entries(fields)) { const option = node('option', text); option.value = value; order.append(option); }
  label.append(order); panel.append(note, label);
  const scroll = node('div'); scroll.className = 'table-scroll';
  const table = node('table'), head = node('thead'), body = node('tbody'), titles = node('tr');
  for (const text of ['Jugador / ID FootyStats', 'Equipo', 'Participaciones', 'Minutos', 'Goles', 'Asistencias', 'Amarillas', 'Rojas', 'Atajadas']) titles.append(node('th', text));
  head.append(titles); table.append(head, body); scroll.append(table); panel.append(scroll);
  const pager = node('div'); pager.className = 'dc-actions';
  const status = node('span'), previous = node('button'), next = node('button');
  for (const [button, icon, title] of [[previous, 'chevron-left', 'Acumulados anteriores'], [next, 'chevron-right', 'Acumulados siguientes']]) {
    button.type = 'button'; button.className = 'button button-secondary icon-button'; button.title = title; button.setAttribute('aria-label', title);
    const i = node('i'); i.dataset.lucide = icon; button.append(i);
  }
  pager.append(status, previous, next); panel.append(pager); root.append(panel);
  let dataset, page = 0;
  function render() {
    const players = [...(dataset?.players || [])].sort((a, b) => (b[order.value] ?? -1) - (a[order.value] ?? -1) || a.name.localeCompare(b.name, 'es'));
    body.replaceChildren(...players.slice(page * 20, (page + 1) * 20).map(player => {
      const row = node('tr');
      for (const value of [`${player.name} / FS:${player.id}`, player.team || 'Sin equipo confirmado', ...['appearances', 'minutes', 'goals', 'assists', 'yellow', 'red', 'saves'].map(field => number(player[field]))]) row.append(node('td', value));
      return row;
    }));
    status.textContent = `${players.length} registros / pagina ${page + 1} de ${Math.max(1, Math.ceil(players.length / 20))}`;
    previous.disabled = !page; next.disabled = (page + 1) * 20 >= players.length;
    note.textContent = dataset ? `${dataset.season} / FootyStats / descarga ${new Date(dataset.downloadedAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}${dataset.partial ? ' / parcial' : ''}. ${dataset.note}` : '';
    window.lucide?.createIcons();
  }
  order.addEventListener('change', () => { page = 0; render(); });
  previous.addEventListener('click', () => { page--; render(); }); next.addEventListener('click', () => { page++; render(); });
  return datasets => { dataset = datasets?.[0]; page = 0; panel.hidden = !dataset; render(); };
}
