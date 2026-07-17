// Prefetch lazy screen chunks on tap/hover/idle so tab switches feel instant.
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

export function prefetchRoute(path: string): void {
  if (!path || done.has(path) || started.has(path)) return;
  const factory =
    registry[path] ||
    Object.entries(registry)
      .filter(([k]) => path === k || path.startsWith(k + "/"))
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  if (!factory) return;
  started.add(path);
  Promise.resolve()
    .then(factory)
    .then(() => done.add(path))
    .catch(() => started.delete(path));
}

export function scheduleIdlePrefetch(paths: string[]): void {
  const run = () => paths.forEach(prefetchRoute);
  const ric: any = (globalThis as any).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 4000 });
  else setTimeout(run, 1200);
}

function prefetchRoutesStaggered(paths: string[], gapMs: number): void {
  paths.forEach((path, index) => window.setTimeout(() => prefetchRoute(path), index * gapMs));
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
