export const SPORT_NAMES = { basketball: 'Baloncesto', football: 'Futbol', tennis: 'Tenis' };
export const JOB_STATUS = { pending: 'Pendiente', running: 'En curso', interrupted: 'Interrumpida', partial: 'Parcial', complete: 'Comprobada', blocked: 'Acceso bloqueado', quota: 'Cuota / reserva', retry: 'Reintento programado' };
export function updateStatus(value) {
  const phase = value.phase || 'pending', updating = phase === 'updating' || Boolean(value.running);
  const reasons = [...(value.missing || []), ...(value.issues || []).map(issue => `${issue.task}: ${issue.message}`),
    ...(value.disabledSports || []).map(sport => `${SPORT_NAMES[sport] || sport}: actualizacion automatica desactivada.`)];
  const labels = { interrupted: 'Actualizacion interrumpida / datos conservados', paused: 'Actualizacion pausada', error: 'Comprobacion incompleta', pending: 'Comprobacion pendiente' };
  return { updating, reasons, state: updating ? 'updating' : reasons.length || phase !== 'checked' ? 'partial' : 'checked',
    title: updating ? phase === 'updating' ? `Actualizando fuentes / ${value.processed} de ${value.total}` : 'Actualizando lote de fuentes' : labels[phase] || (reasons.length || phase === 'partial' ? 'Fuentes revisadas / cobertura parcial' : 'Fuentes disponibles revisadas'),
    timeLabel: phase === 'interrupted' ? 'Ultima solicitud' : updating ? 'Solicitud' : value.finishedAt ? 'Revision terminada' : 'Ultima solicitud',
    time: phase === 'interrupted' || updating ? value.requestedAt : value.finishedAt || value.requestedAt,
    sports: Object.entries(value.sports || {}).map(([key, row]) => `${SPORT_NAMES[key] || key}: ${row.processed}/${row.total}${row.running.length ? ' en curso' : ''}${row.issues ? `; ${row.issues} con limites` : ''}`) };
}
export function jobStatus(job) {
  if (job.status === 'complete' && job.attempt?.outcome === 'updated') return 'Cambios guardados';
  return JOB_STATUS[job.status] || job.status;
}
// An old quota snapshot must never be labelled as today's usage.
export function quotaLabel(quota, now = new Date()) {
  const day = now.toISOString().slice(0, 10), recorded = quota?.day;
  return recorded === day ? 'Contador de hoy (UTC)' : recorded ? `Ultimo contador ${recorded} (UTC); no acredita el consumo de hoy` : 'Fecha del contador sin verificar';
}
