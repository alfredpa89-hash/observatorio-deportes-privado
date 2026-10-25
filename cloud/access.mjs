import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeNext = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) && !value.startsWith('/auth/') ? value : '/';
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
function redirect(response, target) { response.writeHead(303, { location: target }); response.end(); }
function loginPage(next, error = '') {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acceso privado | Observatorio</title>
  <style>body{margin:0;background:#f4f6f6;color:#17252a;font:16px system-ui,sans-serif}main{max-width:360px;margin:12vh auto;padding:24px}h1{font-size:25px}label{display:block;margin-top:18px}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border:1px solid #9aa9a4;border-radius:6px}input{margin-top:7px;background:white}button{margin-top:24px;background:#bd6259;color:white;border-color:#bd6259;cursor:pointer}.error{color:#a23131;font-size:14px}p{color:#52645f;font-size:14px}</style>
  <main><h1>Observatorio Deportes</h1><p>Acceso privado</p>${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
  <form method="post" action="/auth/login"><input type="hidden" name="next" value="${escape(safeNext(next))}">
  <label>Correo<input name="email" type="email" autocomplete="username" required maxlength="254"></label>
  <label>Contrase&ntilde;a<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button type="submit">Entrar</button></form></main></html>`;
}

export function createCloudAccess(config, { createClient = createServerClient, authFetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const attempts = []; const cookieName = '__Host-observatorio-auth';
  return async function access(request, response, url) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Vary', 'Cookie');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.method === 'GET' && url.pathname === '/healthz') { json(response, 200, { ok: true }); return false; }
    if (String(request.headers.host).toLowerCase() !== new URL(config.origin).host || request.headers['x-forwarded-proto'] !== 'https') {
      json(response, 403, { error: 'Solo se acepta el dominio HTTPS configurado.' }); return false;
    }
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) { json(response, 405, { error: 'Metodo no permitido.' }); return false; }
    if (request.method === 'POST' && request.headers.origin !== config.origin) { json(response, 403, { error: 'Origen no permitido.' }); return false; }
    if (request.method === 'GET' && url.pathname === '/auth/login') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(loginPage(url.searchParams.get('next'))); return false;
    }
    const incoming = parseCookieHeader(request.headers.cookie || '').filter(cookie => cookie.name === cookieName || cookie.name.startsWith(cookieName + '.'));
    const cookies = new Map(incoming.map(cookie => [cookie.name, cookie.value])), pending = new Map();
    const client = createClient(config.supabaseUrl, config.publishableKey, {
      cookieOptions: { name: cookieName, path: '/', httpOnly: true, secure: true, sameSite: 'lax' },
      global: { fetch: (input, options = {}) => authFetch(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }) },
      cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => {
        for (const cookie of values) { cookies.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); }
      } },
    });
    const flush = () => {
      if (pending.size) response.setHeader('Set-Cookie', [...pending.values()].map(({ name, value, options }) =>
        serializeCookieHeader(name, value, { ...options, path: '/', httpOnly: true, secure: true, sameSite: 'lax', domain: undefined })));
    };
    if (request.method === 'POST' && url.pathname === '/auth/login') {
      while (attempts.length && attempts[0] < now() - 60000) attempts.shift();
      if (attempts.length >= 10) { response.setHeader('Retry-After', '60'); json(response, 429, { error: 'Espera un minuto antes de volver a entrar.' }); return false; }
      attempts.push(now());
      if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers['content-type'] || '')) { json(response, 415, { error: 'Formulario no valido.' }); return false; }
      let bytes = 0; const chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) { json(response, 413, { error: 'Formulario demasiado grande.' }); return false; } chunks.push(chunk); }
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const result = await client.auth.signInWithPassword({ email: body.get('email') || '', password: body.get('password') || '' });
      if (result.error || result.data?.user?.id !== config.owner) {
        if (!result.error) await client.auth.signOut({ scope: 'local' });
        response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(loginPage(body.get('next'), 'No se pudo iniciar sesion con esa cuenta.')); return false;
      }
      flush(); redirect(response, safeNext(body.get('next'))); return false;
    }
    if (!incoming.length) {
      if (url.pathname.startsWith('/api/')) json(response, 401, { error: 'Inicia sesion para consultar la aplicacion.', login: '/auth/login' });
      else redirect(response, `/auth/login?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`);
      return false;
    }
    const result = await client.auth.getUser();
    if (result.error || result.data?.user?.id !== config.owner) {
      const status = result.error?.name === 'AuthRetryableFetchError' ? 503 : 401;
      if (url.pathname.startsWith('/api/') || status === 503) json(response, status, { error: status === 503 ? 'No se pudo verificar el acceso privado. Intenta mas tarde.' : 'Sesion no valida.', login: '/auth/login' });
      else redirect(response, '/auth/login');
      return false;
    }
    flush();
    if (request.method === 'POST' && url.pathname === '/auth/logout') { await client.auth.signOut({ scope: 'local' }); flush(); redirect(response, '/auth/login'); return false; }
    if (url.pathname.startsWith('/auth/')) { json(response, 404, { error: 'Ruta no encontrada.' }); return false; }
    return true;
  };
}
