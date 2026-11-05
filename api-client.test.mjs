import test from 'node:test';
import assert from 'node:assert/strict';
import { createJsonClient } from './public/api-client.js';

test('panels share simultaneous identical reads and never merge mutations', async () => {
  let requests = 0;
  const client = createJsonClient({ fetch: async () => { requests++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ ok: true }); } });
  await Promise.all([client('/api/state'), client('/api/state'), client('/api/state')]);
  assert.equal(requests, 1);
  await Promise.all([client('/api/action', {}), client('/api/action', {})]);
  assert.equal(requests, 3);
});

test('shared client bounds concurrent queries across different panels', async () => {
  let running = 0, maximum = 0;
  const client = createJsonClient({ concurrency: 2, fetch: async () => {
    maximum = Math.max(maximum, ++running); await new Promise(resolve => setTimeout(resolve, 5)); running--; return Response.json({});
  } });
  await Promise.all(Array.from({ length: 20 }, (_, i) => client(`/api/${i}`)));
  assert.equal(maximum, 2);
});

test('HTML wake/error pages and truncated JSON produce safe understandable errors', async () => {
  const html = createJsonClient({ fetch: async () => new Response('<!DOCTYPE html>private upstream page', { status: 502, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(html('/api/state'), error => /Conservamos la ultima lectura/.test(error.message) && !error.message.includes('<!DOCTYPE'));
  const truncated = createJsonClient({ fetch: async () => new Response('{', { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(truncated('/api/state'), /llego incompleta/);
});

test('provider access restrictions retain allowed seasons and login expiration is explicit', async () => {
  const blocked = createJsonClient({ fetch: async () => Response.json({ error: 'Temporada restringida', code: 'season_restricted', allowedSeasons: [2023] }, { status: 403 }) });
  await assert.rejects(blocked('/api/load', {}), error => error.status === 403 && error.allowedSeasons[0] === 2023);
  const login = createJsonClient({ fetch: async () => Response.json({}, { status: 401 }) });
  await assert.rejects(login('/api/state'), /sesion ha caducado/);
});

test('timeout aborts the request without retrying a potentially completed mutation', async () => {
  let requests = 0;
  const client = createJsonClient({ timeoutMs: 10, fetch: async (_, { signal }) => {
    requests++; await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  await assert.rejects(client('/api/save', {}), /No se repitio/); assert.equal(requests, 1);
});
