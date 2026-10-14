/**
 * Stable, privacy-preserving cache scope for one Commission insight report per
 * authenticated viewer and selected report period.  Maestro payload changes do
 * not enter this key: a manual refresh is required to regenerate before 24 h.
 */
export const COMMISSION_INSIGHTS_TTL_MS = 24 * 60 * 60 * 1000;

export function commissionInsightsCacheScope(input: {
  userId: string;
  lang: "fr" | "en";
  scope: "admin" | "broker";
  source: string;
  year?: unknown;
  period?: unknown;
  granularity?: unknown;
  window?: unknown;
  agent?: unknown;
  lenderFilter?: unknown;
}) {
  return JSON.stringify({
    version: 1,
    user_id: input.userId,
    lang: input.lang,
    scope: input.scope,
    source: String(input.source || "maestro"),
    year: input.year ?? null,
    period: input.period ?? null,
    granularity: input.granularity ?? null,
    window: input.window ?? null,
    agent: input.agent ?? null,
    lender_filter: input.lenderFilter ?? null,
  });
}
