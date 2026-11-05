import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestBudget } from './request-budget.mjs';

function setup() {
  const store = {}, quota = {}; let date = new Date('2026-10-16T16:00:00Z');
  const budget = createRequestBudget({ getStore: () => store, getQuota: () => quota, persist: async () => {}, name: 'basketball', now: () => date, sleep: async () => {} });
  return { store, quota, budget, advance: ms => { date = new Date(date.getTime() + ms); } };
}
test('paid limits require a verified subscription, reserve ten percent and prioritize player details', async () => {
  const { budget, store, quota } = setup();
  store.basketballResearch = { access: { plan: 'Pro', dailyLimit: 7500 } };
  assert.equal(budget.policy().paid, false);
  budget.verify({ subscription: { plan: 'Pro', active: true }, requests: { limit_day: 7500, current: 20 } });
  assert.equal(budget.policy().dailyBudget, 7500); assert.equal(budget.policy().usable, 6750);
  assert.equal(budget.policy().reserve, 750); assert.ok(budget.policy().playerLimit > budget.policy().teamLimit);
  quota.used = 90;
  await budget.before('games/statistics/players'); assert.equal(quota.used, 91);
  budget.reset(); assert.equal(budget.policy().paid, false);
  await assert.rejects(budget.before('games'), /Presupuesto/);
});
test('free and user budgets remain independent; no request is made beyond the preventive cap', async () => {
  const { budget, quota, store } = setup(); budget.quota();
  quota.detailUsed = 24;
  await assert.rejects(budget.before('games/statistics/players'), /detalles/);
  assert.equal(quota.used, 0);
  await budget.before('games'); assert.equal(quota.used, 1);
  store.dataControl = { budgets: { basketball: { dailyBudget: 1000 }, football: { dailyBudget: 20 } } };
  budget.verify({ subscription: { plan: 'Pro', active: true }, requests: { limit: 7500 } });
  assert.equal(budget.policy().usable, 900);
});
test('observed quota is conservative and Retry-After produces a durable cooldown', async () => {
  const { budget, quota, advance } = setup();
  await budget.observe(new Response('', { headers: { 'x-ratelimit-requests-remaining': '30' } }));
  await budget.observe(new Response('', { headers: { 'x-ratelimit-requests-remaining': '90' } }));
  assert.equal(quota.remaining, 30);
  await budget.observe(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
  await assert.rejects(budget.before('games'), error => error.code === 'provider_cooldown');
  advance(121000); await budget.before('games');
  advance(86400000); assert.equal(budget.quota().used, 0);
});
test('plan verification expires and inactive or quota-less status cannot enable Pro', () => {
  const { budget, advance } = setup();
  assert.throws(() => budget.verify({ subscription: { plan: 'Pro', active: false }, requests: { limit_day: 7500 } }));
  assert.throws(() => budget.verify({ subscription: { plan: 'Pro', active: true } }));
  budget.verify({ subscription: { plan: 'Pro', active: true }, requests: { limit_day: 7500 } });
  advance(86400001); assert.equal(budget.policy().paid, false);
});

test('expanded free usage removes only the local detail bottleneck, keeps spent requests, and stops exactly at the cap', async () => {
  const { budget, store, quota, advance } = setup(); budget.quota();
  Object.assign(quota, { used: 37, detailUsed: 24, playerUsed: 24, remaining: 63 });
  store.dataControl = { budgets: { basketball: { dailyBudget: 7500, maximizeFree: true } } };
  budget.verify({ subscription: { plan: 'Free', active: true }, requests: { limit_day: 100, current: 10 } });
  assert.equal(quota.remaining, 63, 'verification cannot restore a previously spent allowance');
  assert.equal(budget.policy().paid, false); assert.equal(budget.policy().usable, 100); assert.equal(budget.policy().reserve, 0);
  for (let i = 0; i < 63; i++) await budget.before('games/statistics/players');
  assert.equal(quota.used, 100); assert.equal(quota.detailUsed, 87); assert.equal(quota.remaining, 0);
  await assert.rejects(budget.before('games/statistics/players'), error => error.code === 'daily_budget');
  assert.equal(quota.used, 100);
  advance(86400000); await budget.before('games/statistics/teams'); assert.equal(quota.used, 1);
});

test('expanded free limits respect a smaller provider or user cap and do not alter the paid reservation', async () => {
  const { budget, store } = setup();
  store.dataControl = { budgets: { basketball: { dailyBudget: 20, maximizeFree: true } } };
  budget.verify({ subscription: { plan: 'Free', active: true }, requests: { limit_day: 50 } });
  assert.equal(budget.policy().usable, 20);
  store.dataControl.budgets.basketball.dailyBudget = 7500;
  assert.equal(budget.policy().usable, 50);
  budget.verify({ subscription: { plan: 'Pro', active: true }, requests: { limit_day: 7500 } });
  assert.equal(budget.policy().maximizeFree, false); assert.equal(budget.policy().usable, 6750);
});
