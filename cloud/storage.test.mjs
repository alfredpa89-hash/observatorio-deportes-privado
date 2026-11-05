import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudStorage, stateCipher, partitionState, restorePartition } from './storage.mjs';
import { cloudConfig } from './config.mjs';

const config = { supabaseUrl: 'https://example.supabase.co', bucket: 'observatorio-private', serviceKey: 'synthetic-test-key', encryptionKey: 'synthetic-test-encryption-value-at-least-32-characters' };
const state = () => ({ version: 1, leagues: { demo: { name: 'Prueba' } }, matches: Array.from({ length: 600 }, (_, id) => ({ id, points: id % 140 })), cache: {}, extra: [null, false, 0, ''] });

test('la optimizacion conserva las referencias de las particiones ya almacenadas', () => {
  const value = state(); value.leagues.demo.name = 'Prueba á中😀';
  const packed = partitionState(value, { size: 2048 });
  // Golden manifest from the original bounded serializer: no historical migration.
  assert.equal(packed.root, '96e6aad8827759c273453f0f8cdd3051280d86a901ccbe7c4d3079ca201b4188');
  const repeat = partitionState(value, { size: 2048, known: new Set(packed.blobs.keys()) });
  assert.equal(repeat.blobs.size, 0);
});
test('particiones acotadas conservan Unicode y no retienen buffers ya existentes', async () => {
  const value = { version: 1, leagues: {}, matches: Array.from({ length: 800 }, (_, id) => ({ id, note: 'á中😀'.repeat(50), missing: null })), cache: {} };
  const initial = partitionState(value, { size: 2048 });
  const known = new Set(initial.blobs.keys()), repeat = partitionState(value, { size: 2048, known });
  assert.equal(initial.root, repeat.root); assert.equal(repeat.blobs.size, 0);
  assert.deepEqual(await restorePartition(initial.tree, async id => initial.blobs.get(id)), value);
  value.matches[0].note = 'Corregido';
  const changed = partitionState(value, { size: 2048, known });
  assert.ok(changed.blobs.size > 0 && changed.blobs.size < initial.blobs.size);
  const all = new Map([...initial.blobs, ...changed.blobs]);
  assert.deepEqual(await restorePartition(changed.tree, async id => all.get(id)), value);
});
function fixture() {
  const objects = new Map(); let revision = 0, manifest = null, uploads = 0, failUpload = false;
  const fetch = async (input, options = {}) => {
    assert.equal(options.headers.apikey, config.serviceKey);
    const url = new URL(input), method = options.method || 'GET';
    if (url.pathname === '/rest/v1/observatorio_state') return Response.json([{ revision, manifest }]);
    if (url.pathname === '/rest/v1/rpc/observatorio_checkpoint') {
      const body = JSON.parse(options.body);
      if (body.expected_revision !== revision) return Response.json({ error: 'revision_conflict' }, { status: 409 });
      revision++; manifest = body.next_manifest; return Response.json(revision);
    }
    if (url.pathname.startsWith('/storage/v1/object/observatorio-private/parts/')) {
      if (method === 'GET') return objects.has(url.pathname) ? new Response(objects.get(url.pathname)) : new Response('', { status: 404 });
      uploads++;
      if (failUpload) { failUpload = false; return Response.json({ error: 'unavailable' }, { status: 503 }); }
      if (objects.has(url.pathname)) return Response.json({ error: 'Duplicate' }, { status: 400 });
      objects.set(url.pathname, Buffer.from(options.body)); return Response.json({ ok: true });
    }
    throw new Error('Unexpected mock path');
  };
  return { fetch, objects, uploads: () => uploads, fail: () => { failUpload = true; }, revision: () => revision,
    simulateWriter: () => { revision++; } };
}
test('el cifrado autentica el contenido y rechaza manipulacion o una clave distinta', () => {
  const cipher = stateCipher(config.encryptionKey), bytes = Buffer.from('historial privado');
  const sealed = cipher.seal(bytes);
  assert.deepEqual(cipher.open(sealed), bytes);
  assert.notDeepEqual(sealed, cipher.seal(bytes));
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => cipher.open(sealed));
  assert.throws(() => stateCipher('different-encryption-key-at-least-32').open(cipher.seal(bytes)));
  assert.throws(() => stateCipher('short'));
});
test('las particiones conservan listas, objetos, ceros, null y nombres especiales', async () => {
  const original = { ...state(), largeStrings: ['a'.repeat(500), 'b'.repeat(500), null, 0], special: JSON.parse('{"__proto__":{"x":1}}') };
  const packed = partitionState(original, { size: 200 });
  assert.ok(packed.blobs.size > 3);
  assert.deepEqual(await restorePartition(packed.tree, async id => packed.blobs.get(id)), original);
  assert.equal({}.x, undefined);
});
test('el historial sobrevive al reinicio; repetir el mismo guardado no consume transferencias', async () => {
  const mock = fixture(), storage = createCloudStorage(config, mock), original = state();
  assert.equal(await storage.load(), null);
  await storage.save(JSON.stringify(original));
  const uploads = mock.uploads();
  await storage.save(JSON.stringify(original));
  assert.equal(mock.uploads(), uploads);
  const restarted = createCloudStorage(config, mock);
  assert.deepEqual(await restarted.load(), original);
  assert.equal(mock.revision(), 1);
});
test('un guardado incompleto no se confirma y puede reintentarse sin perder la version anterior', async () => {
  const mock = fixture(), storage = createCloudStorage(config, mock);
  await storage.load(); mock.fail();
  await assert.rejects(storage.save(JSON.stringify(state())), /No se pudo guardar/);
  assert.equal(mock.revision(), 0);
  await storage.save(JSON.stringify(state()));
  assert.equal(mock.revision(), 1);
});

test('la restauracion acelera lecturas con un limite de 16 y conserva cuatro escrituras simultaneas', async () => {
  const mock = fixture(), active = { reads: 0, writes: 0 }, peak = { reads: 0, writes: 0 };
  const fetch = async (input, options = {}) => {
    if (!new URL(input).pathname.startsWith('/storage/v1/object/')) return mock.fetch(input, options);
    const kind = (options.method || 'GET') === 'GET' ? 'reads' : 'writes';
    active[kind]++; peak[kind] = Math.max(peak[kind], active[kind]);
    try { await new Promise(resolve => setTimeout(resolve, 5)); return await mock.fetch(input, options); }
    finally { active[kind]--; }
  };
  const original = { ...state(), matches: Array.from({ length: 4096 }, (_, id) => ({ id, points: id % 140, detail: 'x'.repeat(200) })) };
  const storage = createCloudStorage(config, { fetch });
  await storage.load(); await storage.save(original);
  assert.deepEqual(await createCloudStorage(config, { fetch }).load(), original);
  assert.ok(peak.reads > 4 && peak.reads <= 16);
  assert.equal(peak.writes, 4);
});
test('un escritor simultaneo detiene los cambios y un fragmento ausente nunca se trata como vacio', async () => {
  const mock = fixture(), storage = createCloudStorage(config, mock);
  await storage.load(); await storage.save(JSON.stringify(state()));
  mock.simulateWriter();
  await assert.rejects(storage.save(JSON.stringify({ ...state(), added: true })), /escritor simultaneo/);
  assert.equal(storage.status().conflicted, true);
  await assert.rejects(storage.save(JSON.stringify(state())), /conflicto/);
  mock.objects.clear();
  await assert.rejects(createCloudStorage(config, mock).load(), /Falta un fragmento/);
});
test('la configuracion falla cerrada ante propietario, URL o secretos ausentes', () => {
  const env = { OBSERVATORIO_PUBLIC_URL: 'https://private.example', SUPABASE_URL: config.supabaseUrl,
    OBSERVATORIO_OWNER_ID: '11111111-1111-4111-8111-111111111111', OBSERVATORIO_STORAGE_SECRET: config.encryptionKey,
    SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-service' };
  assert.equal(cloudConfig(env).origin, 'https://private.example');
  assert.throws(() => cloudConfig({ ...env, OBSERVATORIO_PUBLIC_URL: 'http://private.example' }));
  assert.throws(() => cloudConfig({ ...env, OBSERVATORIO_OWNER_ID: '*' }));
  assert.throws(() => cloudConfig({ ...env, SUPABASE_URL: 'https://evil.example' }));
  assert.throws(() => cloudConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }));
});
