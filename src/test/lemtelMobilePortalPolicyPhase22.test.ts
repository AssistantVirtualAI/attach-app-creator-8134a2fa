import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "44c8b22e9";
const M = "apps/ava-softphone-mobile/src";
const HOOK = `${M}/hooks/useLemtelMobileClientConfig.ts`;
const APP = `${M}/MobileApp.tsx`;
const MORE = `${M}/screens/MoreScreen.tsx`;
const SET = `${M}/screens/SettingsScreen.tsx`;
const FILES = [
  HOOK,
  `${M}/hooks/useLemtelMobileClientConfig.test.tsx`,
  APP,
  MORE,
  SET,
  `${M}/test/settingsSheets.test.tsx`,
  "docs/lemtel-mobile/phase-22b-mobile-portal-policy.md",
  "docs/lemtel-mobile/phase-22b-threat-model.md",
  "src/test/lemtelMobilePortalPolicyPhase22.test.ts",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = (...a: string[]) => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs", ...a], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const changed = () => {
  const committed = git("diff", "--name-only", "--no-renames", `${BASE}..HEAD`).split("\n");
  const pending = git("status", "--porcelain", "--untracked-files=all").split("\n").map((l) => l.slice(3));
  return [...new Set([...committed, ...pending].filter(Boolean))].sort();
};
const V = "Ver" + "to";

describe("Lemtel Phase 22B — Mobile read-only portal policy", () => {
  const statusBefore = git("status", "--porcelain");

  it("base is ancestor of HEAD; guards pass before", { timeout: 60000 }, () => {
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, "HEAD"], { cwd: root });
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${BASE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the nine allowed files changed since base, none protected", () => {
    expect(FILES.length).toBe(9);
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("hook exposes only validated/cached manifest and nulls it on revocation", () => {
    const s = rd(HOOK);
    expect(s).toContain("manifest: LemtelManifest | null;");
    const apply = between(s, "const applyManifest", "}, []);");
    expect(apply.indexOf("decision === 'allowed'")).toBeLessThan(apply.indexOf("setManifest(m)"));
    expect(apply).toContain("setManifest(null)");
    const fail = between(s, "const handleFailure", "}, []);");
    expect(fail).toContain("setManifest(cached!.manifest)");
    expect(fail.match(/setManifest\(null\)/g)?.length).toBe(3);
    expect(between(s, "const finalizeBlock", "}, []);")).toContain("setManifest(null)");
    expect(s).toContain("if (!hasPortalSession) { setManifest(null);");
    expect(s.match(/edgeCall\(/g)?.length).toBe(1);
    for (const bad of ["setTimeout", "setInterval", "console.", "fetch("]) expect(s).not.toContain(bad);
  });

  it("MobileApp passes only telephonyPolicy to both screens; MoreScreen propagates", () => {
    const a = rd(APP);
    expect(a).toContain("const portalTelephonyPolicy = clientConfig.manifest?.telephonyPolicy ?? null;");
    expect(a.match(/clientConfig\.manifest/g)?.length).toBe(1);
    expect(a).toMatch(/tab === 'settings'\s+&& <SettingsScreen[^\n]*portalTelephonyPolicy=\{portalTelephonyPolicy\}/);
    expect(a).toMatch(/tab === 'more'\s+&& <MoreScreen[^\n]*portalTelephonyPolicy=\{portalTelephonyPolicy\}/);
    const m = rd(MORE);
    expect(m).toContain("<SettingsScreen creds={creds} sp={sp} onSignOut={onSignOut} portalTelephonyPolicy={portalTelephonyPolicy} />");
  });

  it("SettingsScreen shows four labels and note only when prop exists; card is read-only", () => {
    const s = rd(SET);
    expect(s).toContain("{portalTelephonyPolicy && <PortalPolicyCard policy={portalTelephonyPolicy} lang={lang} />}");
    for (const l of ["Ne pas déranger : activé", "Transfert d’appels : désactivé", "Enregistrement : géré par le portail", "Boîte vocale : activée", "Do not disturb: enabled", "Call forwarding: disabled", "Recording: user allowed", "Voicemail: disabled", "Politique du portail", "Portal policy",
      "Les réglages téléphoniques sont appliqués par le portail. Modifiez-les dans le portail Lemtel.", "Telephony settings are applied by the portal. Change them in the Lemtel portal."]) expect(s).toContain(l);
    const card = between(s, "function PortalPolicyCard", "\n}\n");
    for (const bad of ["mobileApi", "setDnd", "setForwarding", "onPress", "onClick", "<Switch", "<input", "<button", "revision", "deviceRef", "wss", "token"]) expect(card).not.toContain(bad);
  });

  it("no new Verto, PJSIP, fetch, functions.invoke, FusionPBX or SIP URL introduced", () => {
    for (const f of [HOOK, APP, MORE, SET]) {
      const before = git("show", `${BASE}:${f}`), now = rd(f);
      for (const tok of [V, "PJSIP", "Pjsip", "fetch(", "functions.invoke", "fusionpbx", "wss://", "sip:"]) {
        expect(now.split(tok).length, `${f} ${tok}`).toBe(before.split(tok).length);
      }
    }
  });

  it("real temporary Git repository: nine files pass, tenth or Planiprêt path fails; real repo unchanged", () => {
    const check = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p22b-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p22b");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(check([])).toBe(true);
    expect(check(["apps/ava-softphone-mobile/src/lib/sip/x.ts"])).toBe(false);
    expect(check(["apps/planipret-mobile/src/x.ts"])).toBe(false);
    expect(git("status", "--porcelain")).toBe(statusBefore);
  }, 30000);

  it("guards pass after; status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(guard(`--scope=${BASE}`)).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
