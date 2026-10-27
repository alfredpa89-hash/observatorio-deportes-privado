// Bound simultaneous reads and share identical GETs across panels. Mutations
// are never retried: a timed-out request may already have saved its result.
export function createJsonClient({ fetch: request = (...args) => globalThis.fetch(...args), concurrency = 2, timeoutMs = 90000 } = {}) {
  let running = 0;
  const waiting = [], reads = new Map();
  async function perform(path, body) {
    if (running >= concurrency) await new Promise(resolve => waiting.push(resolve));
    else running++;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(path, { signal: controller.signal, credentials: 'same-origin',
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      if (response.status === 401 || response.redirected && /\/auth\/login(?:\?|$)/.test(response.url || ''))
        throw new Error('Tu sesion ha caducado. Vuelve a iniciar sesion; los datos guardados se conservan.');
      if (!(response.headers.get('content-type') || '').includes('application/json'))
        throw new Error('El servidor se esta iniciando o devolvio una pagina de error. Conservamos la ultima lectura; vuelve a consultar cuando este disponible.');
      let value;
      try { value = await response.json(); }
      catch { throw new Error('La respuesta del servidor llego incompleta. Conservamos la ultima lectura; vuelve a consultar.'); }
      if (!response.ok) throw Object.assign(new Error(value.error || `No se pudo completar la consulta (${response.status}).`),
        { status: response.status, code: value.code, allowedSeasons: value.allowedSeasons, retryAfter: value.retryAfter });
      return value;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('El servidor tardo demasiado. Conservamos la ultima lectura. No se repitio la solicitud automaticamente.');
      if (error instanceof TypeError) throw new Error('No se pudo conectar con el servidor. Conservamos la ultima lectura; comprueba tu conexion.');
      throw error;
    } finally { clearTimeout(timer); const next = waiting.shift(); if (next) next(); else running--; }
  }
  return function jsonRequest(path, body) {
    if (body !== undefined) return perform(path, body);
    if (!reads.has(path)) {
      const pending = perform(path, undefined).finally(() => reads.delete(path));
      reads.set(path, pending);
    }
    return reads.get(path);
  };
}
export const jsonRequest = createJsonClient();
