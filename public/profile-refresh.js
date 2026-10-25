export function createProfileRefresh({ current, load, apply, onError = () => {}, schedule = setTimeout, cancel = clearTimeout, delay = 3000 }) {
  let timer, pending = false, running = false, generation = 0;
  async function run() {
    timer = undefined;
    if (running || !pending) return;
    const selection = current();
    if (!selection) { pending = false; return; }
    if (selection.defer) { timer = schedule(run, delay); return; }
    pending = false; running = true;
    const token = generation;
    try {
      const result = await load(selection);
      const latest = current();
      if (token === generation && latest && !latest.defer && latest.key === selection.key) apply(result);
      else if (token === generation && latest?.defer && latest.key === selection.key) pending = true;
    } catch (error) { if (token === generation) onError(error); }
    finally { running = false; if (pending && !timer) timer = schedule(run, delay); }
  }
  return {
    notify() { pending = true; if (timer) cancel(timer); timer = schedule(run, delay); },
    cancel() { generation++; pending = false; if (timer) cancel(timer); timer = undefined; },
  };
}
