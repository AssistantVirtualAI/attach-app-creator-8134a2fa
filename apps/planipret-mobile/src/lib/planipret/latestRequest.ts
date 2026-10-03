/**
 * "Latest request wins" primitive for Planiprêt screens (client-only).
 * - Key is always scoped: brokerId + resource + filter/period/page.
 * - Same key in flight: joins the existing promise (no duplicate wave).
 * - Different key / new run: aborts the previous one (AbortController) and
 *   bumps a monotonic generation; `isCurrent()` must be checked before any
 *   state/cache publish.
 * - dispose(): aborts everything; nothing published afterwards.
 */
export type RequestCtx = { signal: AbortSignal; isCurrent: () => boolean };

export function scopedKey(brokerId: string | null | undefined, resource: string, params: Record<string, unknown> = {}): string {
  const p = Object.keys(params).sort().map((k) => `${k}=${String(params[k] ?? "")}`).join("&");
  return `${brokerId ?? "anon"}|${resource}|${p}`;
}

export function createLatestRequest<T>() {
  let gen = 0;
  let disposed = false;
  let inflight: { key: string; gen: number; ctrl: AbortController; promise: Promise<T | undefined> } | null = null;

  function run(key: string, fn: (ctx: RequestCtx) => Promise<T>): Promise<T | undefined> {
    if (disposed) return Promise.resolve(undefined);
    if (inflight && inflight.key === key) return inflight.promise;
    inflight?.ctrl.abort();
    const my = ++gen;
    const ctrl = new AbortController();
    const isCurrent = () => !disposed && my === gen && !ctrl.signal.aborted;
    const promise = fn({ signal: ctrl.signal, isCurrent })
      .then((v) => (isCurrent() ? v : undefined))
      .catch((e) => { if (isCurrent()) throw e; return undefined; })
      .finally(() => { if (inflight?.gen === my) inflight = null; });
    inflight = { key, gen: my, ctrl, promise };
    return promise;
  }
  function invalidate() { inflight?.ctrl.abort(); inflight = null; gen += 1; }
  function dispose() { disposed = true; invalidate(); }
  return { run, invalidate, dispose, get activeKey() { return inflight?.key ?? null; } };
}
