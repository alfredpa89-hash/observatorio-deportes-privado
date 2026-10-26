import { Worker } from 'node:worker_threads';
import { cloudConfig } from './config.mjs';
import { createCloudGateway } from './gateway.mjs';

const config = cloudConfig();
const backend = new Worker(new URL('./backend-worker.mjs', import.meta.url), { workerData: { config } });
const backendPort = await new Promise((resolve, reject) => {
  backend.once('message', message => message?.ready && Number.isInteger(message.port) ? resolve(message.port) : reject(new Error('Servidor de analisis no preparado.')));
  backend.once('error', () => reject(new Error('No se pudo iniciar el historial privado.')));
  backend.once('exit', () => reject(new Error('El servidor de analisis termino antes de estar listo.')));
});
const gateway = createCloudGateway(config, { backendPort });
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(config.port, '0.0.0.0', resolve); });
console.log('Observatorio privado listo. Acceso y almacenamiento externos configurados.');
let closing = false;
backend.on('error', () => { if (!closing) { console.error('El analisis privado se detuvo; se conserva el historial remoto.'); process.exitCode = 1; gateway.close(); gateway.closeIdleConnections(); } });
backend.on('exit', () => { if (!closing) { process.exitCode = 1; gateway.close(); gateway.closeIdleConnections(); } });
process.once('SIGTERM', () => { closing = true; gateway.close(); gateway.closeIdleConnections(); backend.postMessage('shutdown'); });
