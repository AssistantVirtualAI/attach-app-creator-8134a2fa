import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "85712b3d0";
const HOOK = "apps/ava-softphone-mobile/src/hooks/useSoftphone.ts";
const APP = "apps/ava-softphone-mobile/src/MobileApp.tsx";
const FORBIDDEN = ["useSoftphone" + "Verto", "repair-verto" + "-extension-routing", "verto" + "Provider", "verto" + ".answer", "verto" + ".bye"];
const REQUIRED_PREFIXES = ["apps/planipret-mobile/", "src/pages/planipret/", "src/components/planipret/", "src/lib/planipret/", "src/hooks/useMplanipretSoftphone.ts"];
const REQUIRED_PATTERNS = ["**/planipret/**", "**/*planipret*", "**/PpPjsip/**", "**/PpSipKeepAlive/**", "**/PpVoipCall/**"];

const PHASE18A_END = "0370df76d";
const PHASE18A_CHANGED_FILES = [
  "apps/ava-softphone-mobile/src/MobileApp.tsx",
  "apps/ava-softphone-mobile/src/hooks/useSoftphone.runtime.test.tsx",
  "apps/ava-softphone-mobile/src/hooks/useSoftphone.ts",
  "docs/lemtel-mobile/phase-18a-verto-runtime-removal.md",
  "src/test/lemtelMobileVertoRuntimePhase18.test.ts",
];

// Read-only historical helper: only git cat-file, merge-base and diff --name-only --no-renames.
const histGit = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const frozenRange = (base: string, end: string): string[] => {
  for (const c of [base, end]) expect(histGit("cat-file", "-t", c).trim(), `missing commit ${c}`).toBe("commit");
  expect(() => histGit("merge-base", "--is-ancestor", base, end), `${base} not ancestor of ${end}`).not.toThrow();
  return [...new Set(histGit("diff", "--name-only", "--no-renames", `${base}..${end}`).split("\n").map((x) => x.trim()).filter(Boolean))].sort();
};
const isProtectedPath = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const permanentGuardPasses = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { encoding: "utf8" });

describe("Phase 18A — Verto removed from active mobile runtime", () => {
  it("isolation policy still protects all required Planiprêt paths", () => {
    const text = readFileSync("schemas/lemtel-isolation/planipret-protected-paths-v1.json", "utf8");
    for (const p of [...REQUIRED_PREFIXES, ...REQUIRED_PATTERNS]) expect(text).toContain(JSON.stringify(p));
  });

  it("active runtime files contain no Verto references", () => {
    for (const f of [HOOK, APP]) {
      const src = readFileSync(f, "utf8");
      for (const s of FORBIDDEN) expect(src.includes(s), `${f}: ${s}`).toBe(false);
    }
  });

  it("selected providers remain JsSIP/PJSIP; Android non-native uses JsSIP", () => {
    const src = readFileSync(HOOK, "utf8");
    expect(src).toContain("useSoftphoneNative");
    expect(src).toContain("useSoftphoneJsSip");
    const body = src.slice(src.indexOf("export function useSoftphone("));
    const android = body.slice(body.indexOf("platform === 'android'"));
    expect(android.slice(0, android.indexOf("}"))).toContain("return useSoftphoneJsSip(config, opts)");
  });

  it("frozen Phase 18A interval is exact and the permanent Planiprêt guard passes", () => {
    expect(permanentGuardPasses()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect([...PHASE18A_CHANGED_FILES].sort()).toEqual(PHASE18A_CHANGED_FILES);
    const hist = frozenRange(BASE, PHASE18A_END);
    expect(hist).toEqual(PHASE18A_CHANGED_FILES);
    expect(hist.filter(isProtectedPath)).toEqual([]);
  }, 30000);
});
