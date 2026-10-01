import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Lemtel Control Plane phase 1 — repository boundary", () => {
  it("is a separate service with its own package and lockfile", () => {
    for (const f of ["package.json", "package-lock.json", "tsconfig.json", "Dockerfile", "migrations/0001_control_plane_foundation.sql"]) expect(fs.existsSync(path.join(root, "services/lemtel-control-plane", f)), f).toBe(true);
    expect(read("package.json")).not.toMatch(/lemtel-control-plane/);
  });

  it("static verifier passes against the Phase 0 acceptance commit", () => {
    let hasBase = true;
    try { execSync("git cat-file -t 6e512e962", { cwd: root, stdio: "ignore" }); } catch { hasBase = false; }
    const out = execSync(`node scripts/verify-lemtel-control-plane.mjs ${hasBase ? "6e512e962" : ""}`, { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/passed/);
  });

  it("no frontend code imports the control plane", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(path.join(root, "src"))) if (!f.endsWith("lemtelControlPlanePhase1.test.ts")) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/services\/lemtel-control-plane/);
  });

  it("documentation states the Phase 1 boundaries", () => {
    expect(read("docs/lemtel-control-plane/phase-1-architecture.md")).toMatch(/no Edge, no FusionPBX, no Supabase, no client traffic and no production deployment/);
    const sec = read("docs/lemtel-control-plane/security-boundaries.md");
    for (const t of ["recordings", "CDRs", "voicemail", "push tokens", "never receive a FusionPBX password", "per-extension only and tenant-scoped"]) expect(sec).toContain(t);
    expect(read("docs/lemtel-control-plane/vps-deployment-prerequisites.md")).toMatch(/No secret should ever be pasted into Lovable or committed to Git/);
    expect(read("docs/lemtel-control-plane/local-development.md")).not.toMatch(/^\s*#(?!#| )/m);
  });

  it("compose is loopback-only and does not expose Postgres or Redis", () => {
    const c = read("infra/lemtel-control-plane/docker-compose.dev.yml");
    expect(c).toContain('"127.0.0.1:8081:8080"');
    expect(c.match(/ports:/g)?.length).toBe(1);
    expect(c).not.toMatch(/network_mode|privileged|docker\.sock|:latest/);
  });

  it("config-guard gates every service and blank example is parse-safe", () => {
    const c = read("infra/lemtel-control-plane/docker-compose.dev.yml");
    expect(c).toMatch(/config-guard:\n\s+image: busybox:1\.37\.0-musl/);
    expect(c).toMatch(/x-after-guard:[^\n]*\n\s+config-guard: \{ condition: service_completed_successfully \}/);
    expect(c.match(/<<: \*after-guard/g)?.length).toBe(3);
    expect(c).not.toMatch(/\$\{[A-Z_]+:\?/);
    expect(c).not.toMatch(/\$\{CONTROL_PLANE_(SERVICE_TOKEN|DB_PASSWORD|REDIS_PASSWORD):-[^}]/);
    const ex = read("infra/lemtel-control-plane/.env.example");
    expect(ex).toMatch(/^CONTROL_PLANE_SERVICE_TOKEN=$/m);
    expect(ex).toMatch(/^CONTROL_PLANE_DB_PASSWORD=$/m);
    expect(ex).toMatch(/^CONTROL_PLANE_REDIS_PASSWORD=$/m);
  });

  it("config-guard script rejects blank/weak values and never prints values", () => {
    const script = path.join(root, "infra/lemtel-control-plane/config-guard.sh");
    const run = (env: Record<string, string>) => { try { return { code: 0, out: execSync(`sh "${script}"`, { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" }) }; } catch (e: any) { return { code: e.status as number, out: String(e.stdout) }; } };
    const blank = run({ CONTROL_PLANE_SERVICE_TOKEN: "", CONTROL_PLANE_DB_PASSWORD: "", CONTROL_PLANE_REDIS_PASSWORD: "" });
    expect(blank.code).toBe(1); expect(blank.out).toMatch(/missing/);
    const weak = "changeme-changeme-changeme-changeme";
    const w = run({ CONTROL_PLANE_SERVICE_TOKEN: weak, CONTROL_PLANE_DB_PASSWORD: weak, CONTROL_PLANE_REDIS_PASSWORD: weak });
    expect(w.code).toBe(1); expect(w.out).not.toContain(weak);
    const strong = { CONTROL_PLANE_SERVICE_TOKEN: "Tq8v".repeat(10), CONTROL_PLANE_DB_PASSWORD: "Lm3k".repeat(8), CONTROL_PLANE_REDIS_PASSWORD: "Zp7w".repeat(8) };
    const ok = run(strong);
    expect(ok.code).toBe(0); for (const v of Object.values(strong)) expect(ok.out).not.toContain(v);
  });

  it("fastify is pinned to the patched release", () => {
    const pkg = JSON.parse(read("services/lemtel-control-plane/package.json"));
    const [maj, min, pat] = String(pkg.dependencies.fastify).split(".").map(Number);
    expect(maj).toBe(5); expect(min * 1000 + pat).toBeGreaterThanOrEqual(12005);
    const lock = JSON.parse(read("services/lemtel-control-plane/package-lock.json"));
    expect(lock.packages["node_modules/fastify"].version).toBe(pkg.dependencies.fastify);
  });
});
