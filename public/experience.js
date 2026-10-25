const $ = id => document.getElementById(id);
const icons = { 'bb-refresh': 'refresh-cw', 'bb-connect': 'plug', 'br-sync': 'cloud-download', 'br-access': 'shield-check', 'analyze-button': 'chart-no-axes-combined', 'profile-analyze': 'chart-no-axes-combined', 'toggle-sources': 'database' };
function decorateButton(id, name) {
  const button = $(id), icon = document.createElement('i');
  if (button.querySelector('svg, [data-lucide]')) return;
  const label = document.createElement('span'); label.className = 'button-label'; label.textContent = button.textContent;
  if (id === 'bb-connect') { button.setAttribute('aria-label', button.textContent); button.title = button.textContent; }
  icon.dataset.lucide = name; icon.setAttribute('aria-hidden', 'true');
  button.replaceChildren(icon, label); button.classList.add('with-icon');
}
for (const [id, name] of Object.entries(icons)) decorateButton(id, name);
window.lucide?.createIcons();
for (const [id, name] of Object.entries(icons)) new MutationObserver(() => {
  if (!$(id).querySelector('svg, [data-lucide]')) { decorateButton(id, name); window.lucide?.createIcons(); }
}).observe($(id), { childList: true });

function readPreferences() {
  try { return JSON.parse(localStorage.getItem('observatorio-navigation') || '{}'); } catch { return {}; }
}
function savePreferences(update) {
  try { localStorage.setItem('observatorio-navigation', JSON.stringify({ ...readPreferences(), ...update })); } catch { /* Navigation still works when local storage is unavailable. */ }
}
document.addEventListener('observatorio:sport', event => {
  document.body.dataset.activeSport = event.detail;
  savePreferences({ sport: event.detail });
});
for (const [id, view] of [['view-match', 'matches'], ['view-individual', 'individual'], ['view-football-players', 'players']]) {
  $(id).addEventListener('click', () => { if (document.body.dataset.activeSport === 'football') savePreferences({ 'football-view': view }); });
}
for (const attribute of ['basket-view', 'research-view']) {
  document.querySelectorAll(`[data-${attribute}]`).forEach(button => {
    const view = button.getAttribute(`data-${attribute}`), current = button.classList.contains('active');
    const panel = $(`${attribute === 'basket-view' ? 'bb' : 'br'}-${view}-view`);
    button.id = `${attribute}-${view}`; button.setAttribute('role', 'tab'); button.removeAttribute('aria-pressed');
    button.setAttribute('aria-selected', String(current)); button.tabIndex = current ? 0 : -1;
    button.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    button.parentElement.setAttribute('role', 'tablist');
    button.addEventListener('click', () => savePreferences({ [attribute]: view }));
  });
}
for (const id of ['br-league', 'br-season']) $(id).addEventListener('change', () => savePreferences({ [id]: $(id).value }));
document.querySelectorAll('[role="tablist"], .basket-views').forEach(list => list.addEventListener('keydown', event => {
  const vertical = list.getAttribute('aria-orientation') === 'vertical' && matchMedia('(min-width: 851px)').matches;
  const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  if (![...keys, 'Home', 'End'].includes(event.key)) return;
  const buttons = [...list.querySelectorAll('button')].filter(button => !button.disabled), index = buttons.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === keys[0] ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next].click(); buttons[next].focus();
}, true));

// Restore navigation only. Research windows, forecasts and model inputs are unchanged.
const saved = readPreferences();
for (const id of ['br-league', 'br-season']) if ([...$(id).options].some(option => option.value === saved[id])) $(id).value = saved[id];
const basketView = saved['basket-view'] === 'week' ? 'individual' : saved['basket-view'];
document.querySelector(`[data-basket-view="${['prematch', 'individual', 'daily', 'calendar', 'players', 'evaluation', 'research'].includes(basketView) ? basketView : 'prematch'}"]`)?.click();
if (saved['research-view']) {
  const researchView = ['data', 'periods', 'availability', 'forecasts', 'plans'].includes(saved['research-view']) ? saved['research-view'] : 'data';
  const target = document.querySelector(`[data-research-view="${researchView}"]`);
  if (target.disabled) {
    // The archive disables its tabs while its initial request is pending.
    const restore = new MutationObserver(() => {
      if (!target.disabled && $('bb-research-view').getAttribute('aria-busy') !== 'true') { restore.disconnect(); target.click(); }
    });
    restore.observe($('bb-research-view'), { attributes: true, subtree: true, attributeFilter: ['disabled', 'aria-busy'] });
  } else target.click();
}
const initialSport = location.hash === '#footystats' ? 'football' : ['football', 'nba', 'basketball', 'tennis'].includes(saved.sport) ? saved.sport : 'basketball';
$(`sport-${initialSport}`).click();
if (initialSport === 'football' && saved['football-view'] === 'players') $('view-football-players').click();
else if (initialSport === 'football' && saved['football-view'] === 'individual') $('view-individual').click();
document.querySelector('[data-basket-view="research"]').addEventListener('click', () => savePreferences({ 'br-league': $('br-league').value, 'br-season': $('br-season').value }));
