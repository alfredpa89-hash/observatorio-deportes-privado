import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { SportsError } from './sports.mjs';

const compress = promisify(gzip), decompress = promisify(gunzip);
const hash = value => createHash('sha256').update(value).digest('hex');
export const frozenTrialHash = store => hash(JSON.stringify({ trial: store.basketball?.trial, inputs: store.basketball?.inputs, evaluations: store.basketball?.evaluations }));
const immutableTrialHash = store => {
  const { active, lastRun, warning, ...trial } = store.basketball?.trial || {};
  return hash(JSON.stringify({ trial, inputs: store.basketball?.inputs, evaluations: store.basketball?.evaluations }));
};
const validStore = value => value?.version === 1 && value.leagues && typeof value.leagues === 'object' && Array.isArray(value.matches);
const validId = value => typeof value === 'string' && /^\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(value);

export function createDataBackups({ directory, getStore, replaceStore, persist, now = () => new Date() }) {
  let queue = Promise.resolve();
  const exclusive = action => { const result = queue.catch(() => {}).then(action); queue = result; return result; };
  async function list() {
    await mkdir(directory, { recursive: true });
    const entries = [];
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json') || !validId(file.slice(0, -5))) continue;
      try { const meta = JSON.parse(await readFile(path.join(directory, file), 'utf8')); if (meta.id === file.slice(0, -5)) entries.push(meta); } catch { /* Incomplete metadata is not a restorable backup. */ }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function create(reason = 'manual') {
    await persist();
    const serialized = JSON.stringify(getStore());
    const createdAt = now().toISOString(), id = `${createdAt.replace(/[-:.]/g, '')}-${randomUUID()}`;
    const meta = { schema: 1, id, createdAt, reason: String(reason).slice(0, 80), checksum: hash(serialized), bytes: Buffer.byteLength(serialized), frozenHash: frozenTrialHash(getStore()) };
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${id}.json.gz`);
    await writeFile(`${target}.tmp`, await compress(serialized)); await rename(`${target}.tmp`, target);
    const metadata = path.join(directory, `${id}.json`);
    await writeFile(`${metadata}.tmp`, JSON.stringify(meta)); await rename(`${metadata}.tmp`, metadata);
    // Retain twelve complete snapshots; paths come only from validated local backup IDs.
    for (const old of (await list()).slice(12)) for (const suffix of ['.json', '.json.gz']) await unlink(path.join(directory, `${old.id}${suffix}`)).catch(() => {});
    return meta;
  }
  async function read(id) {
    if (!validId(id)) throw new SportsError(400, 'Identificador de respaldo no valido.');
    let meta, serialized;
    try {
      meta = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
      serialized = (await decompress(await readFile(path.join(directory, `${id}.json.gz`)), { maxOutputLength: 256 * 1024 * 1024 })).toString('utf8');
    } catch { throw new SportsError(400, 'Respaldo ausente o comprimido no valido.'); }
    if (meta.schema !== 1 || meta.id !== id || meta.checksum !== hash(serialized)) throw new SportsError(409, 'La integridad del respaldo no coincide. No se restaura.');
    let state; try { state = JSON.parse(serialized); } catch { throw new SportsError(400, 'Contenido del respaldo no valido.'); }
    if (!validStore(state) || state.dataControl && state.dataControl.schema !== 1 || frozenTrialHash(state) !== meta.frozenHash) throw new SportsError(409, 'Esquema o prueba congelada del respaldo no valido.');
    return { meta, state };
  }
  return { list, create: reason => exclusive(() => create(reason)),
    ensure: () => exclusive(async () => {
      const latest = (await list())[0];
      return latest && now().getTime() - Date.parse(latest.createdAt) < 6 * 3600000 ? latest : create('automatico-antes-de-actualizar');
    }),
    verify: async id => { const { meta, state } = await read(id); return { ...meta, valid: true, frozenCompatible: immutableTrialHash(state) === immutableTrialHash(getStore()) }; },
    restore: (id, confirmation) => exclusive(async () => {
      if (confirmation !== 'RESTAURAR') throw new SportsError(400, 'Confirma la restauracion con RESTAURAR.');
      const { meta, state } = await read(id);
      if (immutableTrialHash(state) !== immutableTrialHash(getStore())) throw new SportsError(409, 'Este respaldo alteraria la prueba congelada de baloncesto. Restauracion bloqueada.');
      const safety = await create('antes-de-restaurar');
      const current = getStore();
      if (state.basketball?.trial && current.basketball?.trial) for (const field of ['active', 'lastRun', 'warning']) {
        if (field in current.basketball.trial) state.basketball.trial[field] = current.basketball.trial[field];
        else delete state.basketball.trial[field];
      }
      if (current.basketball?.quota?.day === now().toISOString().slice(0, 10) && state.basketball?.quota?.day !== current.basketball.quota.day) (state.basketball ||= {}).quota = structuredClone(current.basketball.quota);
      if (current.footballQuota?.day === now().toISOString().slice(0, 10) && state.footballQuota?.day !== current.footballQuota.day) state.footballQuota = structuredClone(current.footballQuota);
      if (current.footystatsResearch?.requestUsage) (state.footystatsResearch ||= {}).requestUsage = structuredClone(current.footystatsResearch.requestUsage);
      for (const [target, previous] of [[state.basketball?.quota, current.basketball?.quota], [state.footballQuota, current.footballQuota]]) {
        if (!target || !previous || target.day !== previous.day) continue;
        for (const field of ['used', 'detailUsed', 'playerUsed', 'teamUsed']) target[field] = Math.max(target[field] || 0, previous[field] || 0);
        if (previous.remaining !== null && previous.remaining !== undefined) target.remaining = target.remaining == null ? previous.remaining : Math.min(target.remaining, previous.remaining);
        target.cooldownUntil = [target.cooldownUntil, previous.cooldownUntil].filter(Boolean).sort().at(-1) || null;
      }
      try { replaceStore(state); await persist(); } catch (error) { replaceStore(current); await persist(); throw error; }
      return { restored: meta.id, safetyBackup: safety.id, valid: true };
    }) };
}
