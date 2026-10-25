const DAY = 86400000;
const count = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const date = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value)) : 's/d';
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC', { maximumFractionDigits: 2 });

// Evidence labels describe the saved sample, never the accuracy of a prediction.
export function basketballEvidence({ history = [], validHistory = history, cutoff, season, lookback, kind = 'team', availability = 'unknown' }) {
  const time = Date.parse(cutoff);
  const eligible = row => Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) < time &&
    (!row.availableAfter || Date.parse(row.availableAfter) < time);
  const dates = validHistory.filter(eligible).map(row => row.date).sort();
  const latest = dates.at(-1) || null, ageDays = latest ? Math.floor((time - Date.parse(latest)) / DAY) : null;
  const seasons = [...new Set(validHistory.map(row => row.season).filter(Boolean))].sort();
  const n = validHistory.length, missing = Math.max(0, history.length - n);
  const unfilled = Number.isInteger(Number(lookback)) ? Math.max(0, Number(lookback) - history.length) : 0;
  const previousOnly = n > 0 && Boolean(season) && validHistory.every(row => row.season && row.season < season);
  const reasons = [];
  if (!n) reasons.push('Sin datos de esta condicion. Completar el campo antes de interpretarla.');
  if (n && dates.length !== n) reasons.push('Hay registros sin fecha util verificable para este corte.');
  if (ageDays > 45) reasons.push(`Ultimo dato hace ${ageDays} dias: no acredita la forma actual.`);
  if (previousOnly) reasons.push('Solo hay temporadas anteriores en esta muestra; plantilla y rol actuales pendientes.');
  else if (season && seasons.some(value => value < season)) reasons.push('La muestra incluye temporadas anteriores.');
  if (n > 0 && n < 10) reasons.push('Muestra reducida: menos de 10 partidos con esta condicion.');
  if (missing) reasons.push(`${missing} registros de la muestra sin esta estadistica; no se cuentan como cero.`);
  if (unfilled) reasons.push(`${unfilled} partidos faltan para completar la ventana solicitada.`);
  if (kind === 'player') reasons.push(availability === 'active'
    ? 'Disponibilidad declarada; comprobar vigencia, equipo y minutos antes del encuentro.'
    : 'Disponibilidad y minutos del proximo encuentro sin confirmar. El historial no confirma que vaya a jugar.');
  else reasons.push('Las bajas y alineaciones no ajustan automaticamente esta estimacion.');
  const level = !n ? 4 : ageDays === null || dates.length !== n || ageDays > 45 || previousOnly ? 3
    : n < 10 || missing || unfilled ? 2 : kind === 'player' && availability !== 'active' ? 1 : 0;
  const label = ['Historial disponible', 'Disponibilidad por confirmar', 'Evidencia limitada', 'Solo referencia historica', 'Pendiente de datos'][level];
  return { n, sample: history.length, missing, unfilled, latest, oldest: dates[0] || null, ageDays, seasons, previousOnly, level, label, reasons };
}

export function basketballPeriodPair(game, period = 'ft') {
  if (period === 'ft') return [game.homePoints, game.awayPoints];
  return ['home', 'away'].map(side => game.periods?.[side]?.[period] ?? game.stats?.[side]?.[period === 'q1' ? 'firstQuarterPoints' : period === 'ht' ? 'halfTimePoints' : period]);
}

export function basketballTeamEvidence(histories, spec, context) {
  const samples = ['home', 'away'].map(side => {
    const history = histories?.[side] || [];
    const validHistory = history.filter(game => basketballPeriodPair(game, spec?.period || 'ft').every(count));
    return { side, ...basketballEvidence({ ...context, history, validHistory }) };
  });
  const weakest = [...samples].sort((a, b) => b.level - a.level || (a.latest || '').localeCompare(b.latest || ''))[0];
  return { ...weakest, samples, n: Math.min(...samples.map(row => row.n)),
    missing: samples.reduce((sum, row) => sum + row.missing, 0), unfilled: samples.reduce((sum, row) => sum + row.unfilled, 0),
    reasons: [...new Set(samples.flatMap(row => row.reasons))] };
}

export function evidenceSampleLabel(evidence) {
  return evidence.samples ? evidence.samples.map(row => `${row.side === 'home' ? 'Local' : 'Visitante'}: ${row.n}/${row.sample} con datos; ultimo ${date(row.latest)}`).join(' | ')
    : `${evidence.n}/${evidence.sample} con datos; ultimo ${date(evidence.latest)}`;
}

export function renderBasketballEvidence(root, evidence, { label = '', frequency, probability, modeled = false } = {}) {
  const node = (tag, text, className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
  root.className = 'basket-evidence'; root.dataset.level = String(evidence.level);
  const heading = node('div', '', 'basket-evidence-heading'); heading.append(node('strong', label || 'Respaldo de la condicion'), node('span', evidence.label));
  const stats = [];
  if (frequency) stats.push(frequency.n ? `${frequency.hits} de ${frequency.n} partidos cumplieron la condicion (${number(frequency.frequency)} % historico).`
    : 'Sin partidos con datos de esta condicion.');
  if (modeled) stats.push(probability == null ? 'Estimacion no disponible.' : `Estimacion del modelo: ${number(probability)} %. No equivale a la frecuencia historica.`);
  else stats.push('Referencia historica, no pronostico del siguiente encuentro.');
  if (frequency?.interval) stats.push(`Intervalo historico 95 %: ${number(frequency.interval[0])} a ${number(frequency.interval[1])} %.`);
  const warnings = node('ul', ''); warnings.append(...evidence.reasons.map(reason => node('li', reason)));
  root.replaceChildren(heading, node('p', stats.join(' ')), node('p', evidenceSampleLabel(evidence)), warnings);
}
