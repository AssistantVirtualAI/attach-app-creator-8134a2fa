/** Serial event queue: foreground/background must never arrive out of order. */
export function createHandoffLifecycle(send: (active: boolean) => Promise<void>) {
  let desired: boolean | undefined;
  let queue = Promise.resolve();
  return (active: boolean) => {
    if (desired === active) return queue;
    desired = active;
    queue = queue.catch(() => undefined).then(() => send(active));
    return queue;
  };
}