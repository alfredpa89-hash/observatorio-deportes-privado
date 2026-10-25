import { canonicalTeam } from './football-history.mjs';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const display = value => value.toLocaleString('es-EC', { maximumFractionDigits: 1 });

export function performanceSignals({ sport, kind, history = [], cutoff, referencePoints = null }) {
  const time = Date.parse(cutoff), seen = new Set();
  const rows = history.filter(row => Date.parse(row.date) < time && Date.parse(row.availableAfter || row.date) < time)
    .sort((a, b) => b.date.localeCompare(a.date)).filter(row => {
      const id = row.id || `${row.date}:${row.opponent || ''}:${row.team || ''}`;
      if (seen.has(id)) return false; seen.add(id); return true;
    });
  const signals = [], recent = rows.slice(0, 5);
  function add(id, title, detail, n, missing = 0) {
    signals.push({ id, title, detail, n, missing, category: 'performance', evidence: 'historical',
      source: [...new Set(rows.map(row => row.source).filter(Boolean))].slice(0, 3).join(', ') || 'Historial guardado',
      latest: rows[0]?.date || null });
  }
  function frequency(id, title, sample, read, accepts) {
    const values = sample.map(read).filter(value => value !== null && value !== undefined);
    if (values.length < 3) return;
    add(id, title, `${values.filter(accepts).length} de ${values.length} partidos con datos. Frecuencia historica, no probabilidad del siguiente partido.`, values.length, sample.length - values.length);
  }
  frequency('form-five', 'Victorias recientes', recent, row => {
    if (sport === 'tennis') return [true, false, 0, 1].includes(row.values?.won) ? Boolean(row.values.won) : null;
    return ['W', 'D', 'L'].includes(row.result) ? row.result === 'W' : null;
  }, value => value);
  if (sport === 'football' && kind === 'team') {
    frequency('btts', 'Ambos marcaron', rows, row => number(row.values?.goals) && number(row.values?.goalsAgainst) ? row.values.goals > 0 && row.values.goalsAgainst > 0 : null, value => value);
    frequency('first-half-goal', 'Al menos un gol en el primer tiempo', rows, row => number(row.values?.halfTimeGoalsTotal) ? row.values.halfTimeGoalsTotal : null, value => value > 0);
  }
  if (sport === 'football' && kind === 'player') {
    frequency('goal-contribution', 'Partidos con gol o asistencia', rows, row => number(row.values?.goals) && number(row.values?.assists) ? row.values.goals + row.values.assists : null, value => value > 0);
  }
  if (sport === 'basketball' && kind === 'player' && number(referencePoints)) {
    frequency('point-reference', `Alcanzo ${referencePoints} puntos`, rows, row => number(row.values?.points) ? row.values.points : null, value => value >= referencePoints);
  }
  const metric = sport === 'basketball' ? 'points' : sport === 'tennis' ? 'aces' : kind === 'player' ? 'minutes' : 'goals';
  const label = { points: 'Puntos', aces: 'Aces', minutes: 'Minutos', goals: 'Goles a favor' }[metric];
  const valueOf = row => metric === 'minutes' ? row.minutes : row.values?.[metric];
  const first = recent.map(valueOf), previous = rows.slice(5, 10).map(valueOf);
  // Compare fixed windows before excluding missing metrics; never replace an absent value with zero.
  if (first.length === 5 && previous.length === 5 && first.every(number) && previous.every(number)) {
    const a = mean(first), b = mean(previous), delta = a - b;
    add('trend-ten', `${label}: ultimos 5 frente a los 5 anteriores`, `${display(a)} frente a ${display(b)} de media (${delta > 0 ? '+' : ''}${display(delta)}). Comparacion descriptiva; no atribuye causas.`, 10);
  }
  if (kind === 'player' && sport !== 'tennis') {
    const minutes = recent.map(row => row.minutes).filter(number);
    if (minutes.length >= 3) add('minutes-five', 'Minutos en las ultimas participaciones', `${display(mean(minutes))} min de media en ${minutes.length} participaciones con datos. No confirma fatiga, titularidad ni limite de minutos.`, minutes.length, recent.length - minutes.length);
  }
  return signals;
}

export function buildPrematchBrief(scope, notes = [], availability = []) {
  const items = [], coverage = [];
  for (const entity of scope.entities) {
    const reports = availability.filter(row => !row.expired && (entity.kind === 'player' ? row.playerKey === entity.playerKey :
      row.team && canonicalTeam(row.team, scope.country) === canonicalTeam(entity.team, scope.country)));
    const current = notes.filter(row => row.entityId === entity.id && !row.expired && !row.withdrawn);
    const reviewed = current.filter(row => row.review?.action === 'reviewed');
    coverage.push({ entityId: entity.id, name: entity.name, history: entity.n || 0, latest: entity.latest || null,
      stale: entity.partial === true, availability: reports.length, reviewed: reviewed.length,
      pending: current.length - reviewed.length });
    for (const row of reports) items.push({ id: `availability:${row.id || row.playerKey || row.team}`, entityId: entity.id, name: entity.name,
      title: row.name || row.team || entity.name, detail: row.note || 'Sin detalle adicional del reporte.', category: 'availability', evidence: 'reported',
      status: row.status, sourceUrl: row.sourceUrl, publishedAt: row.publishedAt, expiresAt: row.expiresAt, priority: row.status === 'active' ? 2 : 0 });
    for (const row of current) items.push({ id: row.id, entityId: entity.id, name: entity.name, title: row.title, detail: row.note,
      category: ['injury', 'suspension', 'medical'].includes(row.category) ? 'availability' : row.category === 'competition' ? 'competition' : 'performance',
      evidence: row.review?.action === 'reviewed' ? 'user-reviewed' : 'unverified', sourceUrl: row.sourceUrl,
      publishedAt: row.publishedAt, expiresAt: row.expiresAt, priority: row.review?.action === 'reviewed' ? 1 : 3 });
    for (const signal of entity.signals || []) items.push({ ...signal, id: `${entity.id}:${signal.id}`, entityId: entity.id, name: entity.name, priority: 4 });
  }
  return { items: items.sort((a, b) => a.priority - b.priority), coverage,
    notice: 'Los reportes y las tendencias son contexto. No modifican las probabilidades ni acreditan por si solos el estado fisico actual.' };
}
