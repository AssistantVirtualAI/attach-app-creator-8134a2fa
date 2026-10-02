import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "85712b3d0";
const HOOK = "apps/ava-softphone-mobile/src/hooks/useSoftphone.ts";
const APP = "apps/ava-softphone-mobile/src/MobileApp.tsx";
const FORBIDDEN = ["useSoftphone" + "Verto", "repair-verto" + "-extension-routing", "verto" + "Provider", "verto" + ".answer", "verto" + ".bye"];
const REQUIRED_PREFIXES = ["apps/planipret-mobile/", "src/pages/planipret/", "src/components/planipret/", "src/lib/planipret/", "src/hooks/useMplanipretSoftphone.ts"];
const REQUIRED_PATTERNS = ["**/planipret/**", "**/*planipret*", "**/PpPjsip/**", "**/PpSipKeepAlive/**", "**/PpVoipCall/**"];

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" });

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

  it("no protected Planiprêt path changed since the phase baseline", () => {
    const out = execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { encoding: "utf8" });
    expect(out).toContain("LEMTEL_ISOLATION_PASSED");
    const changed = [
      ...git("diff", "--name-only", "--no-renames", `${BASE}..HEAD`).split("\n"),
      ...git("diff", "--name-only", "HEAD").split("\n"),
      ...git("ls-files", "--others", "--exclude-standard").split("\n"),
    ].filter(Boolean);
    const bad = changed.filter((p) => /planipret/i.test(p) || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p) || p === "src/hooks/useMplanipretSoftphone.ts");
    expect(bad).toEqual([]);
  }, 30000);
});
