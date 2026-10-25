import { createServer, request as httpRequest } from 'node:http';
import { createCloudAccess } from './access.mjs';

export function createCloudGateway(config, { backendPort, access = createCloudAccess(config) }) {
  const fixedSecrets = new Set(['/api/key', '/api/basketball/key', '/api/footystats/key', '/api/credentials/forget', '/api/server/stop']);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, config.origin);
      if (!await access(request, response, url)) return;
      if (request.method === 'POST' && fixedSecrets.has(url.pathname)) {
        response.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'En la version alojada las claves se configuran en los secretos de Render. Se recuperan automaticamente al iniciar.' })); return;
      }
      const headers = { host: `127.0.0.1:${backendPort}` };
      for (const name of ['accept', 'content-type', 'content-length']) if (request.headers[name]) headers[name] = request.headers[name];
      if (request.headers.origin) headers.origin = `http://127.0.0.1:${backendPort}`;
      const proxy = httpRequest({ hostname: '127.0.0.1', port: backendPort, path: url.pathname + url.search, method: request.method, headers }, upstream => {
        response.statusCode = upstream.statusCode;
        response.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
        if (String(upstream.headers['content-type']).includes('text/html') && upstream.statusCode === 200 && request.method === 'GET') {
          const chunks = []; let bytes = 0;
          upstream.on('data', chunk => { bytes += chunk.length; if (bytes > 5 * 1024 * 1024) { proxy.destroy(); response.destroy(); } else chunks.push(chunk); });
          upstream.on('end', () => response.end(Buffer.concat(chunks).toString('utf8').replace('</body>', '<script type="module" src="/cloud-session.js"></script></body>')));
        } else upstream.pipe(response);
        upstream.on('error', () => response.destroy());
      });
      proxy.on('error', () => { if (!response.headersSent) { response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'El servidor de analisis no respondio.' })); } else response.destroy(); });
      request.on('aborted', () => proxy.destroy());
      request.pipe(proxy);
    } catch {
      if (!response.headersSent) { response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: 'No se pudo verificar la sesion o completar la consulta.' })); }
      else response.destroy();
    }
  });
}
