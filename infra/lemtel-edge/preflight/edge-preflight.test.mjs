import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const TOOL = join(here, "edge-preflight.mjs");
const { runPreflight } = await import(pathToFileURL(TOOL).href);

const FILES = [
  "infra/lemtel-edge/config/kamailio.cfg", "infra/lemtel-edge/config/kamailio-local.cfg", "infra/lemtel-edge/config/kamailio-tls.cfg.example",
  "infra/lemtel-edge/config/rtpengine.conf", "infra/lemtel-edge/config/rtpengine-local.conf",
  "infra/lemtel-edge/policy/edge-network-policy.yaml", "infra/lemtel-edge/policy/edge-feature-gates.yaml", "infra/lemtel-edge/edge.env.example",
  "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", "schemas/lemtel-edge/registration-health-v1.schema.json", "schemas/lemtel-edge/invite-push-v1.schema.json",
  "infra/lemtel-edge/preflight/expected-policy.json",
];
const fingerprint = () => createHash("sha256").update(FILES.map((f) => readFileSync(join(repo, f))).join("\0")).digest("hex");
const before = fingerprint();

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), "edge-preflight-"));
  for (const f of FILES) { mkdirSync(dirname(join(root, f)), { recursive: true }); copyFileSync(join(repo, f), join(root, f)); }
  return root;
};
const edit = (root, f, fn) => writeFileSync(join(root, f), fn(readFileSync(join(root, f), "utf8")));
const withSandbox = (fn) => { const root = sandbox(); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const FAKE_IP = ["10", "20", "30", "40"].join(".");
const onlyIds = (out) => out.trim().split("\n").every((l) => /^PRECHECK_FAILED: [A-Z0-9_]+$/.test(l));

test("committed package verifies and report has the exact allowed shape", () => {
  assert.deepEqual(runPreflight(["--verify"], repo), { code: 0, stdout: "PRECHECK_PASSED\n" });
  const r = runPreflight(["--report"], repo);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ["phase", "result", "runtime", "phase1_docker_runtime", "inputs", "checks"]);
  assert.deepEqual(Object.keys(j.inputs), ["kamailio_cfg_sha256", "rtpengine_cfg_sha256", "edge_policy_sha256", "event_schema_bundle_sha256"]);
  assert.equal(j.phase, 3); assert.equal(j.result, "static_preflight_passed"); assert.equal(j.runtime, "not_started"); assert.equal(j.phase1_docker_runtime, "pending");
  assert.deepEqual(j.checks, [...j.checks].sort());
  for (const c of j.checks) assert.match(c, /^[A-Z0-9_]+$/);
  assert.doesNotMatch(r.stdout, /127\.0\.0\.1|rtpengine:|Lemtel Edge disabled|\/|LEMTEL_EDGE_/);
});

test("hashes are lowercase sha256 and deterministic", () => {
  const a = JSON.parse(runPreflight(["--report"], repo).stdout);
  for (const v of Object.values(a.inputs)) assert.match(v, /^[0-9a-f]{64}$/);
  withSandbox((root) => assert.deepEqual(JSON.parse(runPreflight(["--report"], root).stdout), a));
});

test("a gate set to true fails with a stable ID only", () => withSandbox((root) => {
  edit(root, "infra/lemtel-edge/policy/edge-feature-gates.yaml", (s) => s.replace("edge_enabled: false", "edge_enabled: true"));
  const r = runPreflight(["--verify"], root);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "PRECHECK_FAILED: EDGE_GATES_ALL_FALSE\n");
}));

test("non-loopback listener or RTPengine binding fails without exposing the value", () => {
  withSandbox((root) => {
    edit(root, "infra/lemtel-edge/config/kamailio.cfg", (s) => s.replace("listen=udp:127.0.0.1:5060", `listen=udp:${FAKE_IP}:5060`));
    const r = runPreflight(["--verify"], root);
    assert.equal(r.code, 1); assert.ok(onlyIds(r.stdout)); assert.match(r.stdout, /KAMAILIO_LISTENER_LOOPBACK_GUARDED/); assert.doesNotMatch(r.stdout, new RegExp(FAKE_IP.replaceAll(".", "\\.")));
  });
  withSandbox((root) => {
    edit(root, "infra/lemtel-edge/config/rtpengine.conf", (s) => s.replace("listen-ng = 127.0.0.1:2223", `listen-ng = ${FAKE_IP}:2223`));
    const r = runPreflight(["--verify"], root);
    assert.equal(r.code, 1); assert.equal(r.stdout, "PRECHECK_FAILED: RTPENGINE_MAIN_BINDINGS\n");
  });
});

test("extra or sensitive schema property fails", () => {
  withSandbox((root) => {
    edit(root, "schemas/lemtel-edge/invite-push-v1.schema.json", (s) => { const j = JSON.parse(s); j.properties.caller_number = { type: "string" }; return JSON.stringify(j); });
    const r = runPreflight(["--verify"], root);
    assert.equal(r.code, 1); assert.ok(onlyIds(r.stdout)); assert.match(r.stdout, /PAYLOAD_OPAQUE_REFS/);
  });
  withSandbox((root) => {
    edit(root, "schemas/lemtel-edge/edge-event-envelope-v1.schema.json", (s) => { const j = JSON.parse(s); j.additionalProperties = true; j.properties.extra = {}; return JSON.stringify(j); });
    const r = runPreflight(["--verify"], root);
    assert.equal(r.code, 1); assert.match(r.stdout, /SCHEMAS_NO_ADDITIONAL_PROPERTIES/); assert.match(r.stdout, /ENVELOPE_CONTRACT/);
  });
});

test("a value in the env example fails without displaying it", () => withSandbox((root) => {
  const marker = "Zq9xPlaceholderValue";
  edit(root, "infra/lemtel-edge/edge.env.example", (s) => s.replace("LEMTEL_EDGE_INSTANCE_ID=", `LEMTEL_EDGE_INSTANCE_ID=${marker}`));
  const r = runPreflight(["--verify"], root);
  assert.equal(r.code, 1); assert.equal(r.stdout, "PRECHECK_FAILED: ENV_EXAMPLE_BLANK\n"); assert.ok(!r.stdout.includes(marker));
}));

test("invalid arguments exit 2", () => {
  for (const a of [[], ["--write"], ["--verify", "--report"], ["report"]]) assert.equal(runPreflight(a, repo).code, 2);
});

test("tool imports only safe built-ins and never writes files", () => {
  const src = readFileSync(TOOL, "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const m of imports) assert.ok(["node:fs", "node:path", "node:crypto", "node:process", "node:util"].includes(m), m);
  assert.doesNotMatch(src, /import\s*\(|require\(|child_process|node:(net|dgram|http|https|tls|worker_threads|cluster)|\bfetch\(|WebSocket|spawn|exec(File)?(Sync)?\(|writeFile|appendFile|mkdir|createWriteStream|rmSync|unlink|rename|copyFile|process\.env|^#!/m);
  assert.equal(readdirSync(here).filter((n) => /report/i.test(n)).length, 0);
  assert.equal(fingerprint(), before);
});
