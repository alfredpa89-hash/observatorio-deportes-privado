import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:4173';

export async function probeLocalServer({ request = fetch, root = ROOT } = {}) {
  let response;
  try { response = await request(`${BASE}/api/state`, { signal: AbortSignal.timeout(4000), redirect: 'error' }); }
  catch (error) { return { status: error?.name === 'TimeoutError' ? 'unresponsive' : 'offline' }; }
  if (!response.ok) { await response.body?.cancel(); return { status: 'foreign' }; }
  let state; try { state = await response.json(); } catch { return { status: 'foreign' }; }
  return state.app === 'observatorio-futbol' && String(state.appDirectory).toLowerCase() === root.toLowerCase() ? { status: 'ready' } : { status: 'foreign' };
}

export function createLocalSupervisor({ probe, launch, record, now = () => Date.now() }) {
  let child = null, nextAttempt = 0, failures = 0, checking = false;
  async function step() {
    if (checking) return;
    checking = true;
    try {
      const state = await probe(), at = new Date(now()).toISOString();
      if (state.status === 'ready') { failures = 0; await record({ status: 'running', at }); return; }
      if (state.status === 'foreign' || state.status === 'unresponsive') { await record({ status: state.status, at }); return; }
      if (child && child.exitCode === null && child.signalCode === null) { await record({ status: 'starting', at }); return; }
      if (now() < nextAttempt) { await record({ status: 'waiting', at, nextAttempt: new Date(nextAttempt).toISOString() }); return; }
      failures++;
      nextAttempt = now() + Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4));
      try { child = await launch(); await record({ status: 'starting', at }); }
      catch { child = null; await record({ status: 'launch_failed', at, nextAttempt: new Date(nextAttempt).toISOString() }); }
    } finally { checking = false; }
  }
  return { step };
}

export async function runLocalServer() {
  if (process.platform !== 'win32') throw new Error('Este inicio automatico es para Windows.');
  const { stdout } = await promisify(execFile)('whoami.exe', [], { windowsHide: true, timeout: 5000 });
  const account = stdout.trim().split('\\').at(-1);
  if (!account || /codexsandbox/i.test(account) || account.toLowerCase() !== String(process.env.USERNAME).toLowerCase()) {
    throw new Error('Abre Activar-inicio-automatico.cmd desde tu sesion normal de Windows; no desde el agente.');
  }
  if (process.argv.includes('--background')) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); return;
  }
  const id = createHash('sha256').update(`${ROOT.toLowerCase()}:${account.toLowerCase()}`).digest('hex').slice(0, 20);
  const lock = createServer(socket => socket.destroy());
  const acquired = await new Promise((resolve, reject) => {
    lock.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    lock.listen(`\\\\.\\pipe\\observatorio-local-${id}`, () => resolve(true));
  });
  if (!acquired) return;
  const directory = path.join(ROOT, 'data'); await mkdir(directory, { recursive: true });
  const record = async state => {
    const target = path.join(directory, 'local-server-status.json');
    await writeFile(`${target}.tmp`, JSON.stringify({ ...state, account, pid: process.pid }));
    await rename(`${target}.tmp`, target);
  };
  const supervisor = createLocalSupervisor({ probe: () => probeLocalServer(), record, launch: async () => {
    const output = await open(path.join(directory, 'server.stdout.log'), 'a');
    let errors;
    try {
      errors = await open(path.join(directory, 'server.stderr.log'), 'a');
      const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, windowsHide: true,
        env: { ...process.env, PORT: '4173', OBSERVATORIO_DATA_DIR: directory }, stdio: ['ignore', output.fd, errors.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      return child;
    } finally { await output.close(); await errors?.close(); }
  } });
  const check = () => supervisor.step().catch(() => {});
  await check();
  const timer = setInterval(check, 30000);
  const stop = () => { clearInterval(timer); lock.close(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runLocalServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
