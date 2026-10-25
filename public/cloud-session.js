const header = document.querySelector('.topbar-right') || document.querySelector('.brief-top');
if (header && !document.querySelector('[data-cloud-logout]')) {
  const form = document.createElement('form'); form.method = 'post'; form.action = '/auth/logout'; form.dataset.cloudLogout = 'true';
  const button = document.createElement('button'); button.type = 'submit'; button.className = 'button'; button.title = 'Cerrar sesion';
  button.textContent = 'Salir'; button.setAttribute('aria-label', 'Cerrar sesion'); form.append(button); header.append(form);
}
