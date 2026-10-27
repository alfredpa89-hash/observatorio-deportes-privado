import { jsonRequest } from './api-client.js';
let managed = false;
const configs = [
  { provider: 'football', form: 'key-form', prefix: 'api' },
  { provider: 'basketball', form: 'bb-key-form', prefix: 'bb' },
  { provider: 'footystats', form: 'fs-key-form', prefix: 'fs' },
];
for (const config of configs) {
  const form = document.getElementById(config.form), controls = document.createElement('div');
  controls.className = 'credential-controls';
  controls.innerHTML = `<label><input id="${config.prefix}-remember" type="checkbox" checked>Guardar cifrada en este equipo</label><button class="button button-secondary icon-button" type="button" title="Olvidar clave guardada y desconectar" aria-label="Olvidar clave ${config.provider}" data-forget="${config.provider}"><i data-lucide="key-round" aria-hidden="true"></i></button><p id="${config.prefix}-saved-status" role="status"></p>`;
  form.after(controls);
}
async function reload() {
  const state = await jsonRequest('/api/credentials/state');
  managed = state.protection === 'Secretos del servidor / Render';
  for (const config of configs) {
    const saved = state.saved[config.provider], checkbox = document.getElementById(config.prefix + '-remember');
    checkbox.disabled = !state.available;
    if (!state.available) checkbox.checked = false;
    const text = managed ? saved ? 'Clave configurada en el servidor. Se recupera automaticamente despues de reiniciar; no necesitas volver a introducirla.'
      : 'Falta configurar esta clave en los secretos de Render. Debe guardarse una sola vez en el servidor, no en este formulario.'
      : !state.supported ? 'Guardado cifrado no disponible en este entorno; solo sesion.' : state.error?.replace('Abre Reiniciar.cmd', 'Abre Activar-inicio-automatico.cmd') || (saved ? 'Clave cifrada con tu usuario de Windows. Se recupera automaticamente al arrancar.' : 'Sin copia cifrada. Primera conexion pendiente de guardado.');
    const status = document.getElementById(config.prefix + '-saved-status'); status.textContent = text;
    const button = document.querySelector(`[data-forget="${config.provider}"]`);
    button.disabled = managed || !saved && !state.connections[config.provider === 'footystats' ? 'footystatsConnected' : config.provider + 'Connected'];
    if (managed) {
      document.getElementById(config.form).hidden = true; checkbox.parentElement.hidden = true; button.hidden = true;
      const link = document.createElement('a'); link.href = 'https://dashboard.render.com/web/srv-dbf3a9t9fdbs738luvvg/env'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = ' Abrir configuracion privada del servidor'; status.append(link);
      status.append(document.createTextNode(` · Variable: ${{ football: 'API_FOOTBALL_KEY', basketball: 'API_BASKETBALL_KEY', footystats: 'FOOTYSTATS_KEY' }[config.provider]}.`));
    }
  }
  window.lucide?.createIcons();
}
document.addEventListener('observatorio:credentials', () => reload().catch(() => {}));
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-forget]'); if (!button) return;
  if (managed) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/credentials/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: button.dataset.forget }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo olvidar la clave.');
    location.reload();
  } catch (error) {
    const config = configs.find(config => config.provider === button.dataset.forget);
    document.getElementById(config.prefix + '-saved-status').textContent = error.message;
    button.disabled = false;
  }
});
reload().catch(() => {});
