import { basketballTeamEvidence, renderBasketballEvidence } from './basketball-evidence.js';
const node = (tag, text = '', className = '') => { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; };
const option = (value, label) => { const el = node('option', label); el.value = value; return el; };
const pct = value => value == null ? 's/d' : `${value.toLocaleString('es-EC', { maximumFractionDigits: 2 })} %`;

export function mountBasketballScenarioPicker(root, { onLine, onSelect }) {
  const heading = node('h3', 'Condiciones y probabilidades del encuentro');
  const form = node('form', '', 'overview-filters'), fields = {};
  for (const [key, title, choices] of [
    ['period', 'Periodo de la condicion', [['ft', 'Partido completo'], ['q1', 'Primer cuarto'], ['ht', 'Descanso']]],
    ['type', 'Condicion del encuentro', [['total', 'Total de puntos'], ['winner', 'Ganador'], ['spread', 'Handicap FT']]],
    ['direction', 'Sentido de la condicion', [['over', 'Over (mas de)'], ['under', 'Under (menos de)']]],
    ['line', 'Linea de puntos del encuentro', []],
  ]) { const label = node('label', '', 'field'), input = node('select'); input.append(...choices.map(([value, text]) => option(value, text)));
    label.append(node('span', title), input); form.append(label); fields[key] = input; }
  const customLabel = node('label', '', 'field'), custom = node('input'); custom.type = 'number'; custom.min = '.5'; custom.max = '499.5'; custom.step = '1'; custom.placeholder = 'Ej. 223.5';
  customLabel.append(node('span', 'Otra linea de puntos (.5)'), custom);
  const apply = node('button', 'Calcular otra linea', 'button button-secondary'); apply.type = 'submit'; form.append(customLabel, apply);
  const message = node('p', '', 'calendar-note'), evidence = node('div'), selections = node('div', '', 'overview-cards');
  const compare = node('details'), summary = node('summary', 'Comparar todas las lineas del periodo'), scroll = node('div', '', 'table-scroll'), table = node('table', '', 'basket-table'), tbody = node('tbody');
  const head = node('thead'), row = node('tr'); row.append(...['Linea', 'Over', 'Under'].map(text => node('th', text))); head.append(row); table.append(head, tbody); scroll.append(table); compare.append(summary, scroll);
  root.append(heading, form, message, evidence, selections, compare);
  let report;
  const totalGroup = () => fields.period.value === 'ft' ? 'total' : `${fields.period.value}-total`;
  function draw(resetLine = false) {
    if (!report) return;
    const total = fields.type.value === 'total', previous = fields.line.value;
    fields.line.parentElement.hidden = fields.direction.parentElement.hidden = customLabel.hidden = apply.hidden = compare.hidden = !total;
    const period = fields.period.value;
    const markets = report.markets.filter(market => market.spec.period === period && market.spec.type === fields.type.value);
    const lines = [...new Set(markets.filter(market => market.spec.type === 'total').map(market => market.spec.line))].sort((a, b) => a - b);
    fields.line.replaceChildren(...lines.map(value => option(String(value), String(value))));
    const defaultLine = report.meta.league === 'nba' ? { ft: 220.5, q1: 55.5, ht: 110.5 } : { ft: 160.5, q1: 40.5, ht: 80.5 };
    fields.line.value = !resetLine && lines.includes(Number(previous)) ? previous : String(defaultLine[period]);
    if (!fields.line.value && lines.length) fields.line.value = String(lines[0]);
    const selected = markets.filter(market => !total || market.spec.line === Number(fields.line.value) && market.spec.direction === fields.direction.value);
    evidence.replaceChildren(); selections.replaceChildren();
    const first = selected[0];
    if (first) {
      renderBasketballEvidence(evidence, basketballTeamEvidence(report.history, first.spec, report.meta), { label: first.label, probability: first.probability, modeled: true });
      if (first.observed) evidence.append(node('p', ['home', 'away'].map(side => `${side === 'home' ? 'Local' : 'Visitante'}: ${first.observed[side]?.hits ?? 0} de ${first.observed[side]?.n ?? 0} partidos cumplieron`).join(' · '), 'calendar-note'));
    }
    if (!selected.length) evidence.append(node('p', 'Sin estimacion para esta condicion o periodo. No equivale a 0 %.'));
    if (!total) for (const market of selected) { const card = node('article', '', 'overview-card'),choose=node('button','Analizar esta opcion','button button-secondary');choose.type='button';choose.addEventListener('click',()=>onSelect?.(market));card.append(node('p', market.label), node('strong', pct(market.probability)),choose); selections.append(card); }
    tbody.replaceChildren(...lines.map(line => { const tr = node('tr'); tr.append(node('td', String(line)), ...['over', 'under'].map(direction => node('td', pct(markets.find(market => market.spec.line === line && market.spec.direction === direction)?.probability)))); return tr; }));
    message.textContent = `Total esperado: ${report.meta.expectedTotalPoints ?? 's/d'} puntos · ${report.meta.lookback} partidos por equipo. FT incluye prorroga. Lineas de analisis, sin cuotas actuales; bajas no ajustadas. Estimaciones experimentales.`;
    onSelect?.(first);
  }
  fields.period.addEventListener('change', () => draw(true));
  for (const key of ['type', 'direction', 'line']) fields[key].addEventListener('change', () => draw());
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!custom.value) { message.textContent = 'Escribe la nueva linea terminada en .5.'; return; }
    apply.disabled = true;
    try { await onLine({ scenarioLine: Number(custom.value), scenarioPeriod: fields.period.value });
      fields.line.value = custom.value; draw(); custom.value = ''; }
    catch (error) { message.textContent = error.message; }
    finally { apply.disabled = false; }
  });
  return { setReport(value) {
    report = value; form.hidden = evidence.hidden = selections.hidden = compare.hidden = !value;
    if (!value) { message.textContent = 'Selecciona un encuentro futuro con datos. Endesa conserva el analisis descriptivo mientras su modelo queda pendiente.'; return; }
    draw();
  } };
}
