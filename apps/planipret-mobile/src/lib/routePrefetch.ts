// Prefetch lazy screen chunks on tap/hover/idle so tab switches feel instant.
// Pending idle/staggered prefetches can be cancelled when the user navigates,
// so background work never competes with the route the user actually opened.
type Factory = () => Promise<any>;

const registry: Record<string, Factory> = {
  "/mplanipret":              () => import("@/pages/planipret/mobile/MHome"),
  "/mplanipret/home":         () => import("@/pages/planipret/mobile/MHome"),
  "/mplanipret/calls":        () => import("@/pages/planipret/mobile/MCalls"),
  "/mplanipret/messages":     () => import("@/pages/planipret/mobile/MMessages"),
  "/mplanipret/voicemail":    () => import("@/pages/planipret/mobile/MVoicemail"),
  "/mplanipret/contacts":     () => import("@/pages/planipret/mobile/MContacts"),
  "/mplanipret/more":         () => import("@/pages/planipret/mobile/MMore"),
  "/mplanipret/pipeline":     () => import("@/pages/planipret/mobile/MPipeline"),
  "/mplanipret/search":       () => import("@/pages/planipret/mobile/MSearch"),
  "/mplanipret/stats":        () => import("@/pages/planipret/mobile/MStats"),
  "/mplanipret/ava":          () => import("@/pages/planipret/mobile/MAvaChat"),
  "/mplanipret/notifications":() => import("@/pages/planipret/mobile/MAvaNotifications"),
  "/mplanipret/extension-sync":() => import("@/pages/planipret/mobile/MExtensionSync"),
  "/mplanipret/ms365-diagnostics":() => import("@/pages/planipret/mobile/MMs365Diagnostics"),
  "/mplanipret/style-diagnostics":() => import("@/pages/planipret/mobile/MStyleDiagnostics"),
  "/mplanipret/diagnostics":() => import("@/pages/planipret/mobile/MDiagnostics"),
  "/mplanipret/sip-debug":() => import("@/pages/planipret/mobile/MSipDebug"),
};

const started = new Set<string>();
const done = new Set<string>();

// Pending scheduled prefetches (not yet started). Cancelled on route change.
type Pending = { cancel: () => void };
const pending = new Map<string, Pending>();

function resolveFactory(path: string): Factory | undefined {
  return (
    registry[path] ||
    Object.entries(registry)
      .filter(([k]) => path === k || path.startsWith(k + "/"))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1]
  );
}

export function prefetchRoute(path: string): void {
  if (!path || done.has(path) || started.has(path)) return;
  const factory = resolveFactory(path);
  if (!factory) return;
  pending.delete(path);
  started.add(path);
  Promise.resolve()
    .then(factory)
    .then(() => done.add(path))
    .catch(() => started.delete(path));
}

// Schedule prefetch with a *cancellable* low-priority slot.
// Uses scheduler.postTask({ priority: "background" }) when available so it
// yields to user-driven work; falls back to requestIdleCallback / setTimeout.
function schedulePrefetch(path: string, delayMs: number): void {
  if (!path || done.has(path) || started.has(path) || pending.has(path)) return;
  if (!resolveFactory(path)) return;

  let cancelled = false;
  let timerId: number | null = null;
  let ric: number | null = null;
  const scheduler: any = (globalThis as any).scheduler;
  let taskCtrl: AbortController | null = null;

  const run = () => {
    pending.delete(path);
    if (cancelled) return;
    prefetchRoute(path);
  };

  const kickLowPriority = () => {
    if (cancelled) return;
    if (scheduler && typeof scheduler.postTask === "function") {
      taskCtrl = new AbortController();
      scheduler
        .postTask(run, { priority: "background", signal: taskCtrl.signal })
        .catch(() => {});
    } else if (typeof (globalThis as any).requestIdleCallback === "function") {
      ric = (globalThis as any).requestIdleCallback(run, { timeout: 4000 });
    } else {
      timerId = window.setTimeout(run, 0);
    }
  };

  const initial = window.setTimeout(kickLowPriority, delayMs);
  pending.set(path, {
    cancel: () => {
      cancelled = true;
      window.clearTimeout(initial);
      if (timerId != null) window.clearTimeout(timerId);
      if (ric != null && typeof (globalThis as any).cancelIdleCallback === "function") {
        (globalThis as any).cancelIdleCallback(ric);
      }
      if (taskCtrl) try { taskCtrl.abort(); } catch {}
      pending.delete(path);
    },
  });
}

export function scheduleIdlePrefetch(paths: string[]): void {
  paths.forEach((p) => schedulePrefetch(p, 0));
}

function prefetchRoutesStaggered(paths: string[], gapMs: number): void {
  paths.forEach((path, index) => schedulePrefetch(path, index * gapMs));
}

/**
 * Cancel every prefetch that hasn't started yet.
 * Call this on route change so background chunks stop competing with the
 * chunk the user is actually opening. Prefetches already in-flight complete
 * normally (browser can't abort a running dynamic import).
 * `exceptPath`, when provided, keeps that route's pending prefetch scheduled.
 */
export function cancelPendingPrefetches(exceptPath?: string): void {
  for (const [path, entry] of Array.from(pending.entries())) {
    if (exceptPath && path === exceptPath) continue;
    entry.cancel();
  }
}

/** All bottom-tab / accessible mobile routes — used to warm every chunk. */
export const ALL_MOBILE_TAB_PATHS = [
  "/mplanipret/home",
  "/mplanipret/calls",
  "/mplanipret/messages",
  "/mplanipret/voicemail",
  "/mplanipret/contacts",
  "/mplanipret/more",
  "/mplanipret/pipeline",
  "/mplanipret/stats",
  "/mplanipret/ava",
  "/mplanipret/notifications",
  "/mplanipret/search",
  "/mplanipret/extension-sync",
  "/mplanipret/ms365-diagnostics",
  "/mplanipret/style-diagnostics",
  "/mplanipret/diagnostics",
  "/mplanipret/sip-debug",
];

const CRITICAL_MOBILE_TAB_PATHS = [
  "/mplanipret/home",
  "/mplanipret/calls",
  "/mplanipret/messages",
  "/mplanipret/ava",
  "/mplanipret/contacts",
];

export function prefetchAllMobileTabs(): void {
  prefetchRoutesStaggered(CRITICAL_MOBILE_TAB_PATHS, 80);
  scheduleIdlePrefetch(ALL_MOBILE_TAB_PATHS.filter((p) => !CRITICAL_MOBILE_TAB_PATHS.includes(p)));
}
