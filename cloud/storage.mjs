import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const digest = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const failure = message => Object.assign(new Error(message), { status: 503, code: 'storage_unavailable' });

export function stateCipher(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw failure('Falta un secreto de almacenamiento fuerte.');
  const key = createHash('sha256').update(`observatorio-storage-v1\0${secret}`).digest();
  const aad = Buffer.from('observatorio-private-state:v1');
  return {
    seal(bytes) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad);
      const content = Buffer.concat([cipher.update(gzipSync(bytes, { level: 3 })), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), content]);
    },
    open(bytes) {
      if (bytes.length < 29) throw failure('Fragmento de historial incompleto.');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
      return gunzipSync(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]), { maxOutputLength: 16 * 1024 * 1024 });
    },
  };
}

// Las piezas inmutables evitan reenviar los 50 MB del historial por cada cambio pequeno.
export function partitionState(value, { size = 192 * 1024, known = new Set() } = {}) {
  const blobs = new Map();
  const leaf = bytes => { const id = digest(bytes); if (!known.has(id)) blobs.set(id, bytes); return { type: 'ref', id }; };
  const oversized = {}, keyCosts = new Map();
  const keyCost = key => { if (!keyCosts.has(key)) keyCosts.set(key, Buffer.byteLength(JSON.stringify(key)) + 2); return keyCosts.get(key); };
  function boundedJson(item) {
    let remaining = size;
    const ancestors = new Set();
    function visitBudget(child, name = '') {
      if (child !== null && typeof child === 'object' && typeof child.toJSON === 'function') child = child.toJSON(name);
      if (name) remaining -= keyCost(name);
      if (child !== null && typeof child === 'object') {
        remaining -= 2;
        if (remaining < 0) throw oversized;
        if (ancestors.has(child)) throw new TypeError('Circular state cannot be stored.');
        ancestors.add(child);
        if (Array.isArray(child)) for (let index = 0; index < child.length; index++) visitBudget(child[index], String(index));
        else for (const key of Object.keys(child)) visitBudget(child[key], key);
        ancestors.delete(child);
      } else {
        remaining -= typeof child === 'number' ? (Number.isFinite(child) ? String(child).length : 4) :
          typeof child === 'boolean' ? (child ? 4 : 5) : Buffer.byteLength(JSON.stringify(child) ?? 'null');
        if (remaining < 0) throw oversized;
      }
    }
    try {
      // Keep the existing partition boundaries, but count repeated field names
      // once and serialize a fitting piece natively, without a per-field replacer.
      visitBudget(item);
      return JSON.stringify(item);
    } catch (error) { if (error !== oversized) throw error; return null; }
  }
  function visit(item, forceObject = false) {
    if (Array.isArray(item) && item.length > 128) {
      const children = []; for (let index = 0; index < item.length; index += 128) children.push(visit(item.slice(index, index + 128)));
      return { type: 'concat', children };
    }
    if (!forceObject) {
      let serialized = boundedJson(item);
      if (serialized !== null) return leaf(Buffer.from(serialized));
      if (item === null || typeof item !== 'object') return leaf(Buffer.from(JSON.stringify(item)));
      serialized = null;
    }
    if (Array.isArray(item)) {
      return { type: 'array', children: item.map(child => visit(child)) };
    }
    const entries = Object.entries(item);
    if (entries.length > 16) {
      const children = []; for (let index = 0; index < entries.length; index += 16) children.push(visit(Object.fromEntries(entries.slice(index, index + 16))));
      return { type: 'merge', children };
    }
    if (entries.length > 1) {
      const middle = Math.ceil(entries.length / 2);
      return { type: 'merge', children: [visit(Object.fromEntries(entries.slice(0, middle))), visit(Object.fromEntries(entries.slice(middle)))] };
    }
    return { type: 'object', entries: entries.map(([name, child]) => [name, visit(child)]) };
  }
  const tree = visit(value, value !== null && typeof value === 'object' && !Array.isArray(value)), root = leaf(Buffer.from(JSON.stringify({ version: 1, tree }))).id;
  return { tree, root, blobs };
}

export async function restorePartition(tree, read, depth = 0) {
  if (depth > 80 || !tree || typeof tree !== 'object') throw failure('Estructura de historial no valida.');
  if (tree.type === 'ref' && validHash(tree.id)) return JSON.parse((await read(tree.id)).toString('utf8'));
  if (['array', 'concat', 'merge'].includes(tree.type) && Array.isArray(tree.children)) {
    const values = await Promise.all(tree.children.map(child => restorePartition(child, read, depth + 1)));
    if (tree.type === 'merge') {
      if (values.some(value => value === null || typeof value !== 'object' || Array.isArray(value))) throw failure('Fragmentos de objeto no validos.');
      return Object.fromEntries(values.flatMap(value => Object.entries(value)));
    }
    if (tree.type === 'concat' && values.some(value => !Array.isArray(value))) throw failure('Fragmentos de lista no validos.');
    return tree.type === 'concat' ? values.flat() : values;
  }
  if (tree.type === 'object' && Array.isArray(tree.entries)) {
    return Object.fromEntries(await Promise.all(tree.entries.map(async ([name, child]) => {
      if (typeof name !== 'string') throw failure('Clave de historial no valida.');
      return [name, await restorePartition(child, read, depth + 1)];
    })));
  }
  throw failure('Fragmento de historial no reconocido.');
}

function limited(limit = 4) {
  let running = 0; const waiting = [];
  return async task => {
    if (running >= limit) await new Promise(resolve => waiting.push(resolve));
    running++;
    try { return await task(); } finally { running--; waiting.shift()?.(); }
  };
}

export function createCloudStorage(config, { fetch: request = globalThis.fetch } = {}) {
  const cipher = stateCipher(config.encryptionKey), transfer = limited(), download = limited(16);
  const headers = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };
  const known = new Set(); let revision = null, conflicted = false, committedRoot = null;
  let lastSaved = null;
  const endpoint = path => `${config.supabaseUrl}${path}`;
  async function call(path, options = {}) {
    try { return await request(endpoint(path), { ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw failure('No se pudo conectar con el almacenamiento privado. Se conserva la copia anterior.'); }
  }
  const object = id => `/storage/v1/object/${config.bucket}/parts/${id}.bin`;
  async function readBlob(id) {
    if (!validHash(id)) throw failure('Identificador de historial no valido.');
    return download(async () => {
      const response = await call(object(id));
      if (!response.ok) throw failure('Falta un fragmento del historial privado. No se iniciara con datos vacios.');
      const bytes = cipher.open(Buffer.from(await response.arrayBuffer()));
      if (digest(bytes) !== id) throw failure('Fallo de integridad del historial.');
      known.add(id); return bytes;
    });
  }
  async function load() {
    const response = await call('/rest/v1/observatorio_state?id=eq.main&select=revision,manifest');
    if (!response.ok) throw failure('El esquema privado de Supabase no esta preparado.');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(rows[0].revision)) throw failure('No se encontro el registro del historial privado.');
    revision = rows[0].revision;
    if (rows[0].manifest === null) return null;
    if (rows[0].manifest?.version !== 1 || !validHash(rows[0].manifest?.root)) throw failure('Indice de historial no valido.');
    committedRoot = rows[0].manifest.root;
    const root = JSON.parse((await readBlob(rows[0].manifest.root)).toString('utf8'));
    if (root.version !== 1) throw failure('Version de historial no compatible.');
    const cache = new Map();
    const read = id => { if (!cache.has(id)) cache.set(id, readBlob(id)); return cache.get(id); };
    const restored = await restorePartition(root.tree, read);
    if (restored?.version !== 1 || !restored.leagues || !Array.isArray(restored.matches)) throw failure('Historial restaurado no valido.');
    return restored;
  }
  async function save(serialized) {
    if (revision === null || conflicted) throw failure('Almacenamiento no inicializado o con conflicto. Reinicia antes de actualizar.');
    const snapshot = typeof serialized === 'string' ? JSON.parse(serialized) : serialized, parts = partitionState(snapshot, { known });
    if (parts.root === committedRoot) return;
    const uploads = await Promise.allSettled([...parts.blobs].filter(([id]) => !known.has(id)).map(([id, bytes]) => transfer(async () => {
      const response = await call(object(id), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }, body: cipher.seal(bytes) });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (!([400, 409].includes(response.status) && error?.error === 'Duplicate')) throw failure('No se pudo guardar el historial privado; la version anterior se mantiene.');
      }
      known.add(id);
    })));
    const failed = uploads.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const response = await call('/rest/v1/rpc/observatorio_checkpoint', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: revision, next_manifest: { version: 1, root: parts.root } }) });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const reason = detail?.message === 'revision_conflict' || detail?.error === 'revision_conflict' ? 'conflicto de revision' : `respuesta HTTP ${response.status}`;
      conflicted = true;
      throw failure(`No se confirmo el historial: posible escritor simultaneo (${reason}). Se detienen los guardados hasta reiniciar.`);
    }
    const next = await response.json();
    if (next !== revision + 1) { conflicted = true; throw failure('Revision de historial inesperada.'); }
    revision = next; committedRoot = parts.root; lastSaved = new Date().toISOString();
  }
  return { load, save, status: () => ({ revision, conflicted, lastSaved }) };
}
