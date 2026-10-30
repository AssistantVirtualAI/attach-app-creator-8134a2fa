// Statut affiché d'une confirmation AVA (affichage seulement, aucune donnée modifiée).
export type DisplayStatus = "pending" | "expired" | "executed" | "failed" | "duplicate_blocked" | "fixed_since" | "cancelled" | "other";
export const PENDING_STATUSES = new Set(["pending", "proposed", "awaiting_confirmation", "awaiting"]);
// Correctif destinataire courriel AVA déployé le 2026-10-30 (UTC).
export const EMAIL_RECIPIENT_FIX_AT = Date.parse("2026-10-30T00:00:00Z");
const EXPIRE_MS = 24 * 3600e3;

export function displayStatus(r: { status?: string | null; decision?: string | null; error_code?: string | null; executed_at?: string | null; proposed_at?: string | null; created_at: string }, now = Date.now()): DisplayStatus {
  const s = (r.status ?? "").toLowerCase();
  const at = Date.parse(r.proposed_at ?? r.created_at);
  if (["executed", "sent", "done", "success"].includes(s)) return "executed";
  if (r.error_code === "action_in_progress") return "duplicate_blocked";
  if (s === "failed" || s === "error") {
    if (r.error_code === "to, subject, body requis" && at < EMAIL_RECIPIENT_FIX_AT) return "fixed_since";
    return "failed";
  }
  if (r.decision === "cancel" || r.decision === "decline" || s === "cancelled") return "cancelled";
  if (!r.executed_at && (PENDING_STATUSES.has(s) || !r.decision)) return now - at > EXPIRE_MS ? "expired" : "pending";
  return "other";
}
