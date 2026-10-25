export function footballSourceMode() { return document.body.dataset.footballSource || 'combined'; }
export function footballFieldLabel(path) {
  const parts = path.split('.'), field = parts.at(-1), labels = { shots: 'Tiros', shotsOnTarget: 'Tiros al arco', corners: 'Corners', fouls: 'Faltas', yellow: 'Amarillas', red: 'Rojas', offsides: 'Fueras de juego' };
  if (parts[0] === 'stats') return `${labels[field] || field} ${parts[1] === 'home' ? 'local' : 'visitante'}`;
  return `${field.endsWith('Goals') ? 'Goles' : 'Corners'} ${field.startsWith('home') ? 'local' : 'visitante'}${parts[0] === 'halfTime' ? ' / primer tiempo' : ''}`;
}

export function filterFootballSources(leagues, mode = footballSourceMode()) {
  return leagues.filter(league => mode === 'footystats' ? league.source === 'FootyStats' : mode === 'api-football' ? league.source === 'api-football' : true)
    .sort((a, b) => Number(Boolean(b.seasons?.length)) - Number(Boolean(a.seasons?.length)) || a.name.localeCompare(b.name, 'es'));
}

export function setFootballSource(mode) {
  const value = ['footystats', 'api-football'].includes(mode) ? mode : 'combined';
  document.body.dataset.footballSource = value;
  const selector = document.getElementById('football-source-mode'); if (selector) selector.value = value;
  updateSourceNote();
  try { localStorage.setItem('observatorio-football-source-v2', value); } catch { /* The source filter also works without storage. */ }
  document.dispatchEvent(new CustomEvent('observatorio:football-source', { detail: value }));
}

let initial = 'combined';
try { initial = localStorage.getItem('observatorio-football-source-v2') || initial; } catch { /* Keep the default source. */ }
document.body.dataset.footballSource = ['footystats', 'api-football'].includes(initial) ? initial : 'combined';
const selector = document.getElementById('football-source-mode');
if (selector) { selector.value = footballSourceMode(); selector.addEventListener('change', () => setFootballSource(selector.value)); }
function updateSourceNote() {
  const note = document.getElementById('football-source-note');
  if (note) note.textContent = footballSourceMode() === 'footystats' ? 'Solo FootyStats. Los acumulados de jugadores no son participaciones por partido.' : footballSourceMode() === 'api-football' ? 'Solo API-Football, sin completar campos desde otras fuentes.' : 'API-Football prioritario; FootyStats completa campos ausentes de partidos coincidentes. Historial sin duplicados; procedencia y discrepancias por dato. Los porcentajes los calcula la app.';
}
updateSourceNote();
