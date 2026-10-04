// Lemtel Phase 29B — local contract test for recording audio authorization.
// Reads the proxy source only: no HTTP, no database, no PBX, no Storage, no credential.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function slice(from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  assert(a > -1 && b > a, `block not found: ${from}`);
  return src.slice(a, b);
}

const helper = slice("async function canReadCallRecording(", "function getPbxFileBases()");
const getRec = slice('if (action === "get-recording") {', "const probeUrls");
const signed = slice('if (action === "get-recording-signed-url") {', "const selfRes = await fetch");
const FORBID = 'return json({ error: "Forbidden", message: "Recording is outside the signed-in user extension scope" }, 403);';

Deno.test("both audio actions use the same dedicated access check", () => {
  assert(getRec.includes("canReadCallRecording("));
  assert(signed.includes("canReadCallRecording("));
});

Deno.test("missing CDR id for a user call cannot reach reads or signed URL", () => {
  assert(/if \(isServiceCall\) return true;\s*if \(!userId\) return false;[\s\S]*if \(!cdrId\) return false;/.test(helper));
  // Unconditional checks (not gated on the id being present).
  assert(getRec.includes("if (!(await canReadCallRecording(xml_cdr_uuid ? String(xml_cdr_uuid) : null)))"));
  assert(signed.includes("if (!(await canReadCallRecording(signedXmlCdrUuid ? String(signedXmlCdrUuid) : null)))"));
  // In get-recording the check precedes the 400 parameter check and any fetch.
  const iCheck = getRec.indexOf("canReadCallRecording(");
  assert(iCheck < getRec.indexOf("required\" }, 400)"));
  assert(!getRec.slice(0, iCheck).includes("fetch("));
  // In signed-url the check precedes the service-role self-call.
  assert(signed.indexOf("canReadCallRecording(") < signed.indexOf("selfBody"));
});

Deno.test("CDR is resolved by pbx_uuid, then by id when UUID-shaped", () => {
  const iPbx = helper.indexOf('.eq("pbx_uuid", cdrId)');
  const iId = helper.indexOf('.eq("id", cdrId)');
  assert(iPbx > -1 && iId > iPbx);
  assert(helper.includes("[0-9a-f]{8}-[0-9a-f]{4}"));
});

Deno.test("user access requires portal_user_id + organization_id + CDR extension", () => {
  assert(helper.includes('.from("pbx_softphone_users")'));
  assert(helper.includes('.eq("portal_user_id", userId)'));
  assert(helper.includes('.eq("organization_id", record.organization_id)'));
  assert(helper.includes('.eq("extension", recordExtension)'));
  assert(helper.includes("if (!recordExtension) return false;"));
});

Deno.test("no admin / org role / org member bypass in the helper", () => {
  for (const bad of ["is_lemtel_admin", "org_members", "is_lemtel_member", '"owner"', '"admin"', "role"]) {
    assertEquals(helper.includes(bad), false, bad);
  }
});

Deno.test("client-supplied values never take part in the decision", () => {
  for (const bad of ["params", "body.", "organization_id ==", "domain_uuid", "domain_name", "record_path", "record_name", "local_recording_url"]) {
    assertEquals(helper.includes(bad), false, bad);
  }
});

Deno.test("service-role is the only bypass", () => {
  const returnsTrue = helper.match(/return true;/g) || [];
  assertEquals(returnsTrue.length, 1);
  assert(helper.includes("if (isServiceCall) return true;"));
});

Deno.test("both refusals are generic 403 without CDR/PBX data", () => {
  assert(getRec.includes(FORBID));
  assert(signed.includes(FORBID));
  assertEquals(helper.includes("console.warn(\"recording access lookup failed:\""), false);
});
