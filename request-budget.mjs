import { SportsError } from './sports.mjs';
import { basketballFocus } from './basketball-focus.mjs';

const positive = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const issue = (status, message, code) => Object.assign(new SportsError(status, message), { code });

// Paid capacity is session-verified, never inferred from saved account metadata or the key.
export function createRequestBudget({ getStore, getQuota, persist, name, now = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let access = null, lastRequest = 0;
  const clock = () => now().toISOString();
  const config = () => getStore().dataControl?.budgets?.[name] || {};
  function policy() {
    const verified = Boolean(access?.active && Date.parse(access.verifiedAt) > now().getTime() - 86400000 && (!access.end || Date.parse(access.end) > now().getTime()));
    const paid = verified && !/free/i.test(access.plan) && access.dailyLimit > 100;
    const ceiling = Math.min(verified ? access.dailyLimit : 100, config().dailyBudget || (paid ? 7500 : 100));
    const maximizeFree = !paid && config().maximizeFree === true;
    const reserve = maximizeFree ? 0 : paid ? Math.max(10, Math.ceil(ceiling * .10)) : Math.min(10, ceiling);
    const usable = Math.max(0, ceiling - reserve);
    const details = paid ? Math.floor(usable * 8 / 9) : maximizeFree ? usable : Math.min(24, usable);
    return { verified, paid, plan: verified ? access.plan : 'Sin verificar', providerLimit: verified ? access.dailyLimit : null,
      dailyBudget: ceiling, reserve, usable, maximizeFree, detailLimit: details, playerLimit: paid ? Math.floor(details * .75) : details,
      teamLimit: paid ? details - Math.floor(details * .75) : details,
      intervalMs: paid ? Math.max(250, Math.ceil(60000 / (access.minuteLimit || 240))) : 6500,
      ...(name === 'basketball' ? { focus: basketballFocus(now()) } : {}),
      verifiedAt: access?.verifiedAt || null, resetsAt: `${new Date(now().getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00.000Z` };
  }
  function quota() {
    const value = getQuota(), day = clock().slice(0, 10);
    if (value.day !== day) Object.assign(value, { day, used: 0, detailUsed: 0, playerUsed: 0, teamUsed: 0, remaining: null, cooldownUntil: null });
    return value;
  }
  function verify(response) {
    const subscription = response?.subscription, requests = response?.requests;
    const dailyLimit = positive(requests?.limit_day ?? requests?.limit);
    if (!subscription || typeof subscription.plan !== 'string' || subscription.active !== true || !dailyLimit) {
      access = null; throw issue(403, 'No se pudo verificar una suscripcion activa y su cuota. Se mantiene el limite gratuito.', 'unverified_plan');
    }
    access = { plan: subscription.plan.slice(0, 60), active: true, dailyLimit, minuteLimit: positive(requests?.limit_minute),
      end: Number.isFinite(Date.parse(subscription.end)) ? new Date(subscription.end).toISOString() : null, verifiedAt: clock() };
    const used = positive(requests?.current ?? requests?.current_day);
    if (used !== null) {
      const q = quota(), remaining = Math.max(0, dailyLimit - used);
      q.remaining = q.remaining === null ? remaining : Math.min(q.remaining, remaining);
    }
    return { ...access };
  }
  async function before(endpoint, params = {}) {
    const q = quota(), p = policy(), status = /\/?status$/.test(endpoint), detail = /statistics\//.test(endpoint) || /\/fixtures$/.test(endpoint) && (params.id != null || params.ids != null);
    const type = /statistics\/players/.test(endpoint) ? 'player' : /statistics\/teams/.test(endpoint) ? 'team' : null;
    if (Date.parse(q.cooldownUntil) > now().getTime()) throw issue(429, `Proveedor en pausa hasta ${q.cooldownUntil}; se conserva lo guardado.`, 'provider_cooldown');
    if (q.remaining === 0 || q.used >= (status ? p.dailyBudget : p.usable) || !status && q.remaining !== null && q.remaining <= p.reserve) throw issue(429, 'Presupuesto preventivo alcanzado. Se reservan consultas y se conserva el historial.', 'daily_budget');
    if (!status && detail && (q.detailUsed || 0) >= p.detailLimit || type && (q[`${type}Used`] || 0) >= p[`${type}Limit`]) throw issue(429, 'Presupuesto de detalles completo. La carga continuara con la siguiente cuota UTC.', 'detail_budget');
    const delay = Math.max(0, p.intervalMs - (Date.now() - lastRequest));
    if (delay) await sleep(delay);
    q.used = (q.used || 0) + 1;
    if (detail) q.detailUsed = (q.detailUsed || 0) + 1;
    if (type) q[`${type}Used`] = (q[`${type}Used`] || 0) + 1;
    if (q.remaining !== null) q.remaining = Math.max(0, q.remaining - 1);
    lastRequest = Date.now();
    await persist();
  }
  async function observe(response) {
    const q = quota(), remaining = positive(response.headers.get('x-ratelimit-requests-remaining'));
    if (remaining !== null) q.remaining = q.remaining === null ? remaining : Math.min(q.remaining, remaining);
    if (response.status === 429 || response.status >= 500) {
      const retry = response.headers.get('retry-after'), seconds = positive(retry);
      const target = seconds !== null ? now().getTime() + seconds * 1000 : Date.parse(retry);
      q.cooldownUntil = new Date(Math.max(now().getTime() + 60000, Number.isFinite(target) ? target : now().getTime() + 5 * 60000)).toISOString();
    }
    await persist();
  }
  return { policy, quota, before, observe, verify, reset: () => { access = null; }, access: () => access && { ...access } };
}
