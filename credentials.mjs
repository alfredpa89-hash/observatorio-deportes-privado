import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';

export const CREDENTIAL_PROVIDERS = ['football', 'basketball', 'footystats'];
const failure = () => new SportsError(503, 'Windows no permitio usar el almacen cifrado. Abre Activar-inicio-automatico.cmd desde tu sesion de Windows. No se guardan claves en texto plano.');
const script = `$ErrorActionPreference='Stop'
try {
  $request=$input | ConvertFrom-Json
  if ($request.operation -eq 'protect') {
    $request.value | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  } elseif ($request.operation -eq 'unprotect') {
    $request.value | ConvertTo-SecureString | ConvertFrom-SecureString -AsPlainText
  } else { throw 'invalid_operation' }
} catch { exit 1 }`;

// Secrets travel only through child-process pipes, never command arguments, logs or temporary plaintext files.
export function windowsProtect(operation, bytes) {
  return new Promise((resolve, reject) => {
    const bundled = path.resolve(path.dirname(process.execPath), '../../native/powershell/pwsh.exe');
    const child = spawn(existsSync(bundled) ? bundled : 'pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); reject(failure()); }, 20000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) { failed = true; child.kill(); } });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(failure()); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0 || !output.trim() || operation === 'protect' && !/^[a-f0-9]+$/i.test(output.trim())) return reject(failure());
      resolve(Buffer.from(output.trim(), 'utf8'));
    });
    child.stdin.end(JSON.stringify({ operation, value: bytes.toString('utf8') }) + '\n');
  });
}

export function defaultCredentialFile(root) {
  if (!process.env.LOCALAPPDATA) return null;
  const id = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(process.env.LOCALAPPDATA, 'ObservatorioDeportes', `credentials-${id}.dpapi`);
}

export function createCredentialVault({ file, enabled = true, platform = process.platform, protect = windowsProtect } = {}) {
  const supported = Boolean(enabled && platform === 'win32' && file);
  let values = {}, loaded = false, error = null, available = null, queue = Promise.resolve();
  const state = () => ({ supported, available: supported && available === true, protection: supported ? 'Windows DPAPI / usuario actual' : 'Solo memoria',
    saved: Object.fromEntries(CREDENTIAL_PROVIDERS.map(provider => [provider, Boolean(values[provider])])), error });
  async function load() {
    if (loaded || !supported) return { ...values };
    let encrypted;
    try { encrypted = await readFile(file); } catch (issue) { if (issue.code === 'ENOENT') { loaded = true; return {}; } error = failure().message; throw failure(); }
    try {
      if (encrypted.length > 65536) throw failure();
      const envelope = JSON.parse(encrypted.toString('utf8'));
      if (envelope.schema !== 1 || envelope.protection !== 'dpapi-current-user' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.data)) throw failure();
      const plain = await protect('unprotect', Buffer.from(envelope.data, 'base64'));
      let restored; try { restored = JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
      if (!restored || Array.isArray(restored) || typeof restored !== 'object' || Object.keys(restored).some(provider => !CREDENTIAL_PROVIDERS.includes(provider) || typeof restored[provider] !== 'string' || !/^[A-Za-z0-9._-]{7,200}$/.test(restored[provider]))) throw failure();
      values = restored; loaded = true; error = null; return { ...values };
    } catch { error = failure().message; throw failure(); }
  }
  function save(provider, value) {
    const action = queue.catch(() => {}).then(async () => {
      if (!CREDENTIAL_PROVIDERS.includes(provider)) throw new SportsError(400, 'Proveedor de clave no valido.');
      if (!supported) throw failure();
      await load();
      const next = { ...values };
      if (value) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{7,200}$/.test(value)) throw new SportsError(400, 'Formato de clave no valido.');
        next[provider] = value;
      } else delete next[provider];
      if ((values[provider] || null) === (next[provider] || null)) return state();
      const plain = Buffer.from(JSON.stringify(next), 'utf8');
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const encrypted = await protect('protect', plain);
        const envelope = JSON.stringify({ schema: 1, protection: 'dpapi-current-user', data: encrypted.toString('base64') });
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, envelope, { mode: 0o600 }); await rename(temporary, file);
        values = next; error = null; available = true;
      } catch { error = failure().message; throw failure(); }
      finally { plain.fill(0); await unlink(temporary).catch(() => {}); }
      return state();
    });
    queue = action; return action;
  }
  async function check() {
    if (!supported) return state();
    try {
      const probe = Buffer.from('observatorio-credential-storage-probe');
      const decrypted = await protect('unprotect', await protect('protect', probe));
      if (!decrypted.equals(probe)) throw failure();
      decrypted.fill(0); available = true;
    } catch { available = false; error = failure().message; }
    return state();
  }
  return { state, load, save, check };
}
