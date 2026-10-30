// Do not leave a healthy HTTPS shell pointing at a stopped analysis worker.
// A bounded shutdown also prevents an old deployment from remaining a writer
// indefinitely while the replacement restores the same private history.
export function superviseBackend(backend, gateway, { exit = code => process.exit(code), graceMs = 10000, onFailure = () => console.error('El analisis privado se detuvo; se conserva el historial remoto.') } = {}) {
  let closing = false, finished = false, timer;
  function finish(code) {
    if (finished) return;
    finished = true; closing = true; clearTimeout(timer);
    if (gateway.listening) gateway.close();
    gateway.closeAllConnections();
    exit(code);
  }
  backend.on('error', () => { if (!closing) onFailure(); finish(closing ? 0 : 1); });
  backend.on('exit', () => { if (!closing) onFailure(); finish(closing ? 0 : 1); });
  return {
    get ready() { return !closing && !finished; },
    shutdown() {
      if (closing) return;
      closing = true;
      if (gateway.listening) gateway.close();
      gateway.closeIdleConnections();
      timer = setTimeout(() => finish(0), graceMs); timer.unref();
      backend.postMessage('shutdown');
    },
  };
}
