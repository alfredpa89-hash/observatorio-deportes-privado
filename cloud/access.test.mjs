import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createCloudAccess } from './access.mjs';
import { createCloudGateway } from './gateway.mjs';

const config = { origin: 'https://private.example', supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-public', owner: '11111111-1111-4111-8111-111111111111' };
function clientFactory(url, key, options) {
  assert.equal(url, config.supabaseUrl); assert.equal(key, config.publishableKey);
  return { auth: {
    async signInWithPassword({ email, password }) {
      if (password !== 'synthetic-test-password') return { error: { message: 'invalid' } };
      options.cookies.setAll([{ name: '__Host-observatorio-auth', value: 'good', options: { path: '/', maxAge: 3600 } }]);
      return { data: { user: { id: email === 'owner@example.invalid' ? config.owner : 'someone-else' } } };
    },
    async getUser() {
      const value = options.cookies.getAll().find(cookie => cookie.name === '__Host-observatorio-auth')?.value;
      return value === 'good' ? { data: { user: { id: config.owner } } } : { error: { message: 'forged' } };
    },
    async signOut() { options.cookies.setAll([{ name: '__Host-observatorio-auth', value: '', options: { path: '/', maxAge: 0 } }]); return {}; },
  } };
}
async function start(accessOptions = { createClient: clientFactory }) {
  let forwarded = 0, lastHeaders;
  const backend = createServer((req, res) => {
    forwarded++; lastHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': req.url.endsWith('.json') ? 'application/json' : 'text/html' });
    res.end(req.url.endsWith('.json') ? '{"private":true}' : '<html><body>Analisis privado</body></html>');
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const gateway = createCloudGateway(config, { backendPort: backend.address().port, access: createCloudAccess(config, accessOptions) });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const send = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: gateway.address().port, path, method,
      headers: { host: 'private.example', 'x-forwarded-proto': 'https', ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }); req.on('error', reject); req.end(body);
  });
  return { send, forwarded: () => forwarded, headers: () => lastHeaders,
    close: async () => { await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => backend.close(resolve))]); } };
}
test('sin sesion no se exponen paginas, estadisticas, archivos ni fuentes', async () => {
  const app = await start();
  try {
    for (const path of ['/', '/resumen-2026-10-21.json', '/vendor/example.js']) assert.equal((await app.send(path)).status, 303);
    assert.equal((await app.send('/api/state')).status, 401);
    assert.equal(app.forwarded(), 0);
    assert.equal((await app.send('/healthz')).status, 200);
    const login = await app.send('/auth/login?next=//evil.example');
    assert.equal(login.status, 200); assert.match(login.body, /type="password"/); assert.match(login.body, /name="next" value="\/"/);
    assert.equal(login.headers['referrer-policy'], 'same-origin');
  } finally { await app.close(); }
});

test('same-session concurrent reads share an in-flight check, keep renewed cookies and never cache later authorization', async () => {
  let checks = 0, allow = true;
  const app = await start({ createClient: (url, key, options) => ({ auth: {
    async getUser() {
      checks++; await new Promise(resolve => setTimeout(resolve, 30));
      options.cookies.setAll([{ name: '__Host-observatorio-auth', value: 'renewed-synthetic', options: { path: '/', maxAge: 3600 } }]);
      return allow ? { data: { user: { id: config.owner } } } : { error: { message: 'revoked' } };
    },
  } }) });
  try {
    const options = { headers: { cookie: '__Host-observatorio-auth=good' } };
    const responses = await Promise.all(['/one.js', '/two.css', '/api/example.json'].map(path => app.send(path, options)));
    assert.equal(checks, 1);
    for (const response of responses) { assert.equal(response.status, 200); assert.match(response.headers['set-cookie'][0], /renewed-synthetic/); }
    allow = false;
    assert.equal((await app.send('/api/example.json', options)).status, 401); assert.equal(checks, 2);
  } finally { await app.close(); }
});

test('concurrent different cookies never share identity verification', async () => {
  let checks = 0;
  const app = await start({ createClient: (url, key, options) => ({ auth: {
    async getUser() { checks++; await new Promise(resolve => setTimeout(resolve, 10)); return clientFactory(url, key, options).auth.getUser(); },
  } }) });
  try {
    const responses = await Promise.all(['good', 'forged'].map(value => app.send('/api/state', { headers: { cookie: `__Host-observatorio-auth=${value}` } })));
    assert.deepEqual(responses.map(row => row.status), [200, 401]); assert.equal(checks, 2);
  } finally { await app.close(); }
});
test('solo el propietario entra; cookies HttpOnly/Secure, sin redireccion externa', async () => {
  const app = await start();
  const login = email => app.send('/auth/login', { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: 'synthetic-test-password', next: '//evil.example' }).toString() });
  try {
    const other = await login('other@example.invalid'); assert.equal(other.status, 401); assert.equal(other.headers['set-cookie'], undefined);
    const owner = await login('owner@example.invalid'); assert.equal(owner.status, 303); assert.equal(owner.headers.location, '/');
    assert.match(owner.headers['set-cookie'][0], /HttpOnly/); assert.match(owner.headers['set-cookie'][0], /Secure/);
    assert.match(owner.headers['set-cookie'][0], /SameSite=Lax/); assert.match(owner.headers['cache-control'], /no-store/);
    assert.equal((await app.send('/api/state', { headers: { cookie: '__Host-observatorio-auth=forged' } })).status, 401);
  } finally { await app.close(); }
});
test('origen ajeno, host falso y HTTP no acceden; las claves y cookies no pasan al servidor interior', async () => {
  const app = await start(), cookie = '__Host-observatorio-auth=good';
  try {
    assert.equal((await app.send('/', { headers: { host: 'evil.example', cookie } })).status, 403);
    assert.equal((await app.send('/', { headers: { 'x-forwarded-proto': 'http', cookie } })).status, 403);
    assert.equal((await app.send('/api/report', { method: 'POST', headers: { origin: 'https://evil.example', cookie } })).status, 403);
    for (const origin of [undefined, 'null', 'https://private.example.evil.example']) {
      assert.equal((await app.send('/auth/login', { method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=synthetic&password=synthetic' })).status, 403);
    }
    const result = await app.send('/', { headers: { cookie, authorization: 'Bearer synthetic-secret' } });
    assert.equal(result.status, 200); assert.match(result.body, /cloud-session.js/);
    assert.equal(app.headers().cookie, undefined); assert.equal(app.headers().authorization, undefined);
    assert.equal((await app.send('/api/key', { method: 'POST', headers: { origin: config.origin, cookie } })).status, 409);
  } finally { await app.close(); }
});
test('cerrar sesion borra la cookie y limita los intentos de entrada', async () => {
  const app = await start();
  try {
    const logout = await app.send('/auth/logout', { method: 'POST', headers: { origin: config.origin, cookie: '__Host-observatorio-auth=good' } });
    assert.equal(logout.status, 303); assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
    for (let index = 0; index < 10; index++) await app.send('/auth/login', { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x&password=wrong' });
    assert.equal((await app.send('/auth/login', { method: 'POST', headers: { origin: config.origin } })).status, 429);
  } finally { await app.close(); }
});

test('el cliente oficial mantiene la sesion por cookie y verifica al usuario con Auth, no con datos del navegador', async () => {
  const user = { id: config.owner, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: config.owner, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.c3ludGhldGljLXRlc3Qtc2lnbmF0dXJl`;
  const calls = [];
  const app = await start({ authFetch: async (input, options) => {
    const url = new URL(input); calls.push(url.pathname);
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: jwt, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (url.pathname === '/auth/v1/user') {
      assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${jwt}`);
      return Response.json(user);
    }
    throw new Error('Unexpected Auth request');
  } });
  try {
    const login = await app.send('/auth/login', { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=owner%40example.invalid&password=synthetic' });
    assert.equal(login.status, 303);
    const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const result = await app.send('/private.json', { headers: { cookie } });
    assert.equal(result.status, 200); assert.equal(result.body, '{"private":true}');
    assert.ok(calls.includes('/auth/v1/user'));
  } finally { await app.close(); }
});
