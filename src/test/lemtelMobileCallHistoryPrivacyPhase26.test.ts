import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 26A — Mobile call history, CDR realtime and CDR notifications are own_extension_only.
// Read-only Git commands only; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "72f11a93b";
const M = "apps/ava-softphone-mobile/src";
const CALLS = `${M}/screens/CallsScreen.tsx`;
const HOOK = `${M}/hooks/useRealtimeCDR.ts`;
const NOTIF = `${M}/hooks/useDeviceNotifications.ts`;
const API = `${M}/lib/mobileApi.ts`;
const HTEST = `${M}/hooks/useRealtimeCDR.privacy.test.tsx`;
const SELF = "src/test/lemtelMobileCallHistoryPrivacyPhase26.test.ts";
const FILES = [
  CALLS, HOOK, NOTIF, API, HTEST, SELF,
  "docs/lemtel-mobile/phase-26a-mobile-call-history-privacy.md",
  "docs/lemtel-mobile/phase-26a-threat-model.md",
].sort();
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
// Immutable Phase 26A end: scope is read only on BASE..PHASE26A_END.
const PHASE26A_END = "92d665ec2";
const RANGE = `${BASE}..${PHASE26A_END}`;
const changed = () =>
  git("diff", "--name-only", "--no-renames", RANGE).split("\n").filter(Boolean).sort();
const added = (f: string) => git("diff", "--no-renames", "-U0", RANGE, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 26A — Mobile call history privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("BASE and PHASE26A_END are commits, BASE strict ancestor; permanent guard passes before", { timeout: 60000 }, () => {
    expect(git("cat-file", "-t", BASE).trim()).toBe("commit");
    expect(git("cat-file", "-t", PHASE26A_END).trim()).toBe("commit");
    execFileSync("git", ["merge-base", "--is-ancestor", BASE, PHASE26A_END], { cwd: root });
    expect(git("rev-parse", BASE).trim()).not.toBe(git("rev-parse", PHASE26A_END).trim());
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("exactly the eight allowed paths changed in the frozen range, none protected", () => {
    const c = changed();
    expect(c.filter(isProtected)).toEqual([]);
    expect(c).toEqual(FILES);
  });

  it("later commits outside the frozen range cannot widen the list", () => {
    expect(changed()).toEqual(changed());
    expect(RANGE).toBe("72f11a93b..92d665ec2");
    expect(RANGE.includes("HEAD")).toBe(false);
  });

  it("mobileApi.calls sends no client extension", () => {
    const s = rd(API);
    const line = s.split("\n").find((l) => l.includes("calls: (opts?:"))!;
    expect(line).toContain("{ rangeDays?: 7 | 30; limit?: number }");
    expect(line).not.toContain("extension");
    expect(line).toContain("`/mobile-calls?days=${opts?.rangeDays || 7}&limit=${opts?.limit ?? 20}`");
  });

  it("useRealtimeCDR is extension-only with defensive row check", () => {
    const s = rd(HOOK);
    expect(s).toContain("export function useRealtimeCDR(creds: Creds | null, rangeDays: 7 | 30 = 7) {");
    for (const bad of ["extensionFilter", "dataScope", "permissions?.admin", "organization_id=eq", "cdr-org-"]) expect(s.includes(bad), bad).toBe(false);
    expect(s).toContain("const filter = `extension=eq.${ext}`;");
    expect(s).toContain("const chanKey = `cdr-ext-${ext}`;");
    expect(s).toContain("const own = (r: any) => !!r && r.extension === ext;");
    expect(s.match(/if \(!own\(payload\.new\)\) return;/g)?.length).toBe(2);
    expect(s).toContain("mobileApi.calls({ rangeDays, limit: 20 })");
  });

  it("CallsScreen History has no extension selector or domain lookup", () => {
    const s = rd(CALLS);
    for (const bad of ["extFilter", "domainExtensions", "pbx_extensions_directory", "allExtensions", "fallbackDomainUuid"]) expect(s.includes(bad), bad).toBe(false);
    expect(s).toContain("useRealtimeCDR(creds || null, rangeDays)");
    expect(s).toContain("if (myExt && !matchExt(c, myExt)) return false;");
  });

  it("useDeviceNotifications has no organizational CDR channel or admin bypass", () => {
    const s = rd(NOTIF);
    expect(s).not.toContain("adminScope");
    expect(s).toContain("const cdrFilter = ext ? `extension=eq.${ext}` : null;");
    expect(s).toContain("if (cdrFilter) cdrCh = supabase.channel(`notif-cdr-${ext}`)");
  });

  it("added active lines contain no Verto, PBX call, secret, SIP URL or data write", () => {
    const V = "ver" + "to";
    for (const f of [CALLS, HOOK, NOTIF, API]) {
      const a = added(f);
      for (const tok of [V, "Ver" + "to", "fusionpbx", "FusionPBX", "sip:", "wss://", "https://", "functions/v1", "password", "secret", ".insert(", ".update(", ".upsert(", ".delete(", "method: 'POST'"]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
