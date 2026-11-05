import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(root, '.test-tmp');

test('el servidor existente usa la persistencia externa sin escribir un historial local alternativo', async () => {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'cloud-core-'));
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = directory;
  process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1'; process.env.API_FOOTBALL_KEY = ''; process.env.API_BASKETBALL_KEY = '';
  const saved = []; let fail = false, server;
  const storage = { load: async () => ({ version: 1, leagues: {}, matches: [], cache: {}, cloudMarker: 'preserved' }),
    save: async value => { if (fail) throw Object.assign(new Error('synthetic remote persistence error'), fail === 'typed' ? { status: 503, code: 'storage_unavailable' } : {}); saved.push(JSON.parse(JSON.stringify(value))); } };
  try {
    const { startServer } = await import('../server.mjs?cloud-storage-integration');
    server = await startServer({ storage });
    const base = `http://127.0.0.1:${server.address().port}`;
    const csv = 'Date,HomeTeam,AwayTeam,FTHG,FTAG\n01/09/25,Prueba A,Prueba B,2,1';
    const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv, leagueName: 'Prueba sintetica', season: '2025/2026' }) });
    assert.equal(response.status, 200);
    assert.equal(saved.at(-1).cloudMarker, 'preserved');
    assert.equal(saved.at(-1).matches.length, 1);
    await assert.rejects(fs.stat(path.join(directory, 'state.json')), { code: 'ENOENT' });
    const count = saved.length; fail = true;
    const failed = await fetch(base + '/api/import', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv, leagueName: 'Otra prueba', season: '2025/2026' }) });
    assert.equal(failed.status, 500); assert.equal(saved.length, count);
    fail = 'typed';
    const unavailable = await fetch(base + '/api/import', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv, leagueName: 'Persistencia no disponible', season: '2025/2026' }) });
    assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, 'storage_unavailable');
    assert.equal(saved.length, count);
  } finally {
    if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
    if (!path.resolve(directory).startsWith(path.resolve(temporaryRoot) + path.sep)) throw new Error('Invalid temporary directory');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('un fallo al leer Supabase impide arrancar y no recupera silenciosamente otro archivo local', async () => {
  process.env.PORT = '0'; process.env.OBSERVATORIO_DATA_DIR = path.join(temporaryRoot, 'cloud-unavailable');
  const { startServer } = await import('../server.mjs?cloud-storage-unavailable');
  let writes = 0;
  await assert.rejects(startServer({ storage: { load: async () => { throw new Error('synthetic storage unavailable'); }, save: async () => { writes++; } } }), /storage unavailable/);
  assert.equal(writes, 0);
});
