import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 29A — Mobile voicemail Realtime trigger scoped to the signed-in extension.
// Read-only checks; no Git range comparison, no untracked file reads.
const root = path.resolve(__dirname, "../..");
const M = "apps/ava-softphone-mobile/src";
const VM = `${M}/screens/VoicemailScreen.tsx`;
const DOC = "docs/lemtel-mobile/phase-29a-mobile-voicemail-realtime-privacy.md";
const TM = "docs/lemtel-mobile/phase-29a-threat-model.md";
const FILES = [
  VM,
  `${M}/screens/VoicemailScreen.realtimePrivacy.test.tsx`,
  DOC,
  TM,
  "src/test/lemtelMobileVoicemailRealtimePrivacyPhase29.test.ts",
];
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
// The Realtime effect block only (the rest of the screen is out of scope for 29A).
const rtBlock = () => {
  const s = rd(VM);
  const a = s.indexOf("// Phase 29A — Realtime refresh");
  const b = s.indexOf("[mobile.accessToken, vmExt]);", a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return s.slice(a, b + 30);
};
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);

describe("Lemtel Phase 29A — Mobile voicemail Realtime privacy", () => {
  it("guard passes before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("five phase paths exist and are not protected", () => {
    for (const f of FILES) expect(fs.existsSync(path.join(root, f))).toBe(true);
    expect(FILES.filter(isProtected)).toEqual([]);
  });

  it("no domain/org scope or global channel remains", () => {
    const s = rtBlock();
    expect(rd(VM)).not.toContain("mobile.domainUuid");
    expect(rd(VM)).not.toMatch(/['"]vm-mobile['"]/);
    expect(s).not.toContain("domain_uuid");
    expect(s).not.toContain("domainUuid");
    expect(s).not.toContain("mobile.domainUuid");
    expect(s).not.toMatch(/['"]vm-mobile['"]/);
    expect(s).not.toMatch(/organization_id|organizationId|orgId/);
  });

  it("extension required, exact filter, extension-bound channel, defensive payload checks", () => {
    const s = rd(VM);
    expect(s).toContain("String(mobile.extension || '').trim()");
    expect(s).toMatch(/if \(!mobile\.accessToken \|\| !ext\) return;/);
    expect(s).toContain("const filter = `extension=eq.${ext}`;");
    expect(s).toContain(".channel(`vm-mobile-${ext}`)");
    for (const ev of ["INSERT", "UPDATE", "DELETE"]) expect(s).toContain(`event: '${ev}', schema: 'public', table: 'pbx_voicemails', filter`);
    expect(s).toMatch(/payload\?\.eventType === 'DELETE' \? payload\?\.old : payload\?\.new/);
    expect(s).toMatch(/if \(!isOwn\(payload\)\) return;\s*reload\(\);/);
    expect(s).toContain("[mobile.accessToken, vmExt]");
  });

  it("adds no Verto, PJSIP, PBX/FusionPBX, SIP URL or data write", () => {
    expect(rd(VM)).not.toMatch(/verto|pjsip|fusionpbx|sips?:\/\/|wss:\/\//i);
    const s = rtBlock();
    expect(s).not.toMatch(/edgeCall|mobileApi\.|fetch\(/);
    expect(s).not.toMatch(/\.(insert|upsert|update|delete)\(/);
  });

  it("comments and docs distinguish Realtime filter from audio authorization", () => {
    expect(rd(VM)).toMatch(/signed audio URL authorization[\s\S]*later server-side phase/);
    expect(rd(DOC)).toMatch(/Autorisation serveur des URL audio/);
    expect(rd(TM)).toMatch(/autorisation serveur de l'audio/);
  });

  it("guard passes after", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });
});
