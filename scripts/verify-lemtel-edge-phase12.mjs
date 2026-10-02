import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Static, offline verifier. Only local Git inspection is executed; never Docker.
const BASE = "ca4c1fa61";
const USAGE = "P12_USAGE: [--base=ca4c1fa61]";
const D = "infra/lemtel-edge/phase12-closed";
export const DOCKERFILE = `${D}/Dockerfile`;
export const COMPOSE = `${D}/docker-compose.closed.yml`;
export const CFG = `${D}/kamailio.cfg`;
export const IGNORE = `${D}/.dockerignore`;
export const RUNNER = "scripts/run-lemtel-edge-phase12-closed.mjs";
export const SELF = "scripts/verify-lemtel-edge-phase12.mjs";
export const TEST = "src/test/lemtelEdgePhase12.test.ts";
export const DOC = "docs/lemtel-edge/phase-12-closed-local-runtime-test.md";
export const ALLOWED = [DOCKERFILE, COMPOSE, CFG, IGNORE, RUNNER, SELF, TEST, DOC];
export const GATES = ["edge_enabled", "sip_registration_enabled", "sip_proxy_enabled", "rtp_relay_enabled", "fusionpbx_upstream_enabled", "control_plane_events_enabled", "push_invite_events_enabled", "recording_enabled", "transcoding_enabled", "media_forking_enabled"];
const FORBIDDEN_TOOLS = /\b(rtpengine|redis|postgres|mysql|mariadb|sqlite|nodejs|npm|curl|wget|dnsutils|bind9|openssl|stunnel|websocat|fusionpbx|freeswitch|asterisk|pjsua|sipp|kamailio-[a-z0-9-]+-modules)\b/i;

export function gatesAllFalse(yaml) {
  const m = yaml.match(/^gates:\n((?:[ \t]+\S.*\n?)*)/m);
  if (!m) return false;
  const lines = m[1].split("\n").filter((l) => l.trim());
  return lines.length === 10 && GATES.every((g) => lines.some((l) => l.trim() === `${g}: false`));
}

export function checkDockerfile(t) {
  const lines = t.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const froms = lines.filter((l) => /^FROM\b/i.test(l));
  const installs = [...t.matchAll(/apt-get install -y --no-install-recommends ([^\\\n&]+)/g)].map((m) => m[1].trim().split(/\s+/));
  const users = lines.filter((l) => /^USER\b/.test(l));
  return froms.length === 1 && froms[0] === "FROM debian:12.12-slim"
    && installs.length === 1 && JSON.stringify([...installs[0]].sort()) === JSON.stringify(["kamailio", "python3-minimal"])
    && /apt-get install[\s\S]*?&& rm -rf \/var\/lib\/apt\/lists\/\*/.test(t)
    && /--uid 65532 --gid 65532/.test(t) && /--gid 65532 lemtelclosed/.test(t)
    && /^COPY --chown=root:root --chmod=0444 kamailio\.cfg \/opt\/lemtel-closed\/kamailio\.cfg$/m.test(t)
    && lines.filter((l) => /^(COPY|ADD)\b/.test(l)).length === 1
    && /^RUN kamailio -c -f \/opt\/lemtel-closed\/kamailio\.cfg$/m.test(t)
    && users.length === 1 && users[0] === "USER 65532:65532" && lines.indexOf(users[0]) > lines.findIndex((l) => l.startsWith("RUN kamailio -c"))
    && /^ENTRYPOINT \["kamailio", "-m", "32", "-M", "8", "-f", "\/opt\/lemtel-closed\/kamailio\.cfg"\]$/m.test(t)
    && lines[lines.length - 1].startsWith("ENTRYPOINT")
    && !/^(EXPOSE|CMD|VOLUME|ENV|ARG|ADD|HEALTHCHECK)\b/m.test(t)
    && !FORBIDDEN_TOOLS.test(t);
}

export function checkCfg(t) {
  const body = t.split("\n").filter((l) => !/^\s*#(?!!KAMAILIO)/.test(l)).join("\n");
  const listens = [...body.matchAll(/^\s*listen\s*=\s*(.+)$/gm)].map((m) => m[1].trim());
  const mods = [...body.matchAll(/loadmodule\s+"([^"]+)"/g)].map((m) => m[1]);
  const routes = [...body.matchAll(/^\s*([a-z_]*route)\b[^{]*\{/gm)].map((m) => m[1]);
  return /^#!KAMAILIO/.test(t)
    && /^fork=no$/m.test(body) && /^log_stderror=yes$/m.test(body) && /^dns=no$/m.test(body) && /^rev_dns=no$/m.test(body)
    && listens.length === 1 && listens[0] === "udp:127.0.0.1:5060"
    && mods.length === 1 && mods[0] === "sl.so" && !/modparam/.test(body)
    && routes.length === 1 && routes[0] === "request_route"
    && /request_route\s*\{\s*sl_send_reply\("503", "Lemtel Edge disabled"\);\s*exit;\s*\}/.test(body)
    && !/\b(t_relay|forward|rtpengine|auth|registrar|save|lookup|tls|websocket|xhttp|db_|redis|dispatcher|outbound|path|push|evapi|jsonrpc|ctl|rr|tm|usrloc|alias|advertise|include_file|import_file|tcp|sctp)\b/i.test(body.replace(/^#!KAMAILIO.*$/m, "").replace(/loadmodule "sl\.so"/, "").replace(/sl_send_reply\("503", "Lemtel Edge disabled"\)/, "").replace(/log_stderror=yes/, "").replace(/listen=udp:127\.0\.0\.1:5060/, ""));
}

export function checkCompose(y) {
  const forbidden = /^\s*(ports|networks|volumes|secrets|configs|env_file|environment|extra_hosts|dns|dns_search|privileged|cap_add|pid|ipc|devices|expose|links|external_links|userns_mode|cgroup_parent|sysctls)\s*:/m;
  if (forbidden.test(y) || /host/.test(y.replace(/^name:.*$/m, ""))) return false;
  const names = [...y.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((x) => x[1]);
  const req = [
    /^services:$/m, /^    image: lemtel-edge-phase12-closed:local$/m, /^    network_mode: "none"$/m, /^    user: "65532:65532"$/m,
    /^    read_only: true$/m, /^    cap_drop: \["ALL"\]$/m, /^    security_opt: \["no-new-privileges:true"\]$/m,
    /^    pids_limit: 64$/m, /^    mem_limit: 128m$/m, /^    restart: "no"$/m, /^      context: \.$/m, /^      dockerfile: Dockerfile$/m,
    /^    tmpfs:\n      - \/tmp\n      - \/run\n/m,
  ];
  return JSON.stringify(names) === JSON.stringify(["kamailio-closed"]) && req.every((r) => r.test(y));
}

export function checkIgnore(t) {
  return JSON.stringify(t.split("\n").map((l) => l.trim()).filter(Boolean)) === JSON.stringify(["*", "!Dockerfile", "!kamailio.cfg"]);
}

const DOCKER_CMDS = [
  '"compose", "-f", COMPOSE', '"build", "--pull"', '"up", "-d"', '"ps", "-q", SERVICE', '"inspect", "--type", "container", id',
  '"exec", "-T", SERVICE, "python3", "-c", RTP_ABSENT', '"exec", "-T", SERVICE, "python3", "-c", UDP_CHECK',
  '"down", "-v", "--remove-orphans"', '["image", "rm", "-f", IMAGE]', '"ps", "-a", "-q"', '["image", "inspect", IMAGE]',
];
export function checkRunner(t) {
  const shellish = new RegExp(["shell\\s*:\\s*true", "\\bexec\\s*\\(", "\\bexecSync\\s*\\(", "\\bspawn\\s*\\(", "\\bfork\\s*\\(", "fet" + "ch\\s*\\(", "node:(ht" + "tp|ht" + "tps|ne" + "t|dg" + "ram|dn" + "s|tl" + "s)", "Web" + "Socket", "\\.lis" + "ten\\s*\\(", "writeFile", "appendFile", "process\\.e" + "nv", "console\\.(log|error)", "fusionpbx(?!_upstream_enabled)", "control[-_ ]plane\\b(?! path)", "apns|fcm"].join("|"), "i");
  const procCalls = [...t.matchAll(/\b(execFileSync|spawnSync)\(\s*"([a-z]+)"/g)].map((m) => m[2]);
  return !shellish.test(t.replace(/control plane path exists/g, ""))
    && procCalls.length > 0 && procCalls.every((c) => c === "docker" || c === "git")
    && DOCKER_CMDS.every((c) => t.includes(c))
    && t.includes('const COMPOSE = "infra/lemtel-edge/phase12-closed/docker-compose.closed.yml";')
    && t.includes('const IMAGE = "lemtel-edge-phase12-closed:local";')
    && t.includes('const EXPECTED_STATUS = "SIP/2.0 503 Lemtel Edge disabled";')
    && /stdio: \["ignore", "ignore", "ignore"\]/.test(t)
    && /finally \{[\s\S]*cleanup\(\)/.test(t)
    && (t.match(/process\.stdout\.write\(/g) || []).length === 1
    && /s\.bind\(\('127\.0\.0\.1',0\)\)/.test(t) && /s\.sendto\(m,\('127\.0\.0\.1',5060\)\)/.test(t)
    && !/\b(?!127\.0\.0\.1\b)\d{1,3}(\.\d{1,3}){3}\b/.test(t);
}

export function checkDoc(t) {
  const fence = "`".repeat(3);
  const blocks = [...t.matchAll(new RegExp(fence + "(\\w*)\\n([\\s\\S]*?)" + fence, "g"))];
  return blocks.length === 1 && blocks[0][2].trim() === "node scripts/run-lemtel-edge-phase12-closed.mjs"
    && /does not run Docker/.test(t) && /no live integration/i.test(t) && /All ten gates remain false/.test(t)
    && /new written approval and a later phase/.test(t)
    && !new RegExp("h" + "ttps?://|\\b\\d{1,3}(\\.\\d{1,3}){3}\\b|:\\d{2,5}\\b|pass" + "word|tok" + "en|sec" + "ret", "i").test(t);
}

export function checkOtherSources(t) {
  return !new RegExp(["\\b(execFileSync|spawnSync)\\(\\s*\"docker\"", "shell\\s*:\\s*true", "\\bexecSync\\s*\\(", "\\bspawn\\s*\\("].join("|")).test(t);
}

export function classify(paths) {
  const f = new Set();
  for (const p of paths) {
    if (ALLOWED.includes(p)) continue;
    f.add("P12_SCOPE_EXACT");
    if (/^(schemas|docs|infra)\/lemtel-edge\/|verify-lemtel-edge-phase([2-9]|1[01])\b|lemtelEdgePhase([2-9]|1[01])\b/.test(p)) f.add("P12_EDGE_FROZEN");
    if (/lemtel-control-plane|lemtelControlPlane/.test(p)) f.add("P12_CONTROL_PLANE_FROZEN");
    if (/^(apps\/|supabase\/|src\/(pages|components|lib)\/|public\/|ios\/|android\/|capacitor|package)|planipret|lemtel-uc|deploy/i.test(p)) f.add("P12_PROTECTED_PATHS");
  }
  return [...f];
}

export function changedSinceBase(root) {
  const git = (a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    git(["cat-file", "-e", `${BASE}^{commit}`]);
    const changed = git(["diff", "--name-only", BASE]).split("\n").filter(Boolean);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", D, ...ALLOWED.filter((p) => !p.startsWith(D))]).split("\n").filter(Boolean);
    return { ok: true, changed: [...new Set([...changed, ...untracked])], untrackedOutside: untracked.filter((p) => !ALLOWED.includes(p)) };
  } catch { return { ok: false, changed: [], untrackedOutside: [] }; }
}

export function verifyPhase12(args, root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  if (args.length > 1 || (args.length === 1 && !/^--base=[0-9a-f]{7,40}$/.test(args[0]))) return { code: 2, stdout: USAGE + "\n" };
  if (args[0] && args[0] !== `--base=${BASE}`) return { code: 1, stdout: "P12_FAILED: P12_BASE_ATTESTATION\n" };
  const fail = new Set();
  const rd = (p) => readFileSync(join(root, p), "utf8");
  if (!ALLOWED.every((p) => existsSync(join(root, p)))) return out(new Set(["P12_FILES_PRESENT"]), args);
  const h = changedSinceBase(root);
  if (!h.ok) fail.add("P12_GIT_HISTORY");
  for (const c of classify(h.changed)) fail.add(c);
  if (h.untrackedOutside.length) fail.add("P12_UNTRACKED");
  if (!checkDockerfile(rd(DOCKERFILE))) fail.add("P12_DOCKERFILE");
  if (!checkCfg(rd(CFG))) fail.add("P12_KAMAILIO_CFG");
  if (!checkCompose(rd(COMPOSE))) fail.add("P12_COMPOSE");
  if (!checkIgnore(rd(IGNORE))) fail.add("P12_DOCKERIGNORE");
  if (!checkRunner(rd(RUNNER))) fail.add("P12_RUNNER");
  if (!checkDoc(rd(DOC))) fail.add("P12_DOC");
  for (const s of [SELF, TEST]) if (!checkOtherSources(rd(s))) fail.add("P12_DOCKER_ONLY_IN_RUNNER");
  try { if (!gatesAllFalse(rd("infra/lemtel-edge/policy/edge-feature-gates.yaml"))) fail.add("P12_GATES_FALSE"); } catch { fail.add("P12_GATES_FALSE"); }
  return out(fail, args);
}

function out(fail, args) {
  if (fail.size) return { code: 1, stdout: [...fail].sort().map((f) => `P12_FAILED: ${f}`).join("\n") + "\n" };
  return { code: 0, stdout: args[0] ? `P12_PASSED (attested base ${BASE})\n` : "P12_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = verifyPhase12(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
