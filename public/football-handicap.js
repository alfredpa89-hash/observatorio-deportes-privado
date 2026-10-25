export const SETTLEMENTS = { fullWin: 'Victoria completa', halfWin: 'Media victoria', push: 'Devolucion', halfLoss: 'Media perdida', loss: 'Derrota' };
export const HANDICAP_GROUPS = {
  handicap: { key: 'handicapEuropean', label: 'Handicap europeo', kind: 'european', period: 'ft', step: 1 },
  'asian-handicap': { key: 'handicapAsian', label: 'Handicap asiatico', kind: 'asian', period: 'ft', step: .25 },
  'handicap-1t': { key: 'halfTimeHandicapEuropean', label: 'Handicap europeo 1T', kind: 'european', period: 'ht', step: 1 },
  'asian-handicap-1t': { key: 'halfTimeHandicapAsian', label: 'Handicap asiatico 1T', kind: 'asian', period: 'ht', step: .25 },
};
export const handicapLabel = line => line > 0 ? `+${line}` : String(line);
export function validHandicap(line, kind) {
  return ['european', 'asian'].includes(kind) && typeof line === 'number' && Number.isFinite(line) && Math.abs(line) <= 10 && Number.isInteger(line * (kind === 'european' ? 1 : 4));
}
export function splitHandicap(line) {
  if (!validHandicap(line, 'asian')) throw new RangeError('Handicap asiatico no valido: usa pasos de 0.25 entre -10 y +10.');
  const quarters = line * 4;
  return Number.isInteger(line * 2) ? [line] : [Math.floor(quarters / 2) / 2, Math.ceil(quarters / 2) / 2];
}
export function settleHandicap(goalsFor, goalsAgainst, line, kind = 'asian') {
  if (![goalsFor, goalsAgainst].every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0)) return null;
  if (!validHandicap(line, kind)) throw new RangeError('Linea de handicap no valida.');
  const margin = goalsFor - goalsAgainst;
  if (kind === 'european') return margin + line > 0 ? 'home' : margin + line < 0 ? 'away' : 'draw';
  const legs = splitHandicap(line).map(value => Math.sign(margin + value));
  const result = legs.reduce((sum, value) => sum + value, 0) / legs.length;
  return result === 1 ? 'fullWin' : result === .5 ? 'halfWin' : result === 0 ? 'push' : result === -.5 ? 'halfLoss' : 'loss';
}
export function roundedShares(values) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) return values.map(() => null);
  const raw = values.map(value => value / sum * 1000), units = raw.map(Math.floor);
  const order = raw.map((value, index) => ({ index, remainder: value - units[index] })).sort((a, b) => b.remainder - a.remainder);
  const remaining = 1000 - units.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) units[order[i].index]++;
  return units.map(value => value / 10);
}
export function settlementSummary(outcomes) {
  const counts = Object.fromEntries(Object.keys(SETTLEMENTS).map(key => [key, outcomes.filter(value => value === key).length]));
  const n = Object.values(counts).reduce((sum, value) => sum + value, 0), rates = roundedShares(Object.values(counts));
  return { counts, n, missing: outcomes.length - n, percentages: Object.fromEntries(Object.keys(counts).map((key, i) => [key, rates[i]])) };
}
export function handicapDefinitions(thresholds = {}, names = { home: 'Local', away: 'Visitante' }, individual = false) {
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) throw new RangeError('Los limites deben ser un objeto.');
  const result = [];
  for (const [group, config] of Object.entries(HANDICAP_GROUPS)) {
    const requested = thresholds[config.key] ?? [];
    if (!Array.isArray(requested) || requested.length > 20 || requested.some(line => !validHandicap(line, config.kind))) throw new RangeError(`Lineas de ${config.label}: hasta 20 valores entre -10 y +10 en pasos de ${config.step}.`);
    const defaults = config.kind === 'european' ? [-3, -2, -1, 0, 1, 2, 3] : Array.from({ length: 17 }, (_, i) => (i - 8) / 4);
    const lines = [...new Set([...defaults, ...requested])].sort((a, b) => a - b);
    for (const line of lines) for (const side of config.kind === 'european' ? ['home', 'draw', 'away'] : individual ? ['home'] : ['home', 'away']) {
      const periodLabel = config.period === 'ht' ? ' / 1T' : '';
      const label = config.kind === 'european'
        ? `${side === 'home' ? `Gana ${names.home}` : side === 'draw' ? 'Empate con handicap' : `Gana ${names.away}`} / ${names.home} ${handicapLabel(line)}${periodLabel}`
        : `${names[side]} ${handicapLabel(line)}${periodLabel}`;
      result.push({ group, id: `handicap-${config.kind}-${config.period}-${line}-${side}`, label, line, side,
        handicapKind: config.kind, period: config.period, scope: null, thresholdKey: config.key,
        ...(config.kind === 'asian' ? { splitLines: splitHandicap(line), probabilityMeaning: 'Victoria completa' } : {}) });
    }
  }
  return result;
}
export function configureHandicapInput(input, group) {
  const config = HANDICAP_GROUPS[group];
  input.required = true;
  input.min = config ? '-10' : '.5'; input.max = config ? '10' : '99.5'; input.step = config ? String(config.step) : '1';
  if (!input.value.trim() || (!config && (Number(input.value) < .5 || Number(input.value) % 1 !== .5)) || (config && !validHandicap(Number(input.value), config.kind))) input.value = config ? '-1' : '.5';
}
