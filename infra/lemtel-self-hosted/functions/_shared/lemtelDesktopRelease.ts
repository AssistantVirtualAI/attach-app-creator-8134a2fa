// Lemtel desktop release resolver. The portal download center, the welcome / recovery emails and the release
// announcement all follow the newest published desktop release automatically: no URL edit per release.
// Source of truth: the public GitHub release API of the Lemtel desktop repository (read-only, no token).
// A release is only used when it is published (not draft, not prerelease), its tag is vX.Y.Z and all three
// installers exist under that exact tag. Any failure keeps the last good answer, else the pinned fallback.
export const DESKTOP_REPOSITORY = "AssistantVirtualAI/attach-app-creator-8134a2fa";
const RELEASES_ROOT = `https://github.com/${DESKTOP_REPOSITORY}/releases`;
const LATEST_API = `https://api.github.com/repos/${DESKTOP_REPOSITORY}/releases/latest`;
export const PINNED_DESKTOP_VERSION = "2.5.22";
const CACHE_MS = 10 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;
const VERSION_RE = /^v(\d{1,3})\.(\d{1,3})\.(\d{1,4})$/;

export type DesktopRelease = {
  version: string;
  publishedAt: string | null;
  releaseUrl: string;
  windows: string;
  macosApple: string;
  macosIntel: string;
  source: "github_latest" | "pinned";
};

export function assetNames(version: string) {
  return {
    windows: `Lemtel-Telecom-Setup-${version}.exe`,
    macosApple: `Lemtel-Telecom-${version}-arm64.dmg`,
    macosIntel: `Lemtel-Telecom-${version}-x64.dmg`,
  };
}

export function releaseFor(version: string, publishedAt: string | null, source: DesktopRelease["source"]): DesktopRelease {
  const base = `${RELEASES_ROOT}/download/v${version}`;
  const n = assetNames(version);
  return { version, publishedAt, releaseUrl: `${RELEASES_ROOT}/tag/v${version}`, windows: `${base}/${n.windows}`, macosApple: `${base}/${n.macosApple}`, macosIntel: `${base}/${n.macosIntel}`, source };
}

export const PINNED_DESKTOP_RELEASE = releaseFor(PINNED_DESKTOP_VERSION, null, "pinned");

/** Semantic comparison of X.Y.Z strings; returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Strict parse of the GitHub "latest release" payload. Never trusts a URL it did not build itself. */
export function parseLatestRelease(payload: unknown): DesktopRelease | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.draft !== false || p.prerelease !== false || typeof p.tag_name !== "string") return null;
  const m = VERSION_RE.exec(p.tag_name);
  if (!m) return null;
  const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
  if (`v${version}` !== p.tag_name) return null;
  const assets = Array.isArray(p.assets) ? p.assets as Array<Record<string, unknown>> : [];
  const ready = (name: string) => assets.some((a) => a?.name === name && a?.state === "uploaded" && Number(a?.size) > 1_000_000);
  const n = assetNames(version);
  if (!ready(n.windows) || !ready(n.macosApple) || !ready(n.macosIntel)) return null;
  const publishedAt = typeof p.published_at === "string" && !Number.isNaN(Date.parse(p.published_at)) ? new Date(p.published_at).toISOString() : null;
  return releaseFor(version, publishedAt, "github_latest");
}

let cached: { release: DesktopRelease; at: number } | null = null;
let lastFailureAt = 0;

/** Test hook: forget the module cache. */
export function resetDesktopReleaseCache() { cached = null; lastFailureAt = 0; }

/** The newest complete release, refreshed at most every 10 minutes; never throws, never older than the pin. */
export async function latestDesktopRelease(fetchFn: typeof fetch = fetch, now = Date.now(), force = false): Promise<DesktopRelease> {
  if (!force && cached && now - cached.at < CACHE_MS) return cached.release;
  if (!force && !cached && lastFailureAt && now - lastFailureAt < FAILURE_RETRY_MS) return PINNED_DESKTOP_RELEASE;
  try {
    const response = await fetchFn(LATEST_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "lemtel-portal", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(5000),
    });
    const release = response.ok ? parseLatestRelease(await response.json()) : null;
    if (release && compareVersions(release.version, PINNED_DESKTOP_VERSION) >= 0) {
      cached = { release, at: now };
      return release;
    }
  } catch { /* network failure: fall through */ }
  lastFailureAt = now;
  if (cached) { cached = { release: cached.release, at: now - CACHE_MS + FAILURE_RETRY_MS }; return cached.release; }
  return PINNED_DESKTOP_RELEASE;
}

/** Synchronous view for code paths that cannot await (last resolved value, else the pin). */
export function currentDesktopRelease(): DesktopRelease {
  return cached?.release ?? PINNED_DESKTOP_RELEASE;
}
