import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const SCHEMA = "schemas/lemtel-client-config/lemtel-portal-client-reconciliation-v1.schema.json";
const POLICY = "schemas/lemtel-client-config/lemtel-portal-client-reconciliation-policy-v1.json";
const DOC = "docs/lemtel-client-config/phase-19a-portal-client-reconciliation-contract.md";
const THREAT = "docs/lemtel-client-config/phase-19a-threat-model.md";
const TEST = "src/test/lemtelPortalClientReconciliationPhase19.test.ts";
const PHASE19A_FILES = [DOC, THREAT, SCHEMA, POLICY, TEST].sort();
const BASE = "29db356b7";
const PHASE19A_END = "ddd7211f2";

const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const json = (p: string) => JSON.parse(read(p));
const guard = () => execFileSync(process.execPath, ["scripts/verify-lemtel-planipret-isolation.mjs"], { cwd: root, encoding: "utf8" });
const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const isProtected = (p: string) => /planipret/i.test(p) || p === "src/hooks/useMplanipretSoftphone.ts" || /(^|\/)Pp(Pjsip|SipKeepAlive|VoipCall)\//.test(p);

// Minimal validator for the subset used by the schema (const, enum, type, required, additionalProperties, items, pattern, minItems, uniqueItems).
type S = Record<string, any>;
function valid(s: S, v: any): boolean {
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) return false;
  if (s.type === "array" && !Array.isArray(v)) return false;
  if (s.type === "string" && typeof v !== "string") return false;
  if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
  if (s.required && !s.required.every((k: string) => k in v)) return false;
  if (s.additionalProperties === false && Object.keys(v).some((k) => !(k in (s.properties ?? {})))) return false;
  if (s.properties) for (const [k, sub] of Object.entries(s.properties)) if (k in v && !valid(sub as S, v[k])) return false;
  if (Array.isArray(v)) {
    if (s.minItems && v.length < s.minItems) return false;
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) return false;
    if (s.items && !v.every((x) => valid(s.items, x))) return false;
  }
  return true;
}

// Rejects network/secret/signaling/deployment content anywhere except the declared prohibition list and $schema.
const ALLOWED_KEYS = new Set(["vertoAllowed", "nativeAndroidSipAllowed", "credentialDelivery", "manifestContainsCredentials", "pbxConnectionAllowed", "prohibitedCapabilities"]);
const BAD = new RegExp(["https?:\\/\\/", "wss?:\\/\\/", "endpoint", "hostname", "pass" + "word", "tok" + "en", "api[_ ]?key", "\\bsip\\b", "ver" + "to", "fusion" + "pbx", "\\bpbx_", "deploy"].join("|"), "i");
function clean(v: any, key = ""): boolean {
  if (key === "prohibitedCapabilities" || key === "$schema") return true;
  if (key && !ALLOWED_KEYS.has(key) && BAD.test(key)) return false;
  if (typeof v === "string") return key === "$schema" || !BAD.test(v) || (key === "credentialDelivery");
  if (Array.isArray(v)) return v.every((x) => clean(x));
  if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => clean(x, k));
  return true;
}

describe("Lemtel Phase 19A — portal to client reconciliation contract (offline)", () => {
  it("Planiprêt isolation guard passes before validation", () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });

  it("the five files exist; schema and policy are valid", () => {
    for (const f of PHASE19A_FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    const s = json(SCHEMA), p = json(POLICY);
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(s.additionalProperties).toBe(false);
    expect(valid(s, p.reconciliationMatrix)).toBe(true);
    expect(valid(s, { ...p.reconciliationMatrix, extra: 1 })).toBe(false);
    expect(valid(s, { ...p.reconciliationMatrix, routingMode: "edge" })).toBe(false);
  });

  it("critical literals: offline, direct_current, all prohibitions false, own_extension_only", () => {
    const p = json(POLICY), m = p.reconciliationMatrix;
    for (const k of ["speakerAutoEnableAllowed", "vertoAllowed", "nativeAndroidSipAllowed", "pbxConnectionAllowed", "databaseApplyAllowed", "functionPublishAllowed", "clientModificationAllowed", "portalModificationAllowed", "edgeFeatureGate", "manifestContainsCredentials", "manifestContainsCallData"]) expect(p[k], k).toBe(false);
    expect(p.ownExtensionOnlyRequired).toBe(true);
    expect(m.executionMode).toBe("offline_contract_only");
    expect(m.routingMode).toBe("direct_current");
    expect(m.edgeFeatureGate).toBe(false);
    expect(m.credentialDelivery).toBe("separate_authenticated_server_flow");
    expect(m.reconciliationRules.every((r: any) => r.sensitiveDataTransported === false && r.authoritativeSource === "existing_lemtel_portal")).toBe(true);
    expect(m.reconciliationRules.find((r: any) => r.portalAction === "sip_secret_rotation").revisionConsequence).toBe("credentialRevisionRef");
  });

  it("schema and policy are clean; injected network/secret/signaling/deploy content is rejected", () => {
    const s = json(SCHEMA), p = json(POLICY);
    expect(clean(s)).toBe(true);
    expect(clean(p)).toBe(true);
    const inj = [{ u: "https://x.example" }, { endpoint: "a" }, { hostname: "h" }, { ["pass" + "word"]: "x" }, { ["tok" + "en"]: "x" }, { apiKey: "x" }, { x: "sip trunk" }, { x: "ver" + "to" }, { x: "fusion" + "pbx" }, { deployTarget: "prod" }];
    for (const i of inj) { expect(clean({ ...p, ...i }), JSON.stringify(i)).toBe(false); expect(clean({ ...s, ...i })).toBe(false); }
  });

  it("call history, recordings, voicemail, messages and devices are separate existing flows, never manifest data", () => {
    const d = json(POLICY).reconciliationMatrix.clientDataAccess;
    expect(d.map((x: any) => x.entity).sort()).toEqual(["call_history", "device", "message", "recording", "voicemail"]);
    for (const x of d) { expect(x.inManifest).toBe(false); expect(x.transport).toBe("existing_authorized_flow"); expect(x.privacyScope).toBe("own_extension_only"); }
    expect(read(DOC)).toMatch(/never copied into the manifest/);
  });

  it("four future consumers are declared and no client code changed", () => {
    expect(json(POLICY).reconciliationMatrix.clientRequiredFutureWork).toEqual(["mobile_manifest_consumer", "desktop_manifest_consumer", "portal_device_controls", "portal_mutation_revision_hook"]);
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    for (const c of [BASE, PHASE19A_END]) expect(g("cat-file", "-t", c).trim(), c).toBe("commit");
    expect(() => g("merge-base", "--is-ancestor", BASE, PHASE19A_END)).not.toThrow();
    const changed = [...new Set(g("diff", "--name-only", "--no-renames", `${BASE}..${PHASE19A_END}`).split("\n").filter(Boolean))].sort();
    expect(changed).toEqual(PHASE19A_FILES);
    expect(changed.filter((f) => /^apps\/|^src\/(pages|components|hooks|lib)\/|^supabase\//.test(f))).toEqual([]);
  });

  it("all documents state no migration applied and no function published", () => {
    for (const f of [DOC, THREAT]) expect(read(f)).toMatch(/No migration is applied and no function is published/);
  });

  it("real temporary Git repository: exact five-file scope passes; extra Lemtel or Planiprêt file fails", () => {
    const before = status();
    const scope = (extra: string[]) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p19a-"));
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      try {
        g("init", "-q");
        fs.writeFileSync(path.join(tmp, "README.md"), "b\n"); g("update-index", "--add", "README.md");
        const base = g("commit-tree", g("write-tree"), "-m", "base");
        for (const f of [...PHASE19A_FILES, ...extra]) { fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "x\n"); g("update-index", "--add", f); }
        const end = g("commit-tree", g("write-tree"), "-p", base, "-m", "p19a");
        const list = g("diff", "--name-only", "--no-renames", base, end).split("\n").filter(Boolean).sort();
        return JSON.stringify(list) === JSON.stringify(PHASE19A_FILES) && !list.some(isProtected);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    };
    expect(scope([])).toBe(true);
    expect(scope(["docs/lemtel-client-config/extra.md"])).toBe(false);
    expect(scope(["src/pages/planipret/X.tsx"])).toBe(false);
    expect(status()).toBe(before);
  }, 30000);

  it("Planiprêt isolation guard passes after validation", () => {
    expect(guard()).toBe("LEMTEL_ISOLATION_PASSED\n");
  });
});
