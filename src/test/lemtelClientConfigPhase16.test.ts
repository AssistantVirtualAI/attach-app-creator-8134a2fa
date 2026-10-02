import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(__dirname, "../..");
const BASE = "f23191c71";
const SCHEMA = "schemas/lemtel-client-config/lemtel-client-config-manifest-v1.schema.json";
const POLICY = "schemas/lemtel-client-config/lemtel-client-config-policy-v1.json";
const FILES = [SCHEMA, POLICY, "docs/lemtel-client-config/phase-16-portal-client-contract.md", "docs/lemtel-client-config/phase-16-threat-model.md", "src/test/lemtelClientConfigPhase16.test.ts"];
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const guard = async () => await import(/* @vite-ignore */ pathToFileURL(path.join(root, "scripts/verify-lemtel-planipret-isolation.mjs")).href);

// Paths differing from base: committed + staged/unstaged + untracked.
const changed = (cwd: string, base: string) => {
  const out = git(cwd, "diff", "--name-only", "--no-renames", base) + git(cwd, "ls-files", "--others", "--exclude-standard");
  return [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
};
const scopeOk = (paths: string[], isProtected: (p: string) => boolean) => paths.every((p) => FILES.includes(p)) && !paths.some(isProtected);

// Minimal strict validator for the subset used by the schema.
const validate = (s: any, v: any): boolean => {
  if ("const" in s) return v === s.const;
  if (s.enum) return s.enum.includes(v);
  if (s.type === "boolean") return typeof v === "boolean";
  if (s.type === "string") return typeof v === "string" && (!s.pattern || new RegExp(s.pattern).test(v));
  if (s.type === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    if (Object.keys(v).some((k) => !(k in s.properties))) return false;
    return s.required.every((k: string) => k in v) && Object.entries(v).every(([k, x]) => validate(s.properties[k], x));
  }
  return false;
};
const objects = (s: any, at = "$"): [string, any][] => s.type === "object" ? [[at, s], ...Object.entries(s.properties ?? {}).flatMap(([k, x]) => objects(x, `${at}.${k}`))] : [];
const names = (s: any): string[] => Object.entries(s.properties ?? {}).flatMap(([k, x]) => [k, ...names(x)]);
const FORBIDDEN = ["password", "secret", "token", "authorization", "apikey", "host", "hostname", "url", "recordingurl", "audiourl", "transcript", "phonenumber", "endpoint", "uri", "ip", "address"];
const isForbiddenName = (k: string) => { const n = k.toLowerCase().replace(/[^a-z]/g, ""); return FORBIDDEN.some((f) => n === f || n.endsWith(f)); };
const deepKeys = (v: any): string[] => v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...deepKeys(x)]) : [];

const SAFE = {
  schemaVersion: "lemtel_client_config_manifest_v1",
  identity: { organizationRef: "org_ref_0001", domainRef: "dom_ref_0001", extensionRef: "ext_ref_0001", userRef: "usr_ref_0001", privacyScope: "own_extension_only" },
  access: { mobileEnabled: true, desktopEnabled: false, accountState: "active", signInMode: "portal_password" },
  revision: { manifestRevision: "rev_0001", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z", refreshMode: "foreground_and_revision_check", revocationBehavior: "stop_sip_and_clear_local_session" },
  device: { deviceRef: "dev_ref_0001", deviceState: "approved", deviceRevision: "devrev_0001", deviceAction: "none" },
  telephonyPolicy: { credentialRevisionRef: "credrev_0001", dndState: "disabled", forwardingState: "disabled", recordingPolicy: "not_allowed", voicemailPolicy: "enabled", callsPrivacyScope: "own_extension_only", recordingsPrivacyScope: "own_extension_only", voicemailPrivacyScope: "own_extension_only", transcriptsPrivacyScope: "own_extension_only" },
  routing: { routingMode: "direct_current", routingAssignmentRef: "route_ref_0001", fallbackMode: "direct_current", edgeFeatureGate: false },
  capabilities: { maestroSyncState: "disabled", avaCallActionState: "disabled", avaSmsActionState: "disabled", microsoftSsoState: "not_ready" },
  observability: { diagnosticLevel: "error_only", redactionPolicyRef: "redact_ref_0001", supportBundleAllowed: false },
};
const POLICY_EXPECTED = {
  schemaVersion: "lemtel_client_config_policy_v1", defaultPrivacyScope: "own_extension_only", extensionAdminBypassAllowed: false, privateCallDataCrossExtensionAllowed: false,
  recordingAudioCrossExtensionAllowed: false, transcriptCrossExtensionAllowed: false, credentialDelivery: "separate_authenticated_server_flow", directRouteIsCurrentDefault: true,
  edgeRouteEnabled: false, vertoAllowed: false, speakerAutoEnableAllowed: false, repeatedFullPageReloadAllowed: false, aiDuplicateProcessingAllowed: false,
  maestroEventsExecutable: false, avaActionsExecutable: false,
};
const policyOk = (p: any) => typeof p === "object" && p !== null
  && JSON.stringify(Object.keys(p).sort()) === JSON.stringify([...Object.keys(POLICY_EXPECTED), "backgroundRefreshMinimumIntervalSeconds"].sort())
  && Object.entries(POLICY_EXPECTED).every(([k, v]) => p[k] === v)
  && Number.isInteger(p.backgroundRefreshMinimumIntervalSeconds) && p.backgroundRefreshMinimumIntervalSeconds >= 300 && p.backgroundRefreshMinimumIntervalSeconds <= 86400;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("Lemtel Phase 16 — portal-to-client configuration contract", () => {
  it("only the five Phase 16 paths differ from the base, none Planiprêt-protected (permanent guard matcher)", async () => {
    const { isProtected } = await guard();
    const paths = changed(root, BASE);
    expect(paths.every((p) => FILES.includes(p)), paths.join(",")).toBe(true);
    expect(paths.some(isProtected)).toBe(false);
  });

  it("scope rule rejects extra and Planiprêt paths in a real temporary Git repository", async () => {
    const { isProtected } = await guard();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p16-"));
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const put = (p: string) => { fs.mkdirSync(path.join(tmp, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), "x\n"); };
    try {
      g("init", "-q"); put("README.md"); g("update-index", "--add", "README.md");
      const base = g("commit-tree", g("write-tree"), "-m", "base"); g("update-ref", "HEAD", base);
      for (const p of FILES) put(p);
      expect(scopeOk(changed(tmp, base), isProtected)).toBe(true);
      put("apps/ava-softphone-mobile/src/App.tsx");
      expect(scopeOk(changed(tmp, base), isProtected)).toBe(false);
      fs.rmSync(path.join(tmp, "apps"), { recursive: true });
      put("src/pages/planipret/X.tsx");
      const paths = changed(tmp, base);
      expect(scopeOk(paths, isProtected)).toBe(false);
      expect(paths.some(isProtected)).toBe(true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it("every schema object is strict", () => {
    const s = read(SCHEMA);
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const objs = objects(s);
    expect(objs.length).toBe(9);
    for (const [at, o] of objs) {
      expect(o.additionalProperties, at).toBe(false);
      expect([...o.required].sort(), at).toEqual(Object.keys(o.properties).sort());
    }
  });

  it("mandatory sections, fields, enums and literals exist", () => {
    const P = read(SCHEMA).properties;
    expect(P.schemaVersion.const).toBe("lemtel_client_config_manifest_v1");
    expect(Object.keys(P).sort()).toEqual(["access", "capabilities", "device", "identity", "observability", "revision", "routing", "schemaVersion", "telephonyPolicy"]);
    const en = (sec: string, k: string) => P[sec].properties[k].enum;
    expect(P.identity.properties.privacyScope.const).toBe("own_extension_only");
    expect(en("access", "accountState")).toEqual(["active", "suspended", "disabled"]);
    expect(en("access", "signInMode")).toEqual(["portal_password", "microsoft_sso", "portal_password_or_microsoft_sso"]);
    expect(en("revision", "refreshMode")).toEqual(["foreground_and_revision_check", "manual_only", "disabled"]);
    expect(en("revision", "revocationBehavior")).toEqual(["stop_sip_and_clear_local_session", "require_reauthentication"]);
    expect(en("device", "deviceState")).toEqual(["approved", "pending", "revoked"]);
    expect(en("device", "deviceAction")).toEqual(["none", "refresh_required", "revoke_required"]);
    expect(en("telephonyPolicy", "recordingPolicy")).toEqual(["not_allowed", "user_allowed", "portal_managed"]);
    for (const k of ["callsPrivacyScope", "recordingsPrivacyScope", "voicemailPrivacyScope", "transcriptsPrivacyScope"]) expect(P.telephonyPolicy.properties[k].const).toBe("own_extension_only");
    expect(en("routing", "routingMode")).toEqual(["direct_current", "edge_not_authorized", "edge_not_ready", "edge_denied", "edge_assigned"]);
    expect(P.routing.properties.fallbackMode.const).toBe("direct_current");
    expect(P.routing.properties.edgeFeatureGate.const).toBe(false);
    expect(en("capabilities", "avaSmsActionState")).toEqual(["disabled", "not_ready", "requires_user_confirmation"]);
    expect(en("capabilities", "microsoftSsoState")).toEqual(["disabled", "not_ready", "ready"]);
    expect(en("observability", "diagnosticLevel")).toEqual(["off", "error_only", "standard"]);
    expect(read(SCHEMA).description).toMatch(/configuration labels only/);
  });

  it("schema has no prohibited sensitive property names and no URI/host format", () => {
    const s = read(SCHEMA);
    const bad = names(s).filter(isForbiddenName);
    expect(bad).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/"format"\s*:\s*"(uri|hostname|ipv4|ipv6|email)/);
    for (const k of ["sipPassword", "apiKey", "edgeHost", "recordingUrl", "audio_url", "phoneNumber", "pbxEndpoint", "Authorization", "transcript"]) expect(isForbiddenName(k), k).toBe(true);
  });

  it("policy has exact keys and literals", () => {
    const p = read(POLICY);
    expect(policyOk(p)).toBe(true);
    for (const b of [{ ...p, extra: 1 }, { ...p, vertoAllowed: true }, { ...p, backgroundRefreshMinimumIntervalSeconds: 2 }, { ...p, edgeRouteEnabled: true }, { ...p, extensionAdminBypassAllowed: true }]) expect(policyOk(b)).toBe(false);
  });

  it("safe fixture validates with opaque placeholders only", () => {
    expect(validate(read(SCHEMA), SAFE)).toBe(true);
    expect(deepKeys(SAFE).filter(isForbiddenName)).toEqual([]);
    const values = JSON.stringify(Object.values(SAFE).flatMap((o) => (typeof o === "object" ? Object.values(o) : [o])));
    expect(values).not.toMatch(/@|https?|\/\/|\d{7,}|\.[a-z]{2,}/i);
  });

  it("unsafe fixtures are rejected", () => {
    const s = read(SCHEMA);
    const muts: ((m: any) => void)[] = [
      (m) => (m.identity.privacyScope = "organization"),
      (m) => (m.telephonyPolicy.recordingsPrivacyScope = "domain"),
      (m) => (m.routing.edgeFeatureGate = true),
      (m) => (m.routing.fallbackMode = "edge_assigned"),
      (m) => (m.capabilities.avaSmsActionState = "execute"),
      (m) => (m.vertoAllowed = true),
      (m) => (m.speakerAutoEnableAllowed = true),
      (m) => (m.capabilities.avaActionsExecutable = true),
      (m) => (m.routing.edgeHost = "edge.example.invalid"),
      (m) => (m.telephonyPolicy.sipPassword = "x"),
      (m) => (m.identity.extensionRef = "sip.example.invalid:5060"),
      (m) => (m.revision.expiresAt = "tomorrow"),
      (m) => delete m.device,
    ];
    for (const mut of muts) { const m = clone(SAFE); mut(m); expect(validate(s, m), mut.toString()).toBe(false); }
    for (const b of [{ ...read(POLICY), speakerAutoEnableAllowed: true }, { ...read(POLICY), avaActionsExecutable: true }, { ...read(POLICY), maestroEventsExecutable: true }]) expect(policyOk(b)).toBe(false);
  });

  it("documents cover the required statements and threats", () => {
    const c = fs.readFileSync(path.join(root, FILES[2]), "utf8"), t = fs.readFileSync(path.join(root, FILES[3]), "utf8");
    for (const x of ["authoritative", "separate authenticated server-side path", "Direct routing", "configuration label", "increment", "duplicate SIP client", "manual user choice", "even for organization and domain administrators", "Phase 17"]) expect(c, x).toContain(x);
    for (const x of ["secret exposure", "Cross-extension", "revoked device", "expired manifest", "local session", "Edge routing", "Verto", "Duplicate SIP", "Unbounded refresh", "AVA call/SMS", "unknown JSON properties"]) expect(t, x).toContain(x);
  });

  it("does not modify the real repository state", () => {
    const before = git(root, "status", "--porcelain");
    changed(root, BASE);
    expect(git(root, "status", "--porcelain")).toBe(before);
  });
});
