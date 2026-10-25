export function currentCutoff(type, value, manual = false, now = new Date()) {
  if (manual) return value;
  const text = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(type === 'datetime-local' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(now);
  return text.replace(' ', 'T');
}

// Coalesce background changes, and defer repainting until the user's current action finishes.
export function onDataRefresh(sport, ready, refresh, onError = () => {}) {
  let pending = false, running = false;
  const drain = async () => {
    if (!pending || running || !ready()) return;
    pending = false; running = true;
    try { await refresh(); } catch (error) { onError(error); } finally { running = false; }
  };
  document.addEventListener('observatorio:refreshed', event => {
    if (!event.detail.sports.includes(sport)) return;
    pending = true; void drain();
  });
  setInterval(drain, 1000);
}
