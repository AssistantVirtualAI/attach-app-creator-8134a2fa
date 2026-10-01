// Lemtel Edge Phase 3 offline preflight. Static local integrity gate only.
// Reads fixed committed inputs, prints stable check IDs or a compact report, writes nothing.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";

const DEFAULT_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const INPUTS = {
  kamailio_cfg: "infra/lemtel-edge/config/kamailio.cfg",
  kamailio_local: "infra/lemtel-edge/config/kamailio-local.cfg",
  kamailio_tls: "infra/lemtel-edge/config/kamailio-tls.cfg.example",
  rtpengine_main: "infra/lemtel-edge/config/rtpengine.conf",
  rtpengine_local: "infra/lemtel-edge/config/rtpengine-local.conf",
  network_policy: "infra/lemtel-edge/policy/edge-network-policy.yaml",
  feature_gates: "infra/lemtel-edge/policy/edge-feature-gates.yaml",
  env_example: "infra/lemtel-edge/edge.env.example",
  schema_envelope: "schemas/lemtel-edge/edge-event-envelope-v1.schema.json",
  schema_registration: "schemas/lemtel-edge/registration-health-v1.schema.json",
  schema_invite: "schemas/lemtel-edge/invite-push-v1.schema.json",
};
const POLICY = "infra/lemtel-edge/preflight/expected-policy.json";
const PACKAGE_DIR = "infra/lemtel-edge";
const HASH_GROUPS = {
  kamailio_cfg_sha256: ["kamailio_cfg", "kamailio_local", "kamailio_tls"],
  rtpengine_cfg_sha256: ["rtpengine_main", "rtpengine_local"],
  edge_policy_sha256: ["network_policy", "feature_gates", "env_example"],
  event_schema_bundle_sha256: ["schema_envelope", "schema_registration", "schema_invite"],
};

const activeLines = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && (!l.startsWith("#") || l.startsWith("#!")));
const confValues = (s) => {
  const out = {};
  for (const l of activeLines(s)) { const m = l.match(/^([a-z-]+)\s*=\s*(\S+)$/); if (m) (out[m[1]] ??= []).push(m[2]); }
  return out;
};
const FORBIDDEN_CALL = /\b(t_relay|forward|rtpengine_(offer|answer|manage|delete)|save|lookup|www_authorize|proxy_authorize|auth_check|http_client_query|http_async_query|rest_[a-z_]+|curl_[a-z_]+|sql_query|ds_select|dns_[a-z_]+|record_route|ws_handle_handshake)\s*\(/;
const FORBIDDEN_MODULE = /loadmodule\s+"(registrar|usrloc|auth[a-z_]*|http_client|http_async_client|rest_client|db_[a-z]+|sqlops|dispatcher|evapi|jsonrpcs)\.so"/;
const KEY_MARKER = new RegExp("-----" + "BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)" + "-----");
const RUNTIME_FILE = /^(Dockerfile.*|.*docker-compose.*|compose\.ya?ml|Containerfile|.*\.(sh|service|socket|timer))$/i;
const KEY_FILE = /\.(pem|key|crt|cer|csr|p12|pfx|der)$/i;

const walkNames = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walkNames(join(d, e.name)) : [e.name]) : [];

function evaluate(root) {
  const src = {};
  for (const [id, p] of Object.entries(INPUTS)) { try { src[id] = readFileSync(join(root, p), "utf8"); } catch { src[id] = null; } }
  let policy;
  try { policy = JSON.parse(readFileSync(join(root, POLICY), "utf8")); } catch { return { failed: ["EXPECTED_POLICY_READABLE"], src, policy: null }; }
  const failed = new Set();
  const check = (id, fn) => { let ok = false; try { ok = fn() === true; } catch { ok = false; } if (!ok) failed.add(id); };
  const K = policy.kamailio;

  check("EDGE_GATES_ALL_FALSE", () => {
    const entries = [...src.feature_gates.matchAll(/^\s+([a-z_]+):\s*(\S+)\s*$/gm)].map((m) => [m[1], m[2]]);
    const names = entries.map(([n]) => n).sort();
    return JSON.stringify(names) === JSON.stringify([...policy.feature_gates].sort()) && entries.every(([, v]) => v === "false");
  });
  check("NETWORK_DEFAULT_DENY", () => /^default:\s*deny\s*$/m.test(src.network_policy));
  check("NETWORK_PHASE2_STATE", () => policy.network_phase2_state.every((k) => new RegExp(`^\\s+${k}:\\s*true\\s*$`, "m").test(src.network_policy)));

  const kam = activeLines(src.kamailio_cfg);
  const kamText = kam.join("\n");
  check("KAMAILIO_CORS_DISABLED", () => {
    const m = [...kamText.matchAll(/modparam\("websocket",\s*"cors_mode",\s*(\d+)\)/g)];
    return m.length === 1 && m[0][1] === K.cors_mode;
  });
  check("KAMAILIO_RTPENGINE_SOCK", () => {
    const m = [...kamText.matchAll(/modparam\("rtpengine",\s*"rtpengine_sock",\s*"([^"]*)"\)/g)];
    return m.length === 1 && m[0][1] === K.rtpengine_sock;
  });
  check("KAMAILIO_STATIC_503_ONLY", () => {
    const route = kamText.match(/request_route\s*\{([^}]*)\}/);
    if (!route) return false;
    const body = route[1].split("\n").map((l) => l.trim()).filter(Boolean);
    const replies = [...kamText.matchAll(/sl_send_reply\("(\d+)",\s*"([^"]*)"\)/g)];
    return body.length === 2 && body[0] === `sl_send_reply("503", "${K.disabled_reason}");` && body[1] === "exit;" && replies.every((r) => r[1] === "503" && r[2] === K.disabled_reason);
  });
  check("KAMAILIO_NO_FORBIDDEN_BEHAVIOUR", () => !FORBIDDEN_CALL.test(kamText) && !FORBIDDEN_MODULE.test(kamText) && !/Access-Control-Allow-Origin|"\*"/i.test(kamText) && !new RegExp("open" + "sips", "i").test(kamText));
  check("KAMAILIO_LISTENER_LOOPBACK_GUARDED", () => {
    for (let i = 0; i < kam.length; i++) {
      if (!/^listen\s*=/.test(kam[i])) continue;
      if (!/^listen\s*=\s*(udp|tcp|tls|ws|wss):127\.0\.0\.1:\d+$/.test(kam[i])) return false;
      if (kam[i - 1] !== `#!ifdef ${K.listener_guard}`) return false;
    }
    return true;
  });
  const rtpOk = (s) => { const v = confValues(s); return Object.entries(policy.rtpengine).every(([k, want]) => (v[k] ?? []).length > 0 && v[k].every((x) => x === want)) && !Object.keys(v).some((k) => /^(listen-(http|https|cli|tcp-ng|tcp)|redis|recording-|graphite|advertised|transcode|codec-)/.test(k)); };
  check("RTPENGINE_MAIN_BINDINGS", () => rtpOk(src.rtpengine_main));
  check("RTPENGINE_LOCAL_BINDINGS", () => rtpOk(src.rtpengine_local));

  const envLines = src.env_example.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  check("ENV_EXAMPLE_BLANK", () => envLines.every((l) => /^[A-Z0-9_]+=$/.test(l)));
  check("ENV_EXAMPLE_ALLOWED_SET", () => JSON.stringify(envLines.map((l) => l.split("=")[0]).sort()) === JSON.stringify([...policy.env_names].sort()));

  const schemas = {};
  check("SCHEMAS_DRAFT_2020_12", () => ["schema_envelope", "schema_registration", "schema_invite"].every((id) => { schemas[id] = JSON.parse(src[id]); return schemas[id].$schema === policy.schema_draft; }));
  const objectsClosed = (n) => !n || typeof n !== "object" || (n.type !== "object" || n.additionalProperties === false) && Object.values(n).every((v) => typeof v !== "object" || objectsClosed(v));
  check("SCHEMAS_NO_ADDITIONAL_PROPERTIES", () => Object.keys(schemas).length === 3 && Object.values(schemas).every(objectsClosed));
  check("ENVELOPE_CONTRACT", () => {
    const e = schemas.schema_envelope;
    return JSON.stringify([...e.required].sort()) === JSON.stringify(policy.envelope_required)
      && JSON.stringify(Object.keys(e.properties).sort()) === JSON.stringify(policy.envelope_required)
      && e.properties.version.const === "v1"
      && JSON.stringify([...e.properties.event_type.enum].sort()) === JSON.stringify(policy.event_types);
  });
  const names = (n, acc = []) => { if (n && typeof n === "object") { if (n.properties) acc.push(...Object.keys(n.properties)); for (const v of Object.values(n)) names(v, acc); } return acc; };
  check("PAYLOAD_OPAQUE_REFS", () => ["schema_registration", "schema_invite"].every((id) => {
    const s = schemas[id];
    return policy.required_refs.every((r) => s.required.includes(r) && /^\^\[A-Za-z0-9_-\]\{\d+,\d+\}\$$/.test(s.properties[r].pattern ?? ""));
  }) && Object.values(schemas).every((s) => names(s).every((k) => !policy.prohibited_property_fragments.some((f) => k.toLowerCase().includes(f)) && k.toLowerCase() !== "ip")));

  const pkgNames = walkNames(join(root, PACKAGE_DIR));
  check("PACKAGE_NO_RUNTIME_ARTIFACTS", () => !pkgNames.some((n) => RUNTIME_FILE.test(n)));
  check("PACKAGE_NO_KEY_MATERIAL", () => !pkgNames.some((n) => KEY_FILE.test(n)) && Object.values(src).every((s) => s !== null && !KEY_MARKER.test(s)));

  if (Object.values(src).some((s) => s === null)) failed.add("INPUTS_PRESENT");
  if (JSON.stringify([...policy.checks].sort()) !== JSON.stringify([...evaluatedIds].sort())) failed.add("EXPECTED_CHECK_SET");
  return { failed: [...failed].sort(), src, policy };
}
const evaluatedIds = new Set(["EDGE_GATES_ALL_FALSE", "ENVELOPE_CONTRACT", "ENV_EXAMPLE_ALLOWED_SET", "ENV_EXAMPLE_BLANK", "KAMAILIO_CORS_DISABLED", "KAMAILIO_LISTENER_LOOPBACK_GUARDED", "KAMAILIO_NO_FORBIDDEN_BEHAVIOUR", "KAMAILIO_RTPENGINE_SOCK", "KAMAILIO_STATIC_503_ONLY", "NETWORK_DEFAULT_DENY", "NETWORK_PHASE2_STATE", "PACKAGE_NO_KEY_MATERIAL", "PACKAGE_NO_RUNTIME_ARTIFACTS", "PAYLOAD_OPAQUE_REFS", "RTPENGINE_LOCAL_BINDINGS", "RTPENGINE_MAIN_BINDINGS", "SCHEMAS_DRAFT_2020_12", "SCHEMAS_NO_ADDITIONAL_PROPERTIES"]);

const groupHash = (src, ids) => { const h = createHash("sha256"); for (const id of ids) { const b = Buffer.from(src[id], "utf8"); h.update(`${id}\n${b.length}\n`); h.update(b); } return h.digest("hex"); };

export function runPreflight(argv, root = DEFAULT_ROOT) {
  if (argv.length !== 1 || !["--verify", "--report"].includes(argv[0])) return { code: 2, stdout: "PRECHECK_USAGE: --verify | --report\n" };
  const { failed, src, policy } = evaluate(root);
  if (failed.length) return { code: 1, stdout: failed.map((id) => `PRECHECK_FAILED: ${id}`).join("\n") + "\n" };
  if (argv[0] === "--verify") return { code: 0, stdout: "PRECHECK_PASSED\n" };
  const report = {
    phase: 3,
    result: "static_preflight_passed",
    runtime: "not_started",
    phase1_docker_runtime: "pending",
    inputs: Object.fromEntries(Object.entries(HASH_GROUPS).map(([k, ids]) => [k, groupHash(src, ids)])),
    checks: [...policy.checks].sort(),
  };
  return { code: 0, stdout: JSON.stringify(report) + "\n" };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { code, stdout } = runPreflight(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exitCode = code;
}
