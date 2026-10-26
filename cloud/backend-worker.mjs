import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCloudStorage } from './storage.mjs';

// Keep expensive historical analysis away from the HTTPS health/auth event loop.
process.env.PORT = '0';
process.env.OBSERVATORIO_DISABLE_SCHEDULER = '1';
process.env.OBSERVATORIO_DISABLE_CREDENTIALS = '1';
process.env.OBSERVATORIO_DATA_DIR = path.join(tmpdir(), 'observatorio-private-cache');
const values = { football: process.env.API_FOOTBALL_KEY, basketball: process.env.API_BASKETBALL_KEY, footystats: process.env.FOOTYSTATS_KEY };
const vaultState = () => ({ supported: false, available: false, protection: 'Secretos del servidor / Render',
  saved: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Boolean(value)])), error: null });
const vault = { state: vaultState, check: async () => vaultState(), load: async () => values,
  save: async () => { throw new Error('Configura las claves en los secretos del servidor.'); } };
const { startServer } = await import('../server.mjs');
const backend = await startServer({ storage: createCloudStorage(workerData.config), vault });
parentPort.postMessage({ ready: true, port: backend.address().port });
parentPort.on('message', message => {
  if (message === 'shutdown') { backend.close(() => process.exit(0)); backend.closeIdleConnections(); }
});
