import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261014211500_planipret_security_definer_anon_lockdown.sql"),
  "utf8",
);

describe("Planiprêt SECURITY DEFINER lockdown", () => {
  it("retire l'exécution visiteur des quatre fonctions signalées", () => {
    for (const fn of [
      "planipret_grant_broker_role",
      "planipret_mplanipret_allowed",
      "planipret_signin_eligible",
      "pp_feedback_reports_guard",
    ]) {
      expect(migration).toContain(`'${fn}'`);
    }
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon");
  });

  it("conserve seulement les prédicats nécessaires aux sessions authentifiées", () => {
    expect(migration).toContain("IF fn.proname IN ('planipret_mplanipret_allowed', 'planipret_signin_eligible')");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION %s FROM authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role");
  });
});
