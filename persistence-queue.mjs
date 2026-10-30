// Calls made during a write share its completion and one final flush. This
// preserves changes made while uploading without scanning unchanged history
// once for every waiting request. Failed writes reject every waiter.
export function createCoalescedWriter(write) {
  let pending = null, generation = 0;
  return function flush() {
    generation++;
    if (!pending) pending = Promise.resolve().then(async () => {
      let captured;
      do { captured = generation; await write(); } while (captured !== generation);
    }).finally(() => { pending = null; });
    return pending;
  };
}
