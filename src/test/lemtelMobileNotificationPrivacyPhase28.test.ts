import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Phase 28A — Mobile local notifications are own_extension_only. Read-only; no Git range comparison.
const root = path.resolve(__dirname, "../..");
const HOOK = "apps/ava-softphone-mobile/src/hooks/useDeviceNotifications.ts";
const DOC = "docs/lemtel-mobile/phase-28a-mobile-notification-privacy.md";
const THREAT = "docs/lemtel-mobile/phase-28a-threat-model.md";
const FILES = [
  HOOK,
  "apps/ava-softphone-mobile/src/hooks/useDeviceNotifications.privacy.test.tsx",
  DOC, THREAT,
  "src/test/lemtelMobileNotificationPrivacyPhase28.test.ts",
];
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);

describe("Lemtel Phase 28A — Mobile notification privacy", () => {
  it("permanent guard passes before", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("only the CDR and voicemail subscriptions remain", () => {
    const s = rd(HOOK);
    expect(s.match(/supabase\.channel\(/g)?.length).toBe(2);
    expect(s).toContain("supabase.channel(`notif-cdr-${ext}`)");
    expect(s).toContain("supabase.channel(`notif-vm-${ext}`)");
    const tables = [...s.matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(["pbx_call_records", "pbx_voicemails"]);
  });

  it("filters use the extension only, with defensive payload checks", () => {
    const s = rd(HOOK);
    expect(s).toContain("const cdrFilter = `extension=eq.${ext}`;");
    expect(s).toContain("const vmFilter = `extension=eq.${ext}`;");
    expect(s).toContain("if (!ext) return;");
    expect(s).toContain("if (String(r?.extension ?? '') !== ext) return;");
    expect(s).toContain("if (String(r?.extension ?? '') !== String(ext)) return;");
    expect(s).toContain("if (r?.voicemail_message) return;");
    expect(s).toContain("}, [creds?.accessToken, creds?.extension]);");
  });

  it("no organization fallback, SMS or recording feed in the hook", () => {
    const s = rd(HOOK);
    for (const bad of ["organization_id", "organizationId", "orgId", "dataScope", "permissions", "pbx_sms_messages", "pbx_call_recordings", "to_extension", "from_extension", "raw_data", "domain_uuid", "smsCh", "recCh", "notif-sms", "notif-rec"]) {
      expect(s.includes(bad), bad).toBe(false);
    }
  });

  it("no Verto and no PBX / FusionPBX / Edge / server API call", () => {
    const s = rd(HOOK);
    for (const tok of ["ver" + "to", "Ver" + "to", "pjsip", "PJSIP", "fusionpbx", "FusionPBX", "functions.invoke", "functions/v1", "fetch(", "mobileApi", "wss://", "https://", ".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(s.includes(tok), tok).toBe(false);
    }
  });

  it("the five phase paths are not protected by the Planipret policy", () => {
    for (const f of FILES) {
      expect(isProtected(f), f).toBe(false);
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
  });

  it("documents describe the safe suspension of SMS / recording notifications", () => {
    const d = rd(DOC);
    expect(d).toContain("Flux suspendus");
    expect(d).toContain("**SMS**");
    expect(d).toContain("**nouvel enregistrement**");
    expect(d).toContain("`extension=eq.<ext>`");
    const t = rd(THREAT);
    expect(t).toContain("Pas de notification locale SMS ni d'enregistrement");
    expect(t).toContain("autre extension");
  });

  it("permanent guard passes after", { timeout: 60000 }, () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });
});
