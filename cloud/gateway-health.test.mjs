import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createCloudGateway } from './gateway.mjs';

test('HTTPS health checks remain responsive while the isolated analysis loop is busy', async () => {
  const worker = new Worker(`const {parentPort}=require('node:worker_threads'); const {createServer}=require('node:http');
    const server=createServer((req,res)=>{const start=Date.now(); parentPort.postMessage({busy:true}); while(Date.now()-start<1200){} res.end('done');});
    server.listen(0,'127.0.0.1',()=>parentPort.postMessage({port:server.address().port}));`, { eval: true });
  const port = await new Promise(resolve => worker.once('message', message => resolve(message.port)));
  const gateway = createCloudGateway({ origin: 'https://test.example' }, { backendPort: port, access: async (request, response, url) => {
    if (url.pathname === '/healthz') { response.end('ok'); return false; }
    return true;
  } });
  try {
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const busy = new Promise(resolve => worker.once('message', resolve));
    const analysis = fetch(base + '/analysis'); await busy;
    const start = Date.now(), response = await fetch(base + '/healthz');
    assert.equal(await response.text(), 'ok'); assert.ok(Date.now() - start < 1000, 'health must not wait for analysis');
    assert.equal(await (await analysis).text(), 'done');
  } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); await worker.terminate(); }
});
