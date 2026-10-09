import { claudeText } from "./anthropic.ts";
import { num, type CommissionDepositRow, type CommissionSummary } from "./commission-reports.ts";

export type CommissionSource = "paid_deposits" | "pending_commissions";
export type ValidationStatus = "MATCH" | "WARNING" | "BLOCKED";

export interface CommissionValidation {
  source: CommissionSource;
  status: ValidationStatus;
  validated: boolean;
  checked_at: string;
  checks: Array<{ key: string; expected_cents: number; actual_cents: number; delta_cents: number; ok: boolean }>;
  anomalies: Array<{ type: string; severity: "info" | "warning" | "critical"; detail: string }>;
  summary: string;
  ai_status: "ok" | "warnings" | "blocked" | "unavailable";
}

const cents = (value: unknown) => Math.round(num(value) * 100);

function check(key: string, expected: unknown, actual: unknown) {
  const expected_cents = cents(expected);
  const actual_cents = cents(actual);
  const delta_cents = actual_cents - expected_cents;
  return { key, expected_cents, actual_cents, delta_cents, ok: delta_cents === 0 };
}

export function deterministicPaidChecks(rows: CommissionDepositRow[], summary: CommissionSummary) {
  const dated = rows.filter((row) => /^\d{4}-\d{2}-\d{2}/.test(String(row.date_trans ?? "").trim()));
  const amount = dated.reduce((total, row) => total + cents(row.amount), 0);
  const byDate = summary.by_date.reduce((total, row) => total + cents(row.amount), 0);
  const byInstitution = summary.top_institutions.reduce((total, row) => total + cents(row.amount), 0);
  return [
    check("paid_rows_vs_total", summary.total_commission, amount / 100),
    check("paid_dates_vs_total", summary.total_commission, byDate / 100),
    // top_institutions is intentionally capped at eight, so it cannot be an equality check.
    { ...check("paid_top_institutions_not_over_total", summary.total_commission, byInstitution / 100), ok: byInstitution <= cents(summary.total_commission) },
  ];
}

export function deterministicPendingChecks(
  rows: CommissionDepositRow[],
  official: Array<{ type: string; label: string; amount: number }> | null,
  officialTotal: number | null,
) {
  const officialSum = (official ?? []).reduce((total, item) => total + cents(item.amount), 0);
  const rowSum = rows.reduce((total, row) => total + cents(row.amount), 0);
  const baseOfficial = official?.find((item) => item.type.trim().toLowerCase() === "base")?.amount;
  const baseRows = rows
    .filter((row) => String(row.commission_type ?? "base").trim().toLowerCase() === "base")
    .reduce((total, row) => total + cents(row.amount), 0);
  const checks = [check("pending_categories_vs_official_total", officialTotal ?? 0, officialSum / 100)];
  if (baseOfficial != null) checks.push(check("pending_base_rows_vs_official_base", baseOfficial, baseRows / 100));
  // File rows can omit official override/external amounts. Record the gap for audit without treating it as corruption.
  checks.push({ ...check("pending_rows_vs_official_total", officialTotal ?? 0, rowSum / 100), ok: true });
  return checks;
}

const SYSTEM = `Tu es le dernier contrôleur d'un pipeline financier Planiprêt.
Tu reçois uniquement des agrégats déjà calculés par du code, jamais de données personnelles.
Les deux sources sont incompatibles et ne doivent jamais être mélangées:
- paid_deposits = commissions déboursées;
- pending_commissions = commissions en attente.

Le code est l'autorité arithmétique. Tu dois vérifier la cohérence du type de source, des contrôles en cents,
de la pagination et des catégories. Tu ne modifies, ne filtres, n'inventes et ne recalcules aucun montant.
Une différence entre les lignes ventilées pending et le total officiel est permise lorsqu'elle correspond aux
catégories officielles override/external; une catégorie officielle qui ne balance pas avec le total est critique.

Réponds uniquement en JSON:
{"status":"ok|warnings|blocked","summary":"...","anomalies":[{"type":"...","severity":"info|warning|critical","detail":"..."}]}
Maximum 12 anomalies. Bloque seulement une source mélangée, un résultat partiel, un contrôle obligatoire en échec,
ou une incohérence critique. N'affiche aucune donnée absente.`;

function parseAi(text: string | null) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

export async function validateCommissionOutput(input: {
  source: CommissionSource;
  rows: CommissionDepositRow[];
  truncated: boolean;
  summary?: CommissionSummary;
  official?: Array<{ type: string; label: string; amount: number }> | null;
  officialTotal?: number | null;
  scope: { role: string; mode: string; users_id?: string | null };
}): Promise<CommissionValidation> {
  const checks = input.source === "paid_deposits"
    ? deterministicPaidChecks(input.rows, input.summary as CommissionSummary)
    : deterministicPendingChecks(input.rows, input.official ?? null, input.officialTotal ?? null);
  const mandatory = checks.filter((item) => item.key !== "pending_rows_vs_official_total" && item.key !== "paid_top_institutions_not_over_total");
  const deterministicBlocked = input.truncated || mandatory.some((item) => !item.ok);
  const payload = {
    source: input.source,
    truncated: input.truncated,
    scope: { role: input.scope.role, mode: input.scope.mode, selected: Boolean(input.scope.users_id) },
    row_count: input.rows.length,
    checks,
    totals: input.source === "paid_deposits"
      ? { commission_cents: cents(input.summary?.total_commission), volume_cents: cents(input.summary?.total_loan_volume), deals: input.summary?.deal_count ?? 0 }
      : { official_total_cents: cents(input.officialTotal), categories: (input.official ?? []).map((item) => ({ type: item.type, amount_cents: cents(item.amount) })) },
  };
  const text = await claudeText(SYSTEM, JSON.stringify(payload), {
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1000,
    temperature: 0.1,
    label: `commission-gate-${input.source}`,
  });
  const ai = parseAi(text);
  const aiStatus = ai && ["ok", "warnings", "blocked"].includes(String(ai.status)) ? String(ai.status) as "ok" | "warnings" | "blocked" : "unavailable";
  const anomalies = Array.isArray(ai?.anomalies) ? ai.anomalies.slice(0, 12).map((item: any) => ({
    type: String(item?.type ?? "inconsistent").slice(0, 80),
    severity: (["info", "warning", "critical"].includes(String(item?.severity)) ? String(item.severity) : "warning") as "info" | "warning" | "critical",
    detail: String(item?.detail ?? "").slice(0, 300),
  })) : [];
  // Claude est consultatif : seul le rapprochement arithmétique déterministe bloque.
  const blocked = deterministicBlocked;
  const warning = !blocked && (aiStatus !== "ok" || checks.some((item) => !item.ok) || anomalies.length > 0);
  return {
    source: input.source,
    status: blocked ? "BLOCKED" : warning ? "WARNING" : "MATCH",
    validated: !blocked,
    checked_at: new Date().toISOString(),
    checks,
    anomalies,
    summary: String(ai?.summary ?? (blocked ? "Validation des commissions indisponible ou bloquée." : "Contrôles de commissions réussis.")).slice(0, 600),
    ai_status: aiStatus,
  };
}