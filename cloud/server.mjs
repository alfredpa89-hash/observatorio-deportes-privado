import { Worker } from 'node:worker_threads';
import { cloudConfig } from './config.mjs';
import { createCloudGateway } from './gateway.mjs';
import { superviseBackend } from './runtime.mjs';

const config = cloudConfig();
const backend = new Worker(new URL('./backend-worker.mjs', import.meta.url), { workerData: { config } });
const backendPort = await new Promise((resolve, reject) => {
  backend.once('message', message => message?.ready && Number.isInteger(message.port) ? resolve(message.port) : reject(new Error('Servidor de analisis no preparado.')));
  backend.once('error', () => reject(new Error('No se pudo iniciar el historial privado.')));
  backend.once('exit', () => reject(new Error('El servidor de analisis termino antes de estar listo.')));
});
let lifecycle;
const gateway = createCloudGateway(config, { backendPort, isReady: () => lifecycle?.ready !== false });
lifecycle = superviseBackend(backend, gateway);
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(config.port, '0.0.0.0', resolve); });
console.log('Observatorio privado listo. Acceso y almacenamiento externos configurados.');
process.once('SIGTERM', () => lifecycle.shutdown());
