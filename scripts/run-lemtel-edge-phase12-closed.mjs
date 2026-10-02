// Lemtel Edge Phase 12 - closed local Kamailio runner.
// Run manually by the user only, after review: node scripts/run-lemtel-edge-phase12-closed.mjs
// Argument arrays only, no shell. Prints exactly one redacted JSON report to stdout.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const COMPOSE = "infra/lemtel-edge/phase12-closed/docker-compose.closed.yml";
const IMAGE = "lemtel-edge-phase12-closed:local";
const SERVICE = "kamailio-closed";
const GATES_FILE = "infra/lemtel-edge/policy/edge-feature-gates.yaml";
const FILES = [
  "infra/lemtel-edge/phase12-closed/Dockerfile",
  COMPOSE,
  "infra/lemtel-edge/phase12-closed/kamailio.cfg",
  "infra/lemtel-edge/phase12-closed/.dockerignore",
  "scripts/run-lemtel-edge-phase12-closed.mjs",
  "scripts/verify-lemtel-edge-phase12.mjs",
  "src/test/lemtelEdgePhase12.test.ts",
  "docs/lemtel-edge/phase-12-closed-local-runtime-test.md",
];
const GATES = ["edge_enabled", "sip_registration_enabled", "sip_proxy_enabled", "rtp_relay_enabled", "fusionpbx_upstream_enabled", "control_plane_events_enabled", "push_invite_events_enabled", "recording_enabled", "transcoding_enabled", "media_forking_enabled"];
const EXPECTED_STATUS = "SIP/2.0 503 Lemtel Edge disabled";

// In-container synthetic UDP check. Loopback only; prints nothing; exit status is the only signal.
const UDP_CHECK = [
  "import socket,sys",
  "s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)",
  "s.bind(('127.0.0.1',0))",
  "s.settimeout(3)",
  "p=s.getsockname()[1]",
  "m=('OPTIONS sip:closed@127.0.0.1:5060 SIP/2.0\\r\\nVia: SIP/2.0/UDP 127.0.0.1:%d;branch=z9hG4bKclosed1\\r\\nMax-Forwards: 1\\r\\nTo: <sip:closed@127.0.0.1>\\r\\nFrom: <sip:probe@127.0.0.1>;tag=closed1\\r\\nCall-ID: closed-1\\r\\nCSeq: 1 OPTIONS\\r\\nContent-Length: 0\\r\\n\\r\\n'%p).encode()",
  "s.sendto(m,('127.0.0.1',5060))",
  "d=s.recv(4096).decode('utf-8','replace')",
  `sys.exit(0 if d.split('\\r\\n',1)[0]==${JSON.stringify(EXPECTED_STATUS)} else 1)`,
].join("\n");
const RTP_ABSENT = "import shutil,sys\nsys.exit(1 if shutil.which('rtpengine') or shutil.which('rtpengine-ctl') else 0)";

export function report(result, failureCode, s = {}) {
  const nr = "not_run";
  return {
    schemaVersion: "closed_local_edge_runtime_report_v1",
    result,
    configSyntax: s.configSyntax ?? nr,
    closedResponse: s.closedResponse ?? nr,
    externalEgress: s.externalEgress ?? nr,
    upstreamConnection: s.upstreamConnection ?? nr,
    controlPlaneConnection: s.controlPlaneConnection ?? nr,
    mediaRelay: s.mediaRelay ?? nr,
    featureGates: "all_false",
    cleanup: s.cleanup ?? nr,
    failureCode,
  };
}

export function gatesAllFalse(yaml) {
  const m = yaml.match(/^gates:\n((?:[ \t]+\S.*\n?)*)/m);
  if (!m) return false;
  const lines = m[1].split("\n").filter((l) => l.trim());
  return lines.length === 10 && GATES.every((g) => lines.some((l) => l.trim() === `${g}: false`));
}

export function composeHardened(y) {
  const forbidden = /^\s*(ports|networks|volumes|secrets|configs|env_file|environment|extra_hosts|dns|dns_search|privileged|cap_add|pid|ipc|devices|expose|links|external_links|userns_mode|cgroup_parent|sysctls)\s*:/m;
  if (forbidden.test(y) || /network_mode:\s*"?host/.test(y)) return false;
  const services = y.match(/^services:\n((?:(?:  |\n).*\n?)*)/m);
  if (!services) return false;
  const names = [...services[1].matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((x) => x[1]);
  const required = [
    /^    image: lemtel-edge-phase12-closed:local$/m, /^    network_mode: "none"$/m, /^    user: "65532:65532"$/m,
    /^    read_only: true$/m, /^    cap_drop: \["ALL"\]$/m, /^    security_opt: \["no-new-privileges:true"\]$/m,
    /^    pids_limit: 64$/m, /^    mem_limit: 128m$/m, /^    restart: "no"$/m, /^      context: \.$/m, /^      dockerfile: Dockerfile$/m,
    /^    tmpfs:\n      - \/tmp\n      - \/run\n/m,
  ];
  return names.length === 1 && names[0] === SERVICE && required.every((r) => r.test(y));
}

const QUIET = { stdio: ["ignore", "ignore", "ignore"] };
const run = (args) => spawnSync("docker", args, QUIET).status === 0;
const read = (args) => {
  try { return execFileSync("docker", args, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim(); } catch { return null; }
};
const compose = (...a) => ["compose", "-f", COMPOSE, ...a];

export function inspectOk(info) {
  const hc = info?.HostConfig ?? {};
  const ports = info?.NetworkSettings?.Ports ?? {};
  const nets = info?.NetworkSettings?.Networks ?? {};
  return info?.State?.Running === true
    && hc.NetworkMode === "none"
    && Object.values(ports).every((v) => !v || v.length === 0)
    && (!hc.PortBindings || Object.keys(hc.PortBindings).length === 0)
    && Object.keys(nets).every((n) => n === "none")
    && info?.Config?.User === "65532:65532"
    && hc.ReadonlyRootfs === true
    && Array.isArray(hc.SecurityOpt) && hc.SecurityOpt.includes("no-new-privileges:true")
    && Array.isArray(hc.CapDrop) && hc.CapDrop.includes("ALL")
    && (!hc.CapAdd || hc.CapAdd.length === 0)
    && hc.Privileged === false
    && (!info.Mounts || info.Mounts.length === 0)
    && (!hc.Binds || hc.Binds.length === 0);
}

function cleanup() {
  run(compose("down", "-v", "--remove-orphans"));
  run(["image", "rm", "-f", IMAGE]);
  const left = read(compose("ps", "-a", "-q"));
  const imageGone = spawnSync("docker", ["image", "inspect", IMAGE], QUIET).status !== 0;
  return left === "" && imageGone;
}

export function main() {
  const s = {};
  let ok = false;
  let started = false;
  try {
    if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], QUIET).status !== 0) throw 0;
    if (!FILES.every((f) => existsSync(f))) throw 0;
    if (!gatesAllFalse(readFileSync(GATES_FILE, "utf8"))) throw 0;
    if (!composeHardened(readFileSync(COMPOSE, "utf8"))) throw 0;
    started = true;
    if (!run(compose("build", "--pull"))) { s.configSyntax = "failed"; throw 0; }
    s.configSyntax = "passed"; // the image build runs the Kamailio syntax check
    if (!run(compose("up", "-d"))) throw 0;
    const id = read(compose("ps", "-q", SERVICE));
    if (!id || !/^[0-9a-f]{12,64}$/.test(id)) throw 0;
    const raw = read(["inspect", "--type", "container", id]);
    let info; try { info = JSON.parse(raw)[0]; } catch { throw 0; }
    if (!inspectOk(info)) throw 0;
    // network_mode none: no egress, no upstream, no control plane path exists.
    s.externalEgress = "blocked"; s.upstreamConnection = "blocked"; s.controlPlaneConnection = "blocked";
    if (!run(compose("exec", "-T", SERVICE, "python3", "-c", RTP_ABSENT))) { s.mediaRelay = "failed"; throw 0; }
    s.mediaRelay = "blocked";
    if (!run(compose("exec", "-T", SERVICE, "python3", "-c", UDP_CHECK))) { s.closedResponse = "failed"; throw 0; }
    s.closedResponse = "passed";
    ok = true;
  } catch {
    ok = false;
  } finally {
    s.cleanup = started ? (cleanup() ? "passed" : "failed") : "not_run";
  }
  let r;
  if (s.cleanup === "failed") r = report("failed", "cleanup_failed", s);
  else if (ok) r = report("passed", "none", s);
  else r = report("failed", "local_validation_failed", s);
  process.stdout.write(JSON.stringify(r) + "\n");
  return r.result === "passed" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
