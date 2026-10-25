import { execFile, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)), BASE = 'http://127.0.0.1:4173';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function startupCommand(node, root) {
  if ([node, root].some(value => /["\r\n]/.test(value))) throw new Error('Ruta no valida para el inicio automatico.');
  const literal = value => value.replaceAll('%', '%%');
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${literal(node)}" "${literal(path.join(root, 'local-server.mjs'))}" --background\r\n`;
}
async function local(route, body) {
  const response = await fetch(BASE + route, { redirect: 'error', signal: AbortSignal.timeout(body ? 120000 : 5000),
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo completar la configuracion local.');
  return result;
}
export async function configureLocalServer() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 24) throw new Error('Se necesita Windows y Node.js 24 o posterior.');
  const identity = await promisify(execFile)('whoami.exe', [], { windowsHide: true, timeout: 5000 });
  const account = identity.stdout.trim().split('\\').at(-1);
  if (!account || /codexsandbox/i.test(account) || account.toLowerCase() !== String(process.env.USERNAME).toLowerCase()) {
    throw new Error('Abre Activar-inicio-automatico.cmd con doble clic desde el Explorador de Windows, no desde el agente.');
  }
  const directory = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'Observatorio-Deportes.cmd'), startupCommand(process.execPath, ROOT));
  console.log('Inicio automatico instalado para tu usuario. La app seguira siendo privada en este equipo.');
  let existing;
  try { existing = await local('/api/state'); }
  catch (error) { if (!['ECONNREFUSED', 'ENOTFOUND'].includes(error.cause?.code)) throw error; }
  if (existing) {
    if (existing.app !== 'observatorio-futbol' || String(existing.appDirectory).toLowerCase() !== ROOT.toLowerCase()) throw new Error('El puerto pertenece a otra aplicacion. No se ha detenido.');
    console.log('Este primer cambio reinicia el servidor. Las claves que nunca se guardaron cifradas tendran que registrarse una vez en tu sesion.');
    const input = createInterface({ input: stdin, output: stdout });
    let answer; try { answer = await input.question('Continuar ahora? Escribe SI: '); } finally { input.close(); }
    if (answer !== 'SI') { console.log('Servidor actual conservado. El inicio automatico se aplicara en tu siguiente sesion de Windows.'); return; }
    await local('/api/data/pause', {});
    await local('/api/server/stop', {});
    let closed = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try { await local('/api/state'); }
      catch (error) { if (error.cause?.code === 'ECONNREFUSED') { closed = true; break; } throw error; }
    }
    if (!closed) throw new Error('El servidor anterior no termino. No se ha forzado su cierre.');
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'local-server.mjs'), '--background'], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  let ready;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try { ready = await local('/api/state'); break; } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
  }
  if (!ready) throw new Error('No se confirmo el inicio del servidor. Revisa data/local-server-status.json.');
  const credentials = await local('/api/credentials/state');
  if (!credentials.available) throw new Error('Servidor activo, pero Windows aun no permite guardar claves cifradas. No se ha guardado ninguna en texto plano.');
  console.log('Cifrado de Windows disponible. Conecta una vez las claves sin copia guardada; despues se recuperaran automaticamente.');
  await promisify(execFile)('cmd.exe', ['/c', 'start', '', BASE], { windowsHide: true });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  configureLocalServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
