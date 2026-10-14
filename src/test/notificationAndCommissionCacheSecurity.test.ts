import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("push internal et cache Commissions quinze minutes", () => {
  it("protège pp-row-push par secret Vault interne et ne place aucun jeton dans le trigger", () => {
    const config = read("supabase/config.toml");
    const migration = read("drizzle/migrations/0011_planipret_internal_trigger_secret.sql");
    const handler = read("supabase/functions/pp-row-push/index.ts");
    expect(config).toContain("[functions.pp-row-push]\nverify_jwt = false");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("PP_INTERNAL_TRIGGER_SECRET");
    expect(migration).toContain("'X-Planipret-Internal-Trigger', _internal_secret");
    expect(migration).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration).not.toMatch(/[\"']apikey[\"']\s*[,=:]\s*[\"']eyJ/);
    expect(handler).toContain('admin.rpc("pp_verify_internal_trigger_secret"');
    expect(handler).toContain('internal_trigger_required');
    expect(handler).toContain('row.direction === "missed"');
    expect(read("drizzle/migrations/0009_planipret_row_push_triggers.sql")).toContain("NEW.direction = 'missed'");
  });

  it("garde les rapports Déboursées et En attente frais quinze minutes avec préchauffage", () => {
    const reports = read("supabase/functions/planipret-commission-reports/index.ts");
    const migration = read("drizzle/migrations/0011_planipret_internal_trigger_secret.sql");
    const client = read("src/lib/planipret/commissionClientCache.ts");
    expect(reports).toContain("const FRESH_MS = 15 * 60_000;");
    expect(client).toContain("COMMISSION_CACHE_TTL_MS = 15 * 60_000");
    expect(read("drizzle/migrations/0010_planipret_commission_snapshot_warm_15min.sql")).toContain("'*/15 * * * *'");
    expect(migration).toContain("pp_warm_commission_snapshots");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(reports).toContain('new Set(["summary", "pending", "analytics", "deposits", "by_agent", "agents", "institutions"])');
  });
});
