import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 26B — Desktop softphone Recents are own_extension_only. Active-content contracts only;
// read-only Git; never writes the real repository.
const root = path.resolve(__dirname, "../..");
const BASE = "8f93abed1";
const D = "apps/ava-softphone-desktop/src";
const RECENTS = `${D}/components/RecentsList.tsx`;
const API = `${D}/lib/avaApi.ts`;
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const added = (f: string) => git("diff", "--no-renames", "-U0", BASE, "--", f).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");

describe("Lemtel Phase 26B — Desktop call history privacy", () => {
  const statusBefore = git("status", "--porcelain");

  it("permanent guard passes before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("RecentsList uses only personal methods, no org/admin scope", () => {
    const s = rd(RECENTS);
    expect(s).toContain("ava.personalCalls(200, { rangeDays })");
    expect(s).toContain("ava.refreshPersonalCalls(200, { rangeDays })");
    for (const bad of ["ava.calls(", "ava.refreshCalls(", "useOrgId", "useRealtimeRefresh", "organization_id=eq", "scope:", "domain_uuid", "isAdmin"]) expect(s.includes(bad), bad).toBe(false);
  });

  it("defensive local filter and personal realtime channel with cleanup", () => {
    const s = rd(RECENTS);
    expect(s).toContain("export function isOwnRow(r: any, ext: string): boolean {");
    expect(s).toContain("[r.extension, r.caller_number, r.destination_number, r.source_number, r.from, r.to]");
    expect(s).toContain(".filter((r) => isOwnRow(r, extension))");
    expect(s).toContain("supabase.channel(`rt-pbx_call_records-extension-${extension}`)");
    expect(s).toContain("filter: `extension=eq.${extension}`");
    expect(s).toContain("if (isOwnRow(row, extension)) fire();");
    expect(s).toContain("supabase.removeChannel(channel)");
    expect(s).toContain("if (pending) clearTimeout(pending);");
    expect(s).toContain("if (!extension) return;");
  });

  it("avaApi exports personal methods resolved from getMeContext, admin methods kept", () => {
    const s = rd(API);
    expect(s).toContain("personalCalls: async (limit = 100, opts?: { rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("refreshPersonalCalls: async (limit = 150, opts?: { rangeDays?: 7 | 30 | null }) => {");
    expect(s.match(/const ext = cleanText\(me\.extension\);/g)?.length).toBe(2);
    expect(s.match(/if \(!ext\) return \[\] as CallRecord\[\];/g)?.length).toBe(2);
    expect(s.match(/readCallRecordRows\(limit, \{ extension: ext, rangeDays: opts\?\.rangeDays \?\? null \}\)/g)?.length).toBe(2);
    expect(s).toContain("calls: async (limit = 100, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("refreshCalls: async (limit = 150, opts?: { scope?: 'mine' | 'org'; extension?: string | null; rangeDays?: 7 | 30 | null }) => {");
    expect(s).toContain("scopedCallRecords: async (limit = 100,");
  });

  it("added active lines contain no Verto, PJSIP, SIP URL, PBX write, credential or data write", () => {
    for (const f of [RECENTS, API]) {
      const a = added(f);
      for (const tok of ["ver" + "to", "Ver" + "to", "pjsip", "PJSIP", "sip:", "wss://", "https://", "fusionpbx", "FusionPBX", "invokeFusionSync", "functions/v1", "password", "sec" + "ret", ".insert(", ".update(", ".upsert(", ".delete(", "method: 'POST'", "import("]) {
        expect(a.includes(tok), `${f} ${tok}`).toBe(false);
      }
    }
  });

  it("guard passes after; real status unchanged", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
  });
});
