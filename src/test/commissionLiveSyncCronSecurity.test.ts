import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("cron de synchronisation live des commissions", () => {
  it("n’accepte le déclenchement automatique qu’avec le secret interne Vault", () => {
    const handler = read("supabase/functions/pp-commission-live-sync/index.ts");
    const config = read("supabase/config.toml");
    expect(handler).toContain(
      'req.headers.get("X-Planipret-Internal-Trigger")',
    );
    expect(handler).toMatch(
      /admin\.rpc\(\s*"pp_verify_internal_trigger_secret",\s*\{\s*_candidate:\s*candidate,?\s*\}\s*\)/s,
    );
    expect(handler).not.toContain("PP_CRON_TOKEN");
    expect(handler).not.toContain("PP_CRON_SECRET");
    expect(handler).not.toContain("x-pp-cron-secret");
    expect(
      handler.indexOf("if (!(await isInternalCron(admin, internalSecret)))"),
    ).toBeLessThan(handler.indexOf("const body = await req.json()"));
    expect(
      handler.indexOf("if (!(await isInternalCron(admin, internalSecret)))"),
    ).toBeLessThan(handler.indexOf("planipret_commission_sync_runs"));
    expect(config).toContain(
      "[functions.pp-commission-live-sync]\nverify_jwt = false",
    );
  });

  it("recrée le cron sans bearer ni secret littéral", () => {
    const migration = read(
      "drizzle/migrations/0015_planipret_secure_commission_live_sync_cron.sql",
    );
    expect(migration).toContain("PP_INTERNAL_TRIGGER_SECRET");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("X-Planipret-Internal-Trigger");
    expect(migration).toContain("pp_run_commission_live_sync");
    expect(migration).toContain("pp-commission-live-sync-30min");
    expect(migration).toContain("cron.unschedule");
    expect(migration).toContain("cron.schedule");
    expect(migration).toContain("SELECT public.pp_run_commission_live_sync();");
    expect(migration).not.toContain("Authorization");
    expect(migration).not.toContain("Bearer ");
    expect(migration).not.toContain("format($cron$");
    expect(migration).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration).not.toMatch(/["'](?:eyJ|[A-Za-z0-9._-]{48,})["']/);
  });
});
