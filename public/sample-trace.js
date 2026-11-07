const validDate = value => value && Number.isFinite(Date.parse(value));
const date = (value, approximate) => !validDate(value) ? 'sin fecha verificable' : approximate ? `${value.slice(0, 10)} (fecha de fuente / torneo)` :
  new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value));
export function sampleTrace({ history = [], requested, label = 'Muestra', approximate = false, cutoff } = {}) {
  const dates = history.map(row => row.date).filter(validDate).sort((a, b) => Date.parse(a) - Date.parse(b));
  const sources = [...new Set(history.flatMap(row => Array.isArray(row.source) ? row.source : row.source ? [row.source] : []))];
  const latest = dates.at(-1) || null, unfilled = Number.isInteger(Number(requested)) && Number(requested) > 0 ? Math.max(0, Number(requested) - history.length) : null;
  const age = latest && validDate(cutoff) ? Math.floor((Date.parse(cutoff) - Date.parse(latest)) / 86400000) : null;
  return { latest, oldest: dates[0] || null, n: history.length, unfilled, sources, stale: age > 45,
    text: `${label}: ${history.length}${unfilled === null ? '' : ` de ${requested} solicitados; ${unfilled} por completar`}. Ultimo dato: ${date(latest, approximate)}. Fuentes: ${sources.join(', ') || 'no identificadas en estas filas'}.${age > 45 ? ' Historial antiguo: no acredita forma actual.' : ''}${dates.length < history.length ? ' Hay registros sin fecha verificable.' : ''}` };
}
export function mountSampleTrace(root) {
  const element = document.createElement('aside'); element.className = 'sample-trace'; element.setAttribute('aria-label', 'Muestra, fecha y fuentes'); root.prepend(element);
  return { show(samples) { element.replaceChildren(...samples.map(sample => { const p = document.createElement('p'), value = sampleTrace(sample); p.textContent = value.text; p.dataset.stale = String(value.stale); return p; })); } };
}
