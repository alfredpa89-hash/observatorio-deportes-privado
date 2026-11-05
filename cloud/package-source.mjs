import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'cloud/source', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(target, { recursive: true });
let files = 0;
async function copy(relative) {
  const source = path.join(root, relative), destination = path.join(target, relative), info = await fs.lstat(source);
  if (info.isSymbolicLink()) throw new Error('No se empaquetan enlaces simbolicos.');
  if (info.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(source)) await copy(path.join(relative, entry));
  } else {
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(source, destination); files++;
  }
}
// Include review and local-start files, while keeping history and secrets outside the copy.
for (const name of await fs.readdir(root)) {
  if (/\.(?:mjs|md)$/.test(name)) await copy(name);
}
for (const name of ['Abrir.cmd', 'Abrir.ps1', 'Reiniciar.cmd', 'Activar-inicio-automatico.cmd', 'plantilla.csv']) await copy(name);
await copy('public');
await copy('research/euroleague-2026-10-11.json');
await copy('research/resumen-nba.test.mjs');
for (const name of ['render.yaml', '.gitignore']) await copy(name);
for (const name of await fs.readdir(path.join(root, 'cloud'))) {
  if (/\.(?:mjs|md)$/.test(name) || ['package.json', 'pnpm-lock.yaml', 'supabase.sql'].includes(name)) await copy(path.join('cloud', name));
}
console.log(JSON.stringify({ directory: target, files, includesHistory: false, includesCredentials: false }));
