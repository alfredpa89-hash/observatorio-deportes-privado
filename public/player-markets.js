import { basketballEvidence, renderBasketballEvidence } from './basketball-evidence.js';

export const PLAYER_WINDOWS = {
  points: { from: 4.5, to: 49.5, step: 5, width: 5 },
  rebounds: { from: 0.5, to: 19.5, step: 1, width: 3 },
  assists: { from: 0.5, to: 14.5, step: 1, width: 2 },
  pra: { from: 9.5, to: 69.5, step: 5, width: 10 },
  threes: { from: 0.5, to: 9.5, step: 1, width: 1 },
  pr: { from: 9.5, to: 59.5, step: 5, width: 5 },
  pa: { from: 9.5, to: 59.5, step: 5, width: 5 },
  ra: { from: 1.5, to: 29.5, step: 2, width: 3 },
  fieldGoalsMade: { from: 0.5, to: 19.5, step: 1, width: 2 },
  twoPointersMade: { from: 0.5, to: 14.5, step: 1, width: 2 },
  twoPointersAttempted: { from: 0.5, to: 24.5, step: 2, width: 3 },
  fieldGoalsAttempted: { from: 4.5, to: 34.5, step: 2, width: 5 },
  threesAttempted: { from: 0.5, to: 14.5, step: 1, width: 2 },
  freeThrowsMade: { from: 0.5, to: 14.5, step: 1, width: 2 },
  freeThrowsAttempted: { from: 0.5, to: 19.5, step: 1, width: 2 },
};
const count = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const round = value => Math.round(value * 100) / 100;
export function lineSequence(from, to, step, extra = [], max = 499.5) {
  if (![from, to].every(value => Number.isFinite(value) && value >= .5 && value <= max && value % 1 === .5) || from > to || !Number.isInteger(step) || step < 1 || step > 25) throw new Error('Las líneas deben terminar en .5; el paso debe ser un entero de 1 a 25.');
  const values = [...extra];
  for (let line = from; line <= to; line += step) values.push(line);
  if (!values.every(value => Number.isFinite(value) && value >= .5 && value <= max && value % 1 === .5)) throw new Error('La línea adicional debe terminar en .5.');
  const lines = [...new Set(values)].sort((a, b) => a - b);
  if (lines.length > 50) throw new Error('Máximo 50 líneas por consulta; aumenta el paso o reduce el intervalo.');
  return lines;
}
export function makeRanges(maximum, width) {
  if (!count(maximum) || maximum > 499 || !Number.isInteger(width) || width < 1 || width > 100) throw new Error('El ancho del rango debe ser un entero entre 1 y 100.');
  if (Math.ceil((maximum + 1) / width) > 50) throw new Error('Máximo 50 rangos; aumenta su ancho.');
  const ranges = [];
  for (let from = 0; from <= maximum; from += width) ranges.push({ from, to: Math.min(from + width - 1, maximum) });
  ranges.push({ from: maximum + 1, to: Infinity });
  return ranges;
}
export function wilson(hits, n) {
  if (!n) return null;
  const p = hits / n, z2 = 1.96 ** 2, denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const radius = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n ** 2)) / denominator;
  return [round(100 * Math.max(0, center - radius)), round(100 * Math.min(1, center + radius))];
}
export function historyRates(history, metric, lines, ranges) {
  const played = history.filter(item => !Object.hasOwn(item, 'minutes') || typeof item.minutes === 'number' && Number.isFinite(item.minutes) && item.minutes > 0);
  const values = played.map(item => item.values?.[metric]).filter(count), n = values.length;
  const frequency = hits => ({ hits, n, frequency: n ? round(100 * hits / n) : null, interval: wilson(hits, n) });
  return {
    lines: lines.map(line => ({ line, over: frequency(values.filter(value => value > line).length), under: frequency(values.filter(value => value < line).length) })),
    ranges: ranges.map(range => ({ ...range, ...frequency(values.filter(value => value >= range.from && value <= range.to).length) })),
    n, missing: played.length - n,
  };
}
export function historicalCountLabel({ hits, n }) {
  if (!count(hits) || !count(n) || hits > n) return 's/d';
  return n ? `${hits} de ${n} ${n === 1 ? 'partido' : 'partidos'}` : 'Sin partidos con dato';
}
export function probabilityRange(range, overs) {
  const lower = range.from === 0 ? 100 : overs.get(range.from - .5);
  const upper = range.to === Infinity ? 0 : overs.get(range.to + .5);
  if (!probability(lower) || !probability(upper) || upper > lower || ![...overs.values()].some(probability)) return null;
  return round(lower - upper);
}
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });
const pct = value => value == null ? 's/d' : `${number(value)} %`;
const ci = interval => interval ? `${pct(interval[0])} a ${pct(interval[1])}` : 's/d';
const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
const row = (values, header = false) => { const item = node('tr'); item.append(...values.map(value => node(header ? 'th' : 'td', value))); return item; };
const historicalCell = rate => {
  const cell = node('td', '', 'market-historical-value');
  cell.append(node('strong', historicalCountLabel(rate)), node('span', pct(rate.frequency)));
  return cell;
};

export function mountPlayerMarkets(root, { metric, history, defaultLine, initialLines = [], estimate, maximum = 499.5, preset: customPreset, rangeHeading = 'Rangos individuales', guidance }) {
  const existing = [...new Set(initialLines)].filter(value => Number.isFinite(value) && value % 1 === .5).sort((a, b) => a - b);
  const preset = customPreset || PLAYER_WINDOWS[metric] || { from: existing[0] ?? .5, to: Math.max(existing.at(-1) ?? 9.5, existing[0] ?? .5), step: 1, width: 2 };
  const form = node('form', '', 'player-market-controls'), fields = {};
  const field = (key, label, value, min, max, step = 1) => {
    const wrapper = node('label', '', 'field'), text = node('span', label), input = node('input');
    input.type = 'number'; input.value = value; input.min = min; input.max = max; input.step = step; input.required = key !== 'extra';
    fields[key] = input; wrapper.append(text, input); form.append(wrapper);
  };
  field('from', 'Líneas desde', preset.from, .5, maximum);
  field('to', 'Líneas hasta', preset.to, .5, maximum);
  field('step', 'Paso entre líneas', preset.step, 1, 25);
  field('width', 'Ancho de los rangos', preset.width, 1, 100);
  field('extra', 'Otra línea (opcional)', defaultLine ?? '', .5, maximum);
  const modeLabel = node('label', '', 'field'), mode = node('select'); modeLabel.append(node('span', 'Mostrar')); mode.setAttribute('aria-label', 'Mostrar');
  for (const [value, text] of [['both', 'Over y under'], ['over', 'Solo over'], ['under', 'Solo under']]) { const option = node('option', text); option.value = value; mode.append(option); }
  modeLabel.append(mode); form.append(modeLabel);
  const apply = node('button', 'Aplicar líneas', 'button button-secondary'); apply.type = 'submit'; form.append(apply);
  const note = node('p', '', 'calendar-note'), message = node('p', '', 'app-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const lineTable = node('table', '', 'player-market-table'), lineHead = node('thead'), lineBody = node('tbody'), lineScroll = node('div', '', 'table-scroll'); lineTable.append(lineHead, lineBody); lineScroll.append(lineTable);
  const rangeTable = node('table', '', 'player-market-table'), rangeHead = node('thead'), rangeBody = node('tbody'), rangeScroll = node('div', '', 'table-scroll'); rangeTable.append(rangeHead, rangeBody); rangeScroll.append(rangeTable);
  const rangeForm = node('form', '', 'player-custom-range'), rangeMin = node('input'), rangeMax = node('input');
  for (const [input, text, value] of [[rangeMin, 'Rango desde', preset.width], [rangeMax, 'Rango hasta', preset.width * 3 - 1]]) {
    const label = node('label', '', 'field'); label.append(node('span', text)); input.type = 'number'; input.min = 0; input.max = Math.floor(maximum); input.step = 1; input.required = true; input.value = value; label.append(input); rangeForm.append(label);
  }
  const addRange = node('button', 'Añadir rango', 'button button-secondary'); addRange.type = 'submit'; rangeForm.append(addRange);
  root.replaceChildren(form, message, note, lineScroll, node('h4', rangeHeading), rangeForm, rangeScroll);
  const conditionField = node('label', '', 'field basket-condition'), condition = node('select'), evidenceRoot = node('div');
  if (guidance) {
    conditionField.append(node('span', 'Condicion a revisar'), condition);
    note.after(conditionField, evidenceRoot);
  }
  let disposed = false, revision = 0, busy = false, last, extraRanges = [];
  const overs = new Map(), alive = () => !disposed && root.firstElementChild === form;
  function renderGuidance() {
    if (!guidance || !last || !alive()) return;
    const [kind, value] = condition.value.split(':');
    const item = kind === 'range' ? last.ranges[Number(value)] : last.lines.find(item => item.line === Number(value));
    if (!item) return;
    const played = history.filter(item => !Object.hasOwn(item, 'minutes') || typeof item.minutes === 'number' && item.minutes > 0);
    const evidence = basketballEvidence({ ...guidance, history: played, validHistory: played.filter(item => count(item.values?.[metric])) });
    const over = kind === 'range' ? null : overs.get(item.line);
    renderBasketballEvidence(evidenceRoot, evidence, { label: `${guidance.label || metric} / ${condition.selectedOptions[0].textContent}`,
      frequency: kind === 'range' ? item : item[kind], modeled: Boolean(estimate),
      probability: kind === 'range' ? probabilityRange(item, overs) : probability(over) ? kind === 'over' ? over : round(100 - over) : null });
  }
  condition.addEventListener('change', renderGuidance);
  function render() {
    if (!last || !alive()) return;
    const directions = mode.value === 'both' ? ['over', 'under'] : [mode.value];
    const labels = directions.map(value => value === 'over' ? 'Over' : 'Under');
    if (guidance) {
      const previous = condition.value;
      const choices = last.lines.flatMap(item => directions.map(direction => [`${direction}:${item.line}`, `${direction === 'over' ? 'Over' : 'Under'} ${number(item.line)}`]));
      choices.push(...last.ranges.map((item, index) => [`range:${index}`, `Rango ${item.from}${item.to === Infinity ? ' o mas' : ` a ${item.to}`}`]));
      condition.replaceChildren(...choices.map(([value, label]) => { const option = node('option', label); option.value = value; return option; }));
      const preferred = previous || `${directions[0]}:${defaultLine ?? last.lines[0]?.line}`;
      if (choices.some(([value]) => value === preferred)) condition.value = preferred;
      renderGuidance();
    }
    lineHead.replaceChildren(row(['Línea', ...labels.map(label => estimate ? `${label} estimado` : `${label} histórico`), ...(estimate ? labels.map(label => `${label} histórico`) : ['Intervalo 95 % del ' + labels[0].toLowerCase()]), 'Con datos'], true));
    lineBody.replaceChildren(...last.lines.map(item => {
      const over = overs.get(item.line), predictions = directions.map(direction => pct(probability(over) ? direction === 'over' ? over : round(100 - over) : null));
      const entry = row([number(item.line), ...(estimate ? predictions : [])]);
      entry.append(...directions.map(direction => historicalCell(item[direction])));
      if (!estimate) entry.append(node('td', ci(item[directions[0]].interval)));
      entry.append(node('td', item.over.n)); return entry;
    }));
    rangeHead.replaceChildren(row(['Rango', ...(estimate ? ['Probabilidad estimada'] : []), 'Frecuencia histórica', 'Cumplidos / con datos', 'Intervalo 95 % histórico'], true));
    rangeBody.replaceChildren(...last.ranges.map(item => row([`${item.to === Infinity ? `${item.from} o más` : item.from === item.to ? item.from : `${item.from}–${item.to}`}${item.custom ? ' · Personalizado' : ''}`, ...(estimate ? [pct(probabilityRange(item, overs))] : []), pct(item.frequency), `${item.hits} / ${item.n}`, ci(item.interval)])));
    note.textContent = `${last.n} ${last.n === 1 ? 'partido' : 'partidos'} con ${metric === 'pra' ? 'PRA completo' : 'datos de esta estadística'} · ${last.missing} registros sin dato. Frecuencia histórica, no garantía del próximo partido. Intervalos de confianza del 95 % calculados sobre la muestra.${estimate ? ' Estimaciones experimentales condicionadas a jugar; s/d si el modelo no tiene muestra suficiente.' : ''}`;
  }
  async function calculate() {
    if (busy || !alive()) return;
    const token = ++revision;
    try {
      const lines = lineSequence(Number(fields.from.value), Number(fields.to.value), Number(fields.step.value), fields.extra.value === '' ? [] : [Number(fields.extra.value)], maximum);
      const ranges = [...makeRanges(Math.floor(Number(fields.to.value)), Number(fields.width.value)), ...extraRanges];
      last = historyRates(history, metric, lines, ranges); render(); message.textContent = ''; message.classList.remove('error');
      if (estimate) {
        busy = true; root.setAttribute('aria-busy', 'true'); root.querySelectorAll('input, select, button').forEach(input => { input.disabled = true; });
        const needed = new Set([...lines, ...ranges.flatMap(range => [range.from > 0 ? range.from - .5 : null, range.to !== Infinity ? range.to + .5 : null]).filter(value => value !== null)]);
        for (const line of needed) {
          if (!alive() || token !== revision) return;
          if (!overs.has(line)) overs.set(line, await estimate(line));
        }
        if (alive() && token === revision) render();
      }
    } catch (error) { if (alive()) { message.textContent = error.message; message.classList.add('error'); } }
    finally { busy = false; if (alive()) { root.setAttribute('aria-busy', 'false'); root.querySelectorAll('input, select, button').forEach(input => { input.disabled = false; }); } }
  }
  form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
  mode.addEventListener('change', render);
  rangeForm.addEventListener('submit', event => {
    event.preventDefault(); const from = Number(rangeMin.value), to = Number(rangeMax.value);
    if (!count(from) || !count(to) || from > to || to > Math.floor(maximum)) { message.textContent = 'El rango debe contener enteros desde cero, con inicio menor o igual al final.'; message.classList.add('error'); return; }
    if (extraRanges.length >= 10) { message.textContent = 'Máximo 10 rangos personalizados.'; message.classList.add('error'); return; }
    if (!extraRanges.some(range => range.from === from && range.to === to)) extraRanges.push({ from, to, custom: true });
    calculate();
  });
  return { ready: calculate(), dispose() { disposed = true; revision++; root.removeAttribute('aria-busy'); root.replaceChildren(); } };
}
