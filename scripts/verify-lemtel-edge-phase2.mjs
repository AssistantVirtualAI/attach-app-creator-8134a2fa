#!/usr/bin/env node
// Static checks for the Lemtel Edge Phase 2 offline package.
// Usage: node scripts/verify-lemtel-edge-phase2.mjs --invariants | --historical-acceptance
//   --invariants              frozen Phase 2 safety invariants against the checked-out package; no git diff.
//   --historical-acceptance   same invariants + scope proof on the immutable range 224da47b7..cc28b5a80 only.
// Never prints file contents. Makes no network request and starts no process other than git.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const USAGE = "Usage: node scripts/verify-lemtel-edge-phase2.mjs --invariants | --historical-acceptance";
const args = process.argv.slice(2);
if (args.length !== 1 || !["--invariants", "--historical-acceptance"].includes(args[0])) { console.error(USAGE); process.exit(2); }
const MODE = args[0];
const HISTORICAL_FROM = "224da47b7";
const HISTORICAL_TO = "cc28b5a80";
const fail = [];
const walk = (d) => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];
const rel = (f) => relative(root, f);
const read = (p) => readFileSync(join(root, p), "utf8");

const REQUIRED = [
  "infra/lemtel-edge/README.md", "infra/lemtel-edge/.gitignore", "infra/lemtel-edge/edge.env.example",
  "infra/lemtel-edge/config/kamailio.cfg", "infra/lemtel-edge/config/kamailio-local.cfg", "infra/lemtel-edge/config/kamailio-tls.cfg.example",
  "infra/lemtel-edge/config/rtpengine.conf", "infra/lemtel-edge/config/rtpengine-local.conf",
  "infra/lemtel-edge/policy/edge-network-policy.yaml", "infra/lemtel-edge/policy/edge-feature-gates.yaml",
  "docs/lemtel-edge/phase-2-architecture.md", "docs/lemtel-edge/security-boundaries.md", "docs/lemtel-edge/future-deployment-prerequisites.md",
  "docs/lemtel-edge/edge-control-plane-contract.md", "docs/lemtel-edge/local-validation-plan.md", "docs/lemtel-edge/operator-checklist.md",
  "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", "schemas/lemtel-edge/registration-health-v1.schema.json", "schemas/lemtel-edge/invite-push-v1.schema.json",
];
for (const f of REQUIRED) if (!existsSync(join(root, f))) fail.push(`missing ${f}`);

// 1-2. Path boundaries (historical mode only, immutable range, never moving HEAD)
if (MODE === "--historical-acceptance") {
  let changed = null;
  try { changed = execFileSync("git", ["diff", "--name-only", `${HISTORICAL_FROM}..${HISTORICAL_TO}`, "--", "."], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
  catch { fail.push("historical commits unavailable"); }
  if (changed) {
    const ALLOWED = /^(infra\/lemtel-edge\/|docs\/lemtel-edge\/|schemas\/lemtel-edge\/|scripts\/verify-lemtel-edge-phase2\.mjs$|src\/test\/lemtelEdgePhase2\.test\.ts$)/;
    for (const f of new Set(changed)) if (!ALLOWED.test(f)) fail.push(`path outside Phase 2 allowlist changed: ${f}`);
  }
}

const pkg = [...walk(join(root, "infra/lemtel-edge")), ...walk(join(root, "docs/lemtel-edge")), ...walk(join(root, "schemas/lemtel-edge"))];
const files = pkg.map((f) => [rel(f), readFileSync(f, "utf8")]);

// 3. Secrets and identifying data
const SECRET = [
  [/-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/, "private key or certificate"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})/, "API key"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
  [/(\+\d{10,15}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b)/, "phone number"],
  [/\b(?:[a-z0-9-]+\.)+(com|net|org|io|ca|dev|app|cloud|co|us|fr)\b/i, "hostname or domain"],
  [/(sip|pbx|auth|db)_?pass(word)?\s*[=:]\s*\S/i, "SIP/PBX password"],
];
for (const [f, s] of files) {
  for (const [re, label] of SECRET) if (re.test(s.replaceAll("https://json-schema.org/draft/2020-12/schema", ""))) fail.push(`${label} in ${f}`);
  for (const m of s.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) if (m[1] !== "127") fail.push(`non-loopback IP in ${f}`);
}
for (const line of read("infra/lemtel-edge/edge.env.example").split("\n").filter(Boolean)) {
  const [k, ...v] = line.split("=");
  if (!/^LEMTEL_EDGE_(INSTANCE_ID|EVENT_HMAC_KEY|TLS_CERT_PATH|TLS_KEY_PATH|ALLOWED_ORIGINS|FUSIONPBX_UPSTREAM)$/.test(k)) fail.push(`edge.env.example: unexpected variable ${k}`);
  if (v.join("=").trim()) fail.push(`edge.env.example: ${k} must be blank`);
}

// 4. No runtime / deployment mechanism
for (const f of pkg.map(rel)) if (/(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml|[^/]+\.(sh|service))$/i.test(f)) fail.push(`executable runtime file ${f}`);
const RUNTIME = /docker\s+(compose|run|build)\b|\bcurl\b|\bwget\b|\bnc\s+-|\btelnet\b|\bsipp\b|\bsipsak\b|^\s*(sudo\s+)?(kamailio|rtpengine)\s+-|\b(iptables|ufw|nft|firewall-cmd|systemctl|ssh|scp|rsync|kubectl|terraform|ansible)\s/im;
for (const [f, s] of files) if (RUNTIME.test(s)) fail.push(`runtime/deployment command in ${f}`);

// 5-7. Active Kamailio configuration
const active = (s) => s.split("\n").filter((l) => { const t = l.trim(); return t && (!t.startsWith("#") || t.startsWith("#!")); }).join("\n");
const kam = active(read("infra/lemtel-edge/config/kamailio.cfg"));
const FORBIDDEN_ROUTE = /\b(t_relay|forward|rtpengine_(offer|answer|manage|delete)|save|lookup|www_authorize|proxy_authorize|auth_check|http_client_query|http_async_query|rest_[a-z_]+|curl_[a-z_]+|sql_query|ds_select|dns_|record_route|ws_handle_handshake|add_path|handle_ruri_alias)\s*\(/;
if (FORBIDDEN_ROUTE.test(kam)) fail.push("active Kamailio route contains forwarding/registration/auth/RTPengine/HTTP/DB/DNS behaviour");
if (/loadmodule\s+"(registrar|usrloc|auth[a-z_]*|http_client|http_async_client|rest_client|db_[a-z]+|sqlops|dispatcher|evapi|jsonrpcs)\.so"/.test(kam)) fail.push("active Kamailio config loads a forbidden module");
const cors = kam.match(/modparam\("websocket",\s*"cors_mode",\s*(\d+)\)/);
if (!cors || cors[1] !== "0") fail.push("websocket cors_mode must be 0");
if (/Access-Control-Allow-Origin|"\*"/i.test(kam)) fail.push("wildcard CORS in active Kamailio config");
if (!/modparam\("rtpengine",\s*"rtpengine_sock",\s*"udp:rtpengine:2223"\)/.test(kam)) fail.push("rtpengine_sock must be udp:rtpengine:2223");
for (const m of kam.matchAll(/^\s*listen\s*=\s*(\S+)/gm)) if (!/:127\.0\.0\.1:/.test(m[1])) fail.push("non-loopback listener in active Kamailio config");
const listenLines = kam.split("\n").map((l) => l.trim());
const li = listenLines.findIndex((l) => l.startsWith("listen="));
if (li >= 0 && !(listenLines[li - 1] ?? "").startsWith("#!ifdef")) fail.push("loopback listener must be disabled by default (#!ifdef)");
if (!/request_route\s*\{\s*sl_send_reply\("503",\s*"Lemtel Edge disabled"\);\s*exit;\s*\}/.test(kam)) fail.push("request_route must only return 503 Lemtel Edge disabled");
const allPhase2 = files.map(([, s]) => s).join("\n");
if (/opensips|asterisk|\bturn server\b|coturn|caddy|nginx/i.test(files.filter(([f]) => f.startsWith("infra/")).map(([, s]) => active(s)).join("\n"))) fail.push("alternative Edge implementation selected");
for (const [f, s] of files) if (f.endsWith(".conf")) {
  const a = active(s);
  for (const k of ["recording-dir", "recording-method", "redis", "listen-http", "listen-https", "listen-cli", "listen-tcp-ng", "graphite", "advertised", "transcode", "codec-transcode"]) if (new RegExp(`^\\s*${k}`, "mi").test(a)) fail.push(`${f}: forbidden RTPengine option ${k}`);
  const ng = a.match(/^\s*listen-ng\s*=\s*(\S+)/m); if (!ng || !ng[1].startsWith("127.0.0.1:")) fail.push(`${f}: listen-ng must be loopback`);
  for (const m of a.matchAll(/^\s*interface\s*=\s*(\S+)/gm)) if (m[1] !== "127.0.0.1") fail.push(`${f}: non-loopback interface`);
  const ft = a.match(/^\s*final-timeout\s*=\s*(\S+)/m); if (!ft || ft[1] !== "0") fail.push(`${f}: final-timeout must be 0`);
}

// 8. Feature gates
const gates = read("infra/lemtel-edge/policy/edge-feature-gates.yaml");
const NEEDED = ["edge_enabled", "sip_registration_enabled", "sip_proxy_enabled", "rtp_relay_enabled", "fusionpbx_upstream_enabled", "control_plane_events_enabled", "push_invite_events_enabled", "recording_enabled", "transcoding_enabled", "media_forking_enabled"];
const found = Object.fromEntries([...gates.matchAll(/^\s+([a-z_]+):\s*(\S+)/gm)].map((m) => [m[1], m[2]]));
for (const g of NEEDED) if (found[g] !== "false") fail.push(`gate ${g} must be false`);
for (const [g, v] of Object.entries(found)) if (v !== "false") fail.push(`gate ${g} is not false`);

// 9. Network policy
const net = read("infra/lemtel-edge/policy/edge-network-policy.yaml");
if (!/^default:\s*deny$/m.test(net)) fail.push("network policy must default to deny");
for (const k of ["offline", "no_listener", "no_public_ingress", "no_fusionpbx_egress", "no_control_plane_egress", "no_media_relay"]) if (!new RegExp(`^\\s+${k}:\\s*true$`, "m").test(net)) fail.push(`network policy missing ${k}: true`);

// 10. Schemas
const PROHIBITED = /pass(word)?|secret|token|credential|uri|^ip$|ip_?addr|domain|host|user_?agent|caller|callee|number|phone|email|name|recording|voicemail|message|transcript|cdr|sip|pbx|error/i;
const checkSchema = (node, file, path = "$") => {
  if (!node || typeof node !== "object") return;
  if (node.type === "object" && node.additionalProperties !== false) fail.push(`${file}: ${path} allows additional properties`);
  if (node.properties) for (const k of Object.keys(node.properties)) if (PROHIBITED.test(k)) fail.push(`${file}: prohibited field ${k}`);
  for (const [k, v] of Object.entries(node)) if (typeof v === "object") checkSchema(v, file, `${path}.${k}`);
};
for (const f of ["edge-event-envelope-v1", "registration-health-v1", "invite-push-v1"]) {
  try {
    const s = JSON.parse(read(`schemas/lemtel-edge/${f}.schema.json`));
    if (s.$schema !== "https://json-schema.org/draft/2020-12/schema") fail.push(`${f}: must be draft 2020-12`);
    checkSchema(s, f);
  } catch { fail.push(`${f}: invalid JSON`); }
}
try {
  const env = JSON.parse(read("schemas/lemtel-edge/edge-event-envelope-v1.schema.json"));
  if (JSON.stringify(env.required.slice().sort()) !== JSON.stringify(["edge_instance_ref", "event_id", "event_type", "occurred_at", "payload", "version"])) fail.push("envelope required fields mismatch");
  if (env.properties.version?.const !== "v1") fail.push("envelope version must be v1");
} catch { /* reported above */ }

// 11-12. Documentation
for (const [f, s] of files) if (f.startsWith("docs/") || f.endsWith("README.md")) {
  if (/\b(is|are)\s+(now\s+)?(deployed|running|live)\b(?![^.]*\bnot\b)|production-ready|working call|certificate (was |is )?issued|integrated with FusionPBX|push (is )?integrated/i.test(s.replace(/No service runs[^.]*\./g, ""))) fail.push(`${f}: claims deployment/running service`);
}
for (const f of ["infra/lemtel-edge/README.md", "docs/lemtel-edge/phase-2-architecture.md", "docs/lemtel-edge/local-validation-plan.md", "docs/lemtel-edge/future-deployment-prerequisites.md"]) {
  if (!/Phase 1 Docker runtime (validation|test|gate)[^\n]*pending/i.test(read(f))) fail.push(`${f}: must state the Phase 1 Docker runtime gate is pending`);
}
const arch = read("docs/lemtel-edge/phase-2-architecture.md");
for (const m of arch.matchAll(/-->\|([^|]*)\||-\.->\|([^|]*)\|/g)) if (!/future \/ disabled/.test(m[1] ?? m[2])) fail.push("architecture link not labelled future / disabled");
if (/luc-edge/.test(allPhase2)) fail.push("Phase 2 package must not reference luc-edge");

if (fail.length) { console.error(`✗ Lemtel Edge Phase 2 verification failed (${fail.length}):`); for (const f of fail) console.error(` - ${f}`); process.exit(1); }
console.log(MODE === "--invariants" ? "✓ Lemtel Edge Phase 2 invariants passed" : "✓ Lemtel Edge Phase 2 historical acceptance passed");
