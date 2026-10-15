// Advisory Claude review of the commission rows that actually changed.
//
// Only rows new since the last Maestro probe are sent (bounded sample), with
// a whitelist of numeric / category fields: no client or broker names, no
// emails, phones or tokens. Claude never computes or publishes a figure; the
// deterministic code stays the arithmetic authority. The verdict is stored
// for admins and never turns into a $0 or blocks the last validated totals.
import { callAnthropic, type ClaudeCallOptions, type ClaudeResult } from "./anthropic.ts";

export const DELTA_REVIEW_MAX_ROWS = 40;
export const DELTA_REVIEW_MIN_INTERVAL_MS = 60 * 60_000;
const MODEL = "claude-sonnet-4-5-20250929";

const SAFE_KEY = /(amount|amt|commission_type|^type$|date|term|institution|lender|status|category|rate|mortgage_type|is_adjustment|split_type|fiscal_year)/i;
const UNSAFE_KEY = /(name|client|email|phone|tel|address|street|city|postal|zip|token|secret|note|comment|sin|nas|birth)/i;

export type DeltaReview = { status: "ok" | "warning" | "skipped"; issues: string[]; reviewed: number; at: string; reason?: string };

export function sanitizeDeltaRow(row: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!row || typeof row !== "object") return out;
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (UNSAFE_KEY.test(k) || !SAFE_KEY.test(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v as any;
    else if (typeof v === "string") out[k] = v.slice(0, 40);
  }
  return out;
}

export function shouldReview(addedCount: number, lastReviewAt: string | null | undefined, now = Date.now()) {
  if (addedCount <= 0) return false;
  if (!lastReviewAt) return true;
  const t = new Date(lastReviewAt).getTime();
  return !Number.isFinite(t) || now - t >= DELTA_REVIEW_MIN_INTERVAL_MS;
}

export function parseReview(text: string): { status: "ok" | "warning"; issues: string[] } | null {
  const m = /\{[\s\S]*\}/.exec(text ?? "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const status = j?.status === "warning" ? "warning" : j?.status === "ok" ? "ok" : null;
    if (!status) return null;
    const issues = Array.isArray(j.issues) ? j.issues.filter((s: unknown) => typeof s === "string").slice(0, 10).map((s: string) => s.slice(0, 200)) : [];
    return { status, issues };
  } catch { return null; }
}

export async function reviewCommissionDelta(
  input: { source: "paid" | "pending"; added: unknown[]; removedCount: number; totalRows: number },
  call: (o: ClaudeCallOptions) => Promise<ClaudeResult> = callAnthropic,
  signal?: AbortSignal,
): Promise<DeltaReview> {
  const at = new Date().toISOString();
  const sample = input.added.slice(0, DELTA_REVIEW_MAX_ROWS).map(sanitizeDeltaRow);
  if (!sample.length) return { status: "skipped", issues: [], reviewed: 0, at, reason: "no_rows" };
  const r = await call({
    model: MODEL, max_tokens: 400, temperature: 0, label: "commission-delta-review", signal,
    system: "Tu contrôles des lignes de commissions hypothécaires Maestro nouvellement reçues. Tu ne calcules ni ne modifies aucun montant. Signale seulement les anomalies évidentes: doublons, montants négatifs ou aberrants, dates futures ou absentes, catégorie inconnue, prêt nul sur une ligne Base. Réponds UNIQUEMENT en JSON: {\"status\":\"ok\"|\"warning\",\"issues\":[\"...\"]} (10 issues max, français, courtes).",
    messages: [{ role: "user", content: JSON.stringify({ source: input.source, added_total: input.added.length, removed: input.removedCount, rows_total: input.totalRows, sample }) }],
  }).catch(() => null);
  if (!r?.ok) return { status: "skipped", issues: [], reviewed: sample.length, at, reason: r?.error ? "provider_error" : "provider_unavailable" };
  const parsed = parseReview(r.text);
  if (!parsed) return { status: "skipped", issues: [], reviewed: sample.length, at, reason: "unparsable" };
  return { ...parsed, reviewed: sample.length, at };
}
