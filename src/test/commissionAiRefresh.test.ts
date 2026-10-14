import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMISSION_AI_REFRESH_MS,
  isCommissionAiAuditFresh,
  validateCommissionOutput,
} from "../../supabase/functions/_shared/commission-validation";
import { commissionInsightsCacheScope } from "../../supabase/functions/_shared/commission-insights-cache";
import { summarize } from "../../supabase/functions/_shared/commission-reports";

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

const paidRows = [{
  number: "C-100",
  amount: 1250,
  loan_amt: 250000,
  date_trans: "2026-10-14",
  commission_type: "base",
  institution: "BNC",
}] as any[];

describe("cadence des analyses IA Commissions", () => {
  it("autorise un nouveau passage IA à l’expiration de vingt-quatre heures seulement", () => {
    const now = Date.parse("2026-10-14T12:00:00.000Z");
    expect(COMMISSION_AI_REFRESH_MS).toBe(24 * 60 * 60 * 1000);
    expect(isCommissionAiAuditFresh(new Date(now - COMMISSION_AI_REFRESH_MS + 1).toISOString(), now)).toBe(true);
    expect(isCommissionAiAuditFresh(new Date(now - COMMISSION_AI_REFRESH_MS).toISOString(), now)).toBe(false);
    expect(isCommissionAiAuditFresh("not-a-date", now)).toBe(false);
    expect(isCommissionAiAuditFresh(null, now)).toBe(false);
  });

  it("conserve le rapprochement déterministe sans appeler le modèle pendant la fenêtre quotidienne", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const validation = await validateCommissionOutput({
        source: "paid_deposits",
        rows: paidRows as any,
        summary: summarize(paidRows as any),
        truncated: false,
        scope: { role: "broker", mode: "own" },
        skipAi: true,
      });
      expect(validation.validated).toBe(true);
      expect(validation.status).toBe("MATCH");
      expect(validation.ai_status).toBe("cached");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("partitionne le cache d’insights par utilisateur et période, pas par variation de données", () => {
    const base = {
      userId: "viewer-a",
      lang: "fr" as const,
      scope: "broker" as const,
      source: "maestro",
      year: 2026,
      period: "octobre",
      granularity: "month",
      window: { start: "2026-10-01", end: "2026-10-31" },
      agent: "self",
      lenderFilter: null,
    };
    expect(commissionInsightsCacheScope(base)).toBe(commissionInsightsCacheScope({ ...base }));
    expect(commissionInsightsCacheScope(base)).not.toBe(commissionInsightsCacheScope({ ...base, userId: "viewer-b" }));
    expect(commissionInsightsCacheScope(base)).not.toBe(commissionInsightsCacheScope({ ...base, period: "novembre" }));
  });

  it("garde le bouton manuel, le cache serveur 24 h et la parité mobile", () => {
    const endpoint = read("supabase/functions/pp-commissions-insights/index.ts");
    const reports = read("supabase/functions/planipret-commission-reports/index.ts");
    const portal = read("src/components/planipret/commissions/RegisterCommissions.tsx");
    const mobile = read("apps/planipret-mobile/src/components/planipret/commissions/RegisterCommissions.tsx");
    const migration = read("drizzle/migrations/0013_planipret_remove_legacy_commission_warm_cron.sql");
    expect(endpoint).toContain("readInsightsCache(cacheKey, COMMISSION_INSIGHTS_TTL_MS)");
    expect(endpoint).toContain("const force = body?.force === true");
    expect(reports).toContain("isCommissionAiAuditFresh(prev?.created_at)");
    expect(reports).toContain("if (skipAi) return v;");
    expect(portal).toContain("force,");
    expect(portal).toContain("pp-register-insights:v2:");
    expect(portal).not.toContain(":${tab}:${dataSignature}");
    expect(mobile).toBe(portal);
    expect(migration).toContain("pp-commission-snapshots-hourly");
    expect(migration).toContain("cron.unschedule");
  });
});
