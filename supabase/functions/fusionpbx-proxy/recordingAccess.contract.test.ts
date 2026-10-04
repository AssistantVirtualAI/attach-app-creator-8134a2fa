// Lemtel Phases 29B / 29B.1 — local contract test for recording audio authorization
// and server-authoritative read metadata. Reads the proxy source only:
// no HTTP, no database, no PBX, no Storage, no credential.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const desktop = await Deno.readTextFile(new URL("../../../apps/ava-softphone-desktop/src/lib/avaApi.ts", import.meta.url));

function slice(from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  assert(a > -1 && b > a, `block not found: ${from}`);
  return src.slice(a, b);
}

const helper = slice("async function resolveAuthorizedRecording(", "function serverRecordingParams(");
const normalizer = slice("function serverRecordingParams(", "function getPbxFileBases()");
const getRec = slice('if (action === "get-recording") {', 'required" }, 400);') + 'required" }, 400);';
const signedHead = slice('if (action === "get-recording-signed-url") {', "const selfRes = await fetch");
const signed = slice('if (action === "get-recording-signed-url") {', "// ---- Voicemail CRUD ----");
const FORBID = 'return json({ error: "Forbidden", message: "Recording is outside the signed-in user extension scope" }, 403);';
const CLIENT_META = ["record_path", "recording_path", "record_name", "recording_name", "domain_uuid", "domain_name", "recorded_at", "start_at", "local_recording_url", "organization_id"];

Deno.test("both audio actions share the authorized resolution and server normalizer", () => {
  assert(getRec.includes("await resolveAuthorizedRecording("));
  assert(signedHead.includes("await resolveAuthorizedRecording("));
  assert(getRec.includes("serverRecordingParams(recAccess.record)"));
  assert(signedHead.includes("serverRecordingParams(signedAccess.record)"));
  assertEquals(src.includes("canReadCallRecording"), false);
});

Deno.test("Phase 29C Desktop sends only a CDR identifier; the server supplies read metadata", () => {
  assert(desktop.includes("params: { xml_cdr_uuid, expires_in: expiresInSec },"));
  assert(desktop.includes("body: JSON.stringify({ action: 'get-recording', params: { xml_cdr_uuid } })"));
  const signedClient = desktop.slice(desktop.indexOf("getRecordingSignedUrl: async"), desktop.indexOf("getRecordingAudioUrl: async"));
  const binaryClient = desktop.slice(desktop.indexOf("getRecordingAudioUrl: async"), desktop.indexOf("  domains: async"));
  for (const block of [signedClient, binaryClient]) {
    assert(block.includes("if (!xml_cdr_uuid || !authToken) return null;"));
    assertEquals(/recording\.(?:recording_url|recording_path|recording_name|record_path|record_name|organization_id|domain_uuid|domain_name)/.test(block), false);
  }
  assert(getRec.includes("recordingParams = serverRecordingParams(recAccess.record);"));
  assert(signedHead.includes("const userReadParams = isServiceCall ? null : serverRecordingParams(signedAccess.record);"));
});

Deno.test("missing/unauthorized CDR refused before PBX, Storage or self-call", () => {
  assert(/if \(isServiceCall\) return \{ allowed: true, record: null \};\s*if \(!userId\) return DENY;[\s\S]*if \(!cdrId\) return DENY;/.test(helper));
  const iG = getRec.indexOf("if (!recAccess.allowed)");
  assert(iG > -1 && getRec.slice(iG, iG + 200).includes(FORBID));
  assert(iG < getRec.indexOf('required" }, 400)'));
  assert(!getRec.slice(0, iG).includes("fetch("));
  const iS = signedHead.indexOf("if (!signedAccess.allowed)");
  assert(iS > -1 && signedHead.slice(iS, iS + 200).includes(FORBID));
  assert(iS < signedHead.indexOf("selfBody"));
  assert(!signedHead.slice(0, iS).includes("storage"));
});

Deno.test("CDR resolved by pbx_uuid, then by UUID id; full server select", () => {
  const iPbx = helper.indexOf('.eq("pbx_uuid", cdrId)');
  const iId = helper.indexOf('.eq("id", cdrId)');
  assert(iPbx > -1 && iId > iPbx);
  assert(helper.includes("[0-9a-f]{8}-[0-9a-f]{4}"));
  assert(helper.includes('"id, pbx_uuid, organization_id, extension, recording_path, recording_name, recording_url, domain_uuid, domain_name, start_at"'));
});

Deno.test("user–organization–extension match stays mandatory", () => {
  assert(helper.includes('.from("pbx_softphone_users")'));
  assert(helper.includes('.eq("portal_user_id", userId)'));
  assert(helper.includes('.eq("organization_id", record.organization_id)'));
  assert(helper.includes('.eq("extension", recordExtension)'));
  assert(helper.includes("if (!recordExtension) return DENY;"));
  assert(helper.includes("return softphoneRows?.length ? { allowed: true, record } : DENY;"));
});

Deno.test("client values take no part in decision nor in user read params", () => {
  // The server-side select string is excluded: it names DB columns, not client input.
  const decision = helper.replace(/const recordSelect = "[^"]*";/, "");
  for (const bad of ["params", "body.", "domain_name", "domain_uuid", "record_path", "record_name", "local_recording_url"]) {
    assertEquals(decision.includes(bad), false, bad);
  }
  // Normalizer is pure and only reads `record`.
  for (const bad of ["await", "admin.", "fetch(", "params", "body", "clientParams", "signedParams"]) {
    assertEquals(normalizer.includes(bad), false, bad);
  }
  // User branch in get-recording is a replacement, not a merge.
  const userBranch = getRec.slice(getRec.indexOf("} else {"), getRec.indexOf("const { record_path"));
  assert(userBranch.includes("recordingParams = serverRecordingParams(recAccess.record);"));
  assertEquals(/\.\.\.\s*clientParams|clientParams\./.test(userBranch), false);
  // Destructuring reads only the replaced object.
  assert(getRec.includes("} = recordingParams;"));
  for (const k of CLIENT_META) assertEquals(new RegExp(`clientParams\\.${k}\\b`).test(getRec), false, k);
});

Deno.test("both paths read path/name/domain/date/id from the server CDR", () => {
  for (const [k, f] of [["xml_cdr_uuid", "record?.pbx_uuid || record?.id"], ["record_path", "record?.recording_path"], ["record_name", "record?.recording_name"], ["domain_uuid", "record?.domain_uuid"], ["domain_name", "record?.domain_name"], ["recorded_at", "record?.start_at"], ["local_recording_url", "record?.recording_url"], ["organization_id", "record?.organization_id"]]) {
    assert(normalizer.includes(`put("${k}", ${f});`), k);
  }
  assert(signed.includes('String(readParams.record_name || "")'));
});

Deno.test("signed-url self-call receives server params only for a user", () => {
  assert(signedHead.includes('? { action: "get-recording", organization_id: userReadParams.organization_id, params: userReadParams }'));
  assert(signedHead.includes("const userReadParams = isServiceCall ? null : serverRecordingParams(signedAccess.record);"));
});

Deno.test("user audit uses org and resource id from the authorized CDR", () => {
  assert(signed.includes("const auditOrgId = userReadParams ? signedAccess.record.organization_id : organization_id;"));
  assert(signed.includes("const auditResourceId = userReadParams ? (userReadParams.xml_cdr_uuid || null)"));
  assert(signed.includes("organization_id: auditOrgId,"));
  assert(signed.includes("resource_id: auditResourceId,"));
});

Deno.test("service-role is the only bypass and keeps internal compatibility", () => {
  assertEquals((helper.match(/allowed: true/g) || []).length, 2);
  assert(helper.includes("if (isServiceCall) return { allowed: true, record: null };"));
  assert(getRec.includes("if (isServiceCall) {\n        recordingParams = { ...clientParams"));
});

Deno.test("no admin / role / member / client domain or org bypass", () => {
  for (const bad of ["is_lemtel_admin", "org_members", "is_lemtel_member", '"owner"', '"admin"', "role"]) {
    assertEquals(helper.includes(bad), false, bad);
  }
  assertEquals(helper.includes('console.warn("recording access lookup failed:"'), false);
});
