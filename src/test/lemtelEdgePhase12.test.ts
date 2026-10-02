import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const BASE = "ca4c1fa61";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const imp = async (p: string) => import(/* @vite-ignore */ pathToFileURL(path.join(root, p)).href);
const v12 = () => imp("scripts/verify-lemtel-edge-phase12.mjs");
const v11 = () => imp("scripts/verify-lemtel-edge-phase11.mjs");
const runner = () => imp("scripts/run-lemtel-edge-phase12-closed.mjs");

describe("Lemtel Edge phase 12A — closed local Kamailio package (static only)", () => {
  it("verifier CLI outputs", async () => {
    const { verifyPhase12 } = await v12();
    expect(verifyPhase12([])).toEqual({ code: 0, stdout: "P12_PASSED\n" });
    expect(verifyPhase12([`--base=${BASE}`])).toEqual({ code: 0, stdout: `P12_PASSED (attested base ${BASE})\n` });
    expect(verifyPhase12(["--base=abcdef1"])).toEqual({ code: 1, stdout: "P12_FAILED: P12_BASE_ATTESTATION\n" });
    for (const a of [["--x"], ["--base=zz"], [`--base=${BASE}`, "y"]]) expect(verifyPhase12(a)).toEqual({ code: 2, stdout: "P12_USAGE: [--base=ca4c1fa61]\n" });
  });

  it("relocation: old paths absent, targets present, exact historical and relocation ranges", async () => {
    const m = await v12();
    expect(m.ALLOWED).toHaveLength(8);
    expect(m.PHASE12A_BASE).toBe("ca4c1fa61");
    expect(m.PHASE12A_END).toBe("fce12a2b2");
    expect(m.PHASE12_RELOCATION_BASE).toBe("fce12a2b2");
    for (const p of m.OLD_RUNTIME) expect(fs.existsSync(path.join(root, p)), p).toBe(false);
    expect(m.OLD_RUNTIME).toHaveLength(5);
    for (const p of m.ALLOWED) expect(fs.existsSync(path.join(root, p)), p).toBe(true);
    for (const p of m.ALLOWED) expect(p.startsWith("infra/lemtel-edge/") || p.startsWith("docs/lemtel-edge/")).toBe(false);
    const h = m.history(root);
    expect(h.ok).toBe(true);
    expect(h.original).toEqual([...m.ORIGINAL].sort());
    expect(h.relocation).toEqual(m.EXPECTED_RELOCATION);
    expect(h.relocation.filter((l: string) => l.startsWith("D\t"))).toHaveLength(5);
    expect(h.relocation.filter((l: string) => l.startsWith("A\t"))).toHaveLength(5);
    expect(h.relocation.filter((l: string) => l.startsWith("M\t"))).toHaveLength(3);
    expect(m.classify(m.ALLOWED)).toEqual([]);
  });

  it("Phase 2 and preflight still reject runtime files under infra/lemtel-edge, and pass now", () => {
    const p2 = read("scripts/verify-lemtel-edge-phase2.mjs");
    const rule = /\(\^\|\\\/\)\(Dockerfile\|docker-compose\[\^\/\]\*\|compose\\\.ya\?ml\|\[\^\/\]\+\\\.\(sh\|service\)\)\$/;
    expect(rule.test(p2)).toBe(true);
    const re = /(^|\/)(Dockerfile|docker-compose[^/]*|compose\.ya?ml|[^/]+\.(sh|service))$/i;
    expect(re.test("infra/lemtel-edge/phase12-closed/Dockerfile")).toBe(true);
    expect(re.test("infra/lemtel-edge/x/docker-compose.closed.yml")).toBe(true);
    expect(read("infra/lemtel-edge/preflight/edge-preflight.mjs")).toContain("PACKAGE_NO_RUNTIME_ARTIFACTS");
    const node = (a: string[]) => spawnSync(process.execPath, a, { cwd: root, encoding: "utf8" });
    for (const a of [["scripts/verify-lemtel-edge-phase2.mjs", "--invariants"], ["scripts/verify-lemtel-edge-phase2.mjs", "--historical-acceptance"], ["infra/lemtel-edge/preflight/edge-preflight.mjs", "--verify"], ["infra/lemtel-edge/preflight/edge-preflight.mjs", "--report"], ["--test", "infra/lemtel-edge/preflight/edge-preflight.test.mjs"]]) expect(node(a).status, a.join(" ")).toBe(0);
  });

  it("other paths remain frozen", async () => {
    const m = await v12();
    expect(m.classify(["docs/lemtel-edge/phase-11-closed-local-runtime-admission.md"])).toContain("P12_EDGE_FROZEN");
    expect(m.classify(["schemas/lemtel-edge/runtime/closed-local-edge-runtime-report-v1.schema.json"])).toContain("P12_EDGE_FROZEN");
    expect(m.classify(["infra/lemtel-edge/policy/edge-feature-gates.yaml"])).toContain("P12_EDGE_FROZEN");
    expect(m.classify(["scripts/verify-lemtel-edge-phase11.mjs"])).toContain("P12_EDGE_FROZEN");
    expect(m.classify(["services/lemtel-" + "control-plane/src/app.ts"])).toContain("P12_CONTROL_PLANE_FROZEN");
    for (const p of ["apps/planipret-mobile/a.ts", "supabase/functions/x/index.ts", "src/pages/lemtel-uc/a.tsx", "package.json"]) expect(m.classify([p])).toContain("P12_PROTECTED_PATHS");
  });

  it("Dockerfile: exact base, packages, syntax check, final user", async () => {
    const m = await v12();
    const d = read(m.DOCKERFILE);
    expect(m.checkDockerfile(d)).toBe(true);
    expect(m.checkDockerfile(d.replace("debian:12.12-slim", "debian:latest"))).toBe(false);
    expect(m.checkDockerfile(d.replace("python3-minimal", "python3-minimal curl"))).toBe(false);
    expect(m.checkDockerfile(d.replace("kamailio python3-minimal", "kamailio python3-minimal rtpengine"))).toBe(false);
    expect(m.checkDockerfile(d.replace("RUN kamailio -c -f", "RUN true #"))).toBe(false);
    expect(m.checkDockerfile(d.replace("USER 65532:65532", "USER root"))).toBe(false);
    expect(m.checkDockerfile(d + "EXPOSE 5060\n")).toBe(false);
    const DIR = "RUN install -d -m 0755 /opt/lemtel-closed\n";
    const COPY = "COPY --chown=root:root --chmod=0444 kamailio.cfg /opt/lemtel-closed/kamailio.cfg\n";
    expect(d).toContain(DIR + COPY);
    expect(d.indexOf(DIR)).toBeGreaterThan(d.indexOf("useradd --system --uid 65532"));
    expect(m.checkDockerfile(d.replace(DIR, ""))).toBe(false);
    expect(m.checkDockerfile(d.replace("install -d -m 0755", "install -d -m 0777"))).toBe(false);
    expect(m.checkDockerfile(d.replace("install -d -m 0755 /opt/lemtel-closed", "install -d -m 0755 /opt/other"))).toBe(false);
    expect(m.checkDockerfile(d.replace(DIR + COPY, COPY + DIR))).toBe(false);
    expect(m.checkDockerfile(d.replace(DIR, DIR + DIR))).toBe(false);
    expect(m.checkDockerfile(d.replace("--chmod=0444", "--chmod=0644"))).toBe(false);
    expect(m.checkDockerfile(d.replace("--chown=root:root", "--chown=65532:65532"))).toBe(false);
    for (const extra of ["RUN chmod -R 0777 /opt/lemtel-closed\n", "RUN chown -R 65532:65532 /opt/lemtel-closed\n", "RUN chmod u+w /opt/lemtel-closed/kamailio.cfg\n", "RUN mkdir -p /var/run/x\n"]) expect(m.checkDockerfile(d.replace(COPY, COPY + extra))).toBe(false);
    expect(d.trim().split("\n").filter((l) => l.startsWith("USER"))).toEqual(["USER 65532:65532"]);
  });

  it("Compose: one hardened service, no port/network/mount/env/secret/privilege", async () => {
    const m = await v12();
    const y = read(m.COMPOSE);
    expect(m.checkCompose(y)).toBe(true);
    const add = (s: string) => y.replace('    restart: "no"\n', `    restart: "no"\n${s}`);
    for (const s of ['    ports: ["5060:5060/udp"]\n', "    volumes: [\"./x:/x\"]\n", "    environment: [A=1]\n", "    secrets: [a]\n", "    privileged: true\n", "    cap_add: [NET_ADMIN]\n", "    networks: [default]\n", "    env_file: x\n"]) expect(m.checkCompose(add(s))).toBe(false);
    expect(m.checkCompose(y.replace('network_mode: "none"', 'network_mode: "host"'))).toBe(false);
    expect(m.checkCompose(y.replace("read_only: true", "read_only: false"))).toBe(false);
    expect(m.checkCompose(y + "  second:\n    image: x\n")).toBe(false);
    expect(m.checkIgnore(read(m.IGNORE))).toBe(true);
    expect(m.checkIgnore("*\n!Dockerfile\n!kamailio.cfg\n!secrets\n")).toBe(false);
    const r = await runner();
    expect(r.composeHardened(y)).toBe(true);
    expect(r.composeHardened(add('    ports: ["1:1"]\n'))).toBe(false);
  });

  it("Kamailio config: one loopback listener, only sl, static 503", async () => {
    const m = await v12();
    const c = read(m.CFG);
    expect(m.checkCfg(c)).toBe(true);
    expect(m.checkCfg(c.replace("listen=udp:127.0.0.1:5060", "listen=udp:0.0.0.0:5060"))).toBe(false);
    expect(m.checkCfg(c.replace("listen=udp:127.0.0.1:5060", "listen=udp:127.0.0.1:5060\nlisten=tcp:127.0.0.1:5060"))).toBe(false);
    expect(m.checkCfg(c.replace('loadmodule "sl.so"', 'loadmodule "sl.so"\nloadmodule "tm.so"'))).toBe(false);
    expect(m.checkCfg(c.replace('loadmodule "sl.so"', 'loadmodule "sl.so"\nloadmodule "rtpengine.so"'))).toBe(false);
    expect(m.checkCfg(c.replace('sl_send_reply("503", "Lemtel Edge disabled");', "t_relay();"))).toBe(false);
    expect(m.checkCfg(c.replace("dns=no", "dns=yes"))).toBe(false);
    expect(m.checkCfg(c + "\nroute[X] { exit; }\n")).toBe(false);
  });

  it("runner: argument arrays only, no shell, no external access, redacted schema-valid output", async () => {
    const m = await v12();
    const t = read(m.RUNNER);
    expect(m.checkRunner(t)).toBe(true);
    for (const bad of ["she" + "ll: true", "require('child_process').ex" + "ec(", "fet" + "ch(", "import n from 'node:dn" + "s'", "process.e" + "nv.X", "console.lo" + "g(1)", "spawnSync(\"bash\", [])", "8.8" + ".8.8"]) expect(m.checkRunner(t + "\n" + bad + "\n")).toBe(false);
    for (const src of [read(m.SELF), read(m.TEST)]) expect(m.checkOtherSources(src)).toBe(true);
    expect(m.checkOtherSources("spawnSync(" + '"docker", ["ps"])')).toBe(false);
    const r = await runner();
    const v = await v11();
    const schema = JSON.parse(read(v.REPORT));
    const pass = r.report("passed", "none", { configSyntax: "passed", closedResponse: "passed", externalEgress: "blocked", upstreamConnection: "blocked", controlPlaneConnection: "blocked", mediaRelay: "blocked", cleanup: "passed" });
    expect(JSON.stringify(pass)).toBe('{"schemaVersion":"closed_local_edge_runtime_report_v1","result":"passed","configSyntax":"passed","closedResponse":"passed","externalEgress":"blocked","upstreamConnection":"blocked","controlPlaneConnection":"blocked","mediaRelay":"blocked","featureGates":"all_false","cleanup":"passed","failureCode":"none"}');
    for (const o of [pass, r.report("failed", "local_validation_failed", {}), r.report("failed", "local_validation_failed", { configSyntax: "failed", cleanup: "passed" }), r.report("failed", "cleanup_failed", { configSyntax: "passed", cleanup: "failed" })]) expect(v.validate(schema, o)).toBe(true);
    expect(v.validate(schema, r.report("failed", "none", {}))).toBe(false);
    expect(r.inspectOk({ State: { Running: true }, HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, SecurityOpt: ["no-new-privileges:true"], CapDrop: ["ALL"], Privileged: false, Tmpfs: { "/tmp": "", "/run": "mode=0755,uid=65532,gid=65532" } }, NetworkSettings: { Ports: {}, Networks: { none: {} } }, Config: { User: "65532:65532" }, Mounts: [] })).toBe(true);
    expect(r.inspectOk({ State: { Running: true }, HostConfig: { NetworkMode: "bridge", ReadonlyRootfs: true, SecurityOpt: ["no-new-privileges:true"], CapDrop: ["ALL"], Privileged: false }, NetworkSettings: { Ports: {} }, Config: { User: "65532:65532" }, Mounts: [] })).toBe(false);
  });

  it("phase 12.3: /run tmpfs must be user-owned 0755 in Compose and in inspection", async () => {
    const m = await v12();
    const r = await runner();
    const y = read("infra/lemtel-edge-phase12-closed/docker-compose.closed.yml");
    const good = "      - /run:mode=0755,uid=65532,gid=65532\n";
    expect(y.includes(good)).toBe(true);
    expect(m.checkCompose(y)).toBe(true);
    expect(r.composeHardened(y)).toBe(true);
    const bads = [
      y.replace(good, "      - /run\n"),
      y.replace(good, "      - /run:mode=0777,uid=65532,gid=65532\n"),
      y.replace(good, "      - /run:mode=0700,uid=65532,gid=65532\n"),
      y.replace(good, "      - /run:mode=0755,uid=0,gid=65532\n"),
      y.replace(good, "      - /run:mode=0755,uid=65532,gid=0\n"),
      y.replace("      - /tmp\n" + good, good + "      - /tmp\n"),
      y.replace(good, good + "      - /var/tmp\n"),
      y.replace(good, "      - /run:mode=0755,uid=65532,gid=65532,size=1m\n"),
      y.replace(good, "      - /run:mode=0755,uid=65532,gid=65532,exec\n"),
      y + "    volumes:\n      - ./x:/x\n",
      y.replace("    tmpfs:", "    volumes:\n      - type: bind\n        source: .\n        target: /x\n    tmpfs:"),
      y + "    networks: [a]\n",
      y + "    ports: [\"1:1\"]\n",
    ];
    for (const b of bads) { expect(m.checkCompose(b)).toBe(false); expect(r.composeHardened(b)).toBe(false); }
    const base = (tmpfs) => ({ State: { Running: true }, HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, SecurityOpt: ["no-new-privileges:true"], CapDrop: ["ALL"], Privileged: false, ...(tmpfs === undefined ? {} : { Tmpfs: tmpfs }) }, NetworkSettings: { Ports: {}, Networks: { none: {} } }, Config: { User: "65532:65532" }, Mounts: [] });
    expect(r.inspectOk(base({ "/tmp": "", "/run": "mode=0755,uid=65532,gid=65532" }))).toBe(true);
    expect(r.inspectOk(base({ "/tmp": "", "/run": "mode=755,uid=65532,gid=65532" }))).toBe(true);
    for (const t of [undefined, null, {}, { "/tmp": "" }, { "/run": "mode=0755,uid=65532,gid=65532" }, { "/tmp": "", "/run": "mode=0755,uid=65532,gid=65532", "/x": "" },
      { "/tmp": "", "/run": "" }, { "/tmp": "", "/run": "uid=65532,gid=65532" }, { "/tmp": "", "/run": "mode=0755,gid=65532" }, { "/tmp": "", "/run": "mode=0755,uid=65532" },
      { "/tmp": "", "/run": "mode=0777,uid=65532,gid=65532" }, { "/tmp": "", "/run": "mode=755,uid=0,gid=65532" }, { "/tmp": "", "/run": "mode=755,uid=65532,gid=0" },
      { "/tmp": "", "/run": "mode=755,mode=777,uid=65532,gid=65532" }]) expect(r.inspectOk(base(t))).toBe(false);
    const rt = read(m.RUNNER);
    expect(m.checkRunner(rt.replace("&& tmpfsOk(hc.Tmpfs)", ""))).toBe(false);
    expect(m.checkRunner(rt.replace('uids[0] === "uid=65532"', 'uids[0] === "uid=0"'))).toBe(false);
  });

  it("doc, Phase 11 shape and gates preserved; Phase 11 verifier still passes", async () => {
    const m = await v12();
    expect(m.checkDoc(read(m.DOC))).toBe(true);
    expect(m.gatesAllFalse(read("infra/lemtel-edge/policy/edge-feature-gates.yaml"))).toBe(true);
    const v = await v11();
    expect(v.checkReportSchema(JSON.parse(read(v.REPORT)))).toEqual([]);
    expect(v.checkAdmissionSchema(JSON.parse(read(v.ADMISSION)))).toEqual([]);
    expect(v.verifyPhase11([])).toEqual({ code: 0, stdout: "P11_PASSED\n" });
  });
});
