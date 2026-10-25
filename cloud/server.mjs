import path from 'node:path';
import { tmpdir } from 'node:os';
import { cloudConfig } from './config.mjs';
import { createCloudStorage } from './storage.mjs';
import { createCloudGateway } from './gateway.mjs';

const config = cloudConfig();
const remote = createCloudStorage(config);
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
const backend = await startServer({ storage: remote, vault });
const gateway = createCloudGateway(config, { backendPort: backend.address().port });
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(config.port, '0.0.0.0', resolve); });
console.log('Observatorio privado listo. Acceso y almacenamiento externos configurados.');
process.once('SIGTERM', () => { gateway.close(); gateway.closeIdleConnections(); backend.close(); backend.closeIdleConnections(); });
