import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

  it("only the eight Phase 12 paths changed since base; other paths are frozen", async () => {
    const m = await v12();
    expect(m.ALLOWED).toHaveLength(8);
    const h = m.changedSinceBase(root);
    expect(h.ok).toBe(true);
    expect(h.changed.every((p: string) => m.ALLOWED.includes(p))).toBe(true);
    expect(m.classify(h.changed)).toEqual([]);
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
    for (const bad of ["shell: true", "require('child_process').ex" + "ec(", "fet" + "ch(", "import n from 'node:dn" + "s'", "process.e" + "nv.X", "console.lo" + "g(1)", "spawnSync(\"bash\", [])", "8.8" + ".8.8"]) expect(m.checkRunner(t + "\n" + bad + "\n")).toBe(false);
    for (const src of [read(m.SELF), read(m.TEST)]) expect(m.checkOtherSources(src)).toBe(true);
    expect(m.checkOtherSources("spawnSync(" + '"docker", ["ps"])')).toBe(false);
    const r = await runner();
    const v = await v11();
    const schema = JSON.parse(read(v.REPORT));
    const pass = r.report("passed", "none", { configSyntax: "passed", closedResponse: "passed", externalEgress: "blocked", upstreamConnection: "blocked", controlPlaneConnection: "blocked", mediaRelay: "blocked", cleanup: "passed" });
    expect(JSON.stringify(pass)).toBe('{"schemaVersion":"closed_local_edge_runtime_report_v1","result":"passed","configSyntax":"passed","closedResponse":"passed","externalEgress":"blocked","upstreamConnection":"blocked","controlPlaneConnection":"blocked","mediaRelay":"blocked","featureGates":"all_false","cleanup":"passed","failureCode":"none"}');
    for (const o of [pass, r.report("failed", "local_validation_failed", {}), r.report("failed", "local_validation_failed", { configSyntax: "failed", cleanup: "passed" }), r.report("failed", "cleanup_failed", { configSyntax: "passed", cleanup: "failed" })]) expect(v.validate(schema, o)).toBe(true);
    expect(v.validate(schema, r.report("failed", "none", {}))).toBe(false);
    expect(r.inspectOk({ State: { Running: true }, HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, SecurityOpt: ["no-new-privileges:true"], CapDrop: ["ALL"], Privileged: false }, NetworkSettings: { Ports: {}, Networks: { none: {} } }, Config: { User: "65532:65532" }, Mounts: [] })).toBe(true);
    expect(r.inspectOk({ State: { Running: true }, HostConfig: { NetworkMode: "bridge", ReadonlyRootfs: true, SecurityOpt: ["no-new-privileges:true"], CapDrop: ["ALL"], Privileged: false }, NetworkSettings: { Ports: {} }, Config: { User: "65532:65532" }, Mounts: [] })).toBe(false);
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
