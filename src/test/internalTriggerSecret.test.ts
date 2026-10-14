import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("déclencheurs internes Planiprêt", () => {
  it("ne copie jamais la clé de service dans Vault ou les déclencheurs SQL", () => {
    const migration = read("drizzle/migrations/0011_planipret_internal_trigger_secret.sql");
    expect(migration).toContain("PP_INTERNAL_TRIGGER_SECRET");
    expect(migration).toContain("vault.create_secret");
    expect(migration).toContain("gen_random_bytes(32)");
    expect(migration).toContain("pp_verify_internal_trigger_secret");
    expect(migration).toContain("X-Planipret-Internal-Trigger");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.pp_verify_internal_trigger_secret(text) FROM PUBLIC, anon, authenticated");
    expect(migration).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration).not.toMatch(/["']apikey["']\s*[,=:]\s*["']eyJ/);
  });

  it("accepte seulement le secret interne et délègue le préchauffage au serveur", () => {
    const config = read("supabase/config.toml");
    const handler = read("supabase/functions/pp-row-push/index.ts");
    const reports = read("supabase/functions/planipret-commission-reports/index.ts");
    expect(config).toContain("[functions.pp-row-push]\nverify_jwt = false");
    expect(handler).toContain('admin.rpc("pp_verify_internal_trigger_secret", { _candidate: candidate })');
    expect(handler).toContain('req.headers.get("X-Planipret-Internal-Trigger")');
    expect(handler).toContain('error: "internal_trigger_required"');
    expect(handler).toContain('action: "warm_snapshots"');
    expect(handler).toContain('Authorization: `Bearer ${SERVICE_KEY}`');
    expect(handler.indexOf('internal_trigger_required')).toBeLessThan(handler.indexOf("Body.safeParse"));
    expect(handler.indexOf('internal_trigger_required')).toBeLessThan(handler.indexOf(".from(table).select"));
    expect(reports).toContain('if (!SERVICE_KEY || jwt !== SERVICE_KEY)');
    expect(reports).toContain('error: "service_role_required"');
    expect(reports.indexOf('if (!SERVICE_KEY || jwt !== SERVICE_KEY)')).toBeLessThan(reports.indexOf('planipret_commission_snapshots").select'));
  });
});
