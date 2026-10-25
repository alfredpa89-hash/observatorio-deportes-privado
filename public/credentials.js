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
  const response = await fetch('/api/credentials/state');
  if (!response.ok) return;
  const state = await response.json();
  for (const config of configs) {
    const saved = state.saved[config.provider], checkbox = document.getElementById(config.prefix + '-remember');
    checkbox.disabled = !state.available;
    if (!state.available) checkbox.checked = false;
    const text = !state.supported ? 'Guardado cifrado no disponible en este entorno; solo sesion.' : state.error?.replace('Abre Reiniciar.cmd', 'Abre Activar-inicio-automatico.cmd') || (saved ? 'Clave cifrada con tu usuario de Windows. Se recupera automaticamente al arrancar.' : 'Sin copia cifrada. Primera conexion pendiente de guardado.');
    document.getElementById(config.prefix + '-saved-status').textContent = text;
    const button = document.querySelector(`[data-forget="${config.provider}"]`);
    button.disabled = !saved && !state.connections[config.provider === 'footystats' ? 'footystatsConnected' : config.provider + 'Connected'];
  }
  window.lucide?.createIcons();
}
document.addEventListener('observatorio:credentials', () => reload().catch(() => {}));
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-forget]'); if (!button) return;
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
