import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 29B / 29B.1 — server authority on Mobile recording audio. Read-only checks;
// no Git range comparison, no untracked file reads.
const root = path.resolve(__dirname, "../..");
const PROXY = "supabase/functions/fusionpbx-proxy/index.ts";
const CD = "apps/ava-softphone-mobile/src/screens/CallDetailScreen.tsx";
const DOC = "docs/lemtel-mobile/phase-29b-mobile-recording-audio-authority.md";
const TM = "docs/lemtel-mobile/phase-29b-threat-model.md";
const CFG = "docs/lemtel-client-config/phase-29b-server-recording-access.md";
const FILES = [
  PROXY,
  "supabase/functions/fusionpbx-proxy/recordingAccess.contract.test.ts",
  CD,
  "apps/ava-softphone-mobile/src/screens/CallDetailScreen.recordingAuthority.test.tsx",
  DOC, TM,
  "src/test/lemtelMobileRecordingAudioAuthorityPhase29.test.ts",
  CFG,
];
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);
const block = (s: string, a: string, b: string) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i); return s.slice(i, j); };

describe("Lemtel Phase 29B — Mobile recording audio authority", () => {
  it("guard passes before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("eight phase paths exist and none is protected", () => {
    for (const f of FILES) expect(fs.existsSync(path.join(root, f))).toBe(true);
    expect(FILES.filter(isProtected)).toEqual([]);
  });

  it("CallDetailScreen imports and uses the shared helper", () => {
    const s = rd(CD);
    expect(s).toContain("import { loadPbxRecordingAudioMobile } from '../lib/mobileSupabase';");
    expect(s).toMatch(/await loadPbxRecordingAudioMobile\(\s*meta,\s*mobile\.accessToken,\s*mobile\.organizationId,\s*mobile\.fusionpbxDomainUuid,/);
  });

  it("no direct proxy call, hard-coded URL/key or domain fallback in the detail screen", () => {
    const s = rd(CD);
    expect(s).not.toContain("fusionpbx-proxy");
    expect(s).not.toMatch(/fetch\(/);
    expect(s).not.toMatch(/supabase\.co|eyJhbGci|apikey|ANON_KEY|SUPABASE_URL/);
    expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("proxy audio actions share the strict extension check; admin bypass gone from the helper", () => {
    const s = rd(PROXY);
    const helper = block(s, "async function resolveAuthorizedRecording(", "function serverRecordingParams(");
    expect(helper).not.toMatch(/is_lemtel_admin|org_members|is_lemtel_member/);
    expect(helper).toContain("if (isServiceCall) return { allowed: true, record: null };");
    expect(helper).toContain('.eq("portal_user_id", userId)');
    expect(helper).toContain('.eq("organization_id", record.organization_id)');
    expect(helper).toContain('.eq("extension", recordExtension)');
    expect(helper.match(/allowed: true/g)?.length).toBe(2);
    const getRec = block(s, 'if (action === "get-recording") {', 'required" }, 400);');
    const signed = block(s, 'if (action === "get-recording-signed-url") {', "const selfRes = await fetch");
    expect(getRec).toContain("if (!recAccess.allowed)");
    expect(signed).toContain("if (!signedAccess.allowed)");
  });

  it("29B.1 — no confused deputy: user read params are replaced by the server CDR", () => {
    const s = rd(PROXY);
    const norm = block(s, "function serverRecordingParams(", "function getPbxFileBases()");
    expect(norm).not.toMatch(/params|body|await|admin\./);
    const getRec = block(s, 'if (action === "get-recording") {', 'required" }, 400);');
    const userBranch = getRec.slice(getRec.indexOf("} else {"), getRec.indexOf("const { record_path"));
    expect(userBranch).toContain("recordingParams = serverRecordingParams(recAccess.record);");
    expect(userBranch).not.toMatch(/clientParams/);
    expect(getRec).not.toMatch(/clientParams\.(record_|recording_|domain_|recorded_at|start_at|local_recording_url|organization_id)/);
    const signed = block(s, 'if (action === "get-recording-signed-url") {', "const selfRes = await fetch");
    expect(signed).toContain('{ action: "get-recording", organization_id: userReadParams.organization_id, params: userReadParams }');
    expect(signed).not.toMatch(/params: signedParams|params: params/);
    expect(getRec).toContain("if (isServiceCall) {");
  });

  it("phase files add no Verto, PJSIP, endpoint, migration, SIP URL or credential", () => {
    for (const f of [CD, DOC, TM, CFG]) {
      const s = rd(f);
      expect(s).not.toMatch(/verto|pjsip|sips?:\/\/|wss:\/\/|CREATE TABLE|ALTER TABLE|serve\(/i);
    }
    const cd = rd(CD);
    expect(cd).not.toMatch(/\.(insert|upsert)\(|console\.log/);
    expect(rd(DOC)).not.toMatch(/eyJhbGci|SERVICE_ROLE_KEY/);
  });

  it("docs distinguish mandatory server control from client filtering (26–29A)", () => {
    const d = rd(DOC);
    expect(d).toMatch(/contrôle serveur obligatoire/);
    expect(d).toMatch(/Phases 26 à 29A filtrent côté client/);
    expect(rd(CFG)).toMatch(/ne peut jamais contourner/);
  });

  it("guard passes after", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });
});
