export function isCommissionQuestion(text: string) {
  return /commission|d[ée]bours|\bpaid\b|\bpending\b|en attente|d[ée]p[oô]ts?|pay[ée]s?|revenus?|\bvolumes?\b|\bunit[ée]s?\b|pr[êe]teurs?|\blenders?\b|institutions? financi[èe]res?/i.test(text);
}
export function wantsMaestroDirectory(text: string) {
  return !isCommissionQuestion(text) && /\bclients?\b|\bcourtiers?\b|\bbrokers?\b|\bcustomers?\b|\bcontacts?\b/i.test(text);
}
export const COMMISSION_CHAT_TOOLS = new Set([
  "get_commissions", "get_commission_summary", "get_commission_by_lender", "compare_commission_periods",
  "list_commission_deposits", "list_financial_institutions", "get_commission_deposits",
  "get_commission_agents", "get_financial_institutions", "open_commission_report",
]);
export function formatCommissionAnswer(data: any, lang: "fr" | "en", lenders = false) {
  const fr = lang === "fr";
  const money = (v: number) => new Intl.NumberFormat(fr ? "fr-CA" : "en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(v);
  if (data?.success === false || data?.error) return String(data?.message ?? data?.error ?? (fr ? "Chiffres indisponibles." : "Figures unavailable."));
  if (!data?.paid && !data?.pending && data?.message) return String(data.message);
  const lines = [String(data?.scope ?? ""), String(data?.period ?? "")].filter(Boolean);
  if (lenders && Array.isArray(data?.paid?.lenders)) {
    lines.push(fr ? "Prêteur | Dossiers | Volume déboursé" : "Lender | Files | Paid mortgage volume");
    for (const row of data.paid.lenders) {
      if (typeof row.volume === "number") lines.push(`${row.key} | ${row.deals ?? "—"} | ${money(row.volume)}`);
    }
  } else {
    for (const [key, label] of [["paid", fr ? "Déboursées" : "Paid"], ["pending", fr ? "En attente (actuel)" : "Pending (current)"]]) {
      const section = data?.[key];
      if (data?.[`${key}_error`]) { lines.push(`${label}: ${data[`${key}_error`]}`); continue; }
      if (!section) continue;
      if (section.not_in_team) { lines.push(String(section.message)); continue; }
      const total = section.total ?? section.amount;
      const volume = section.loan_volume ?? section.volume;
      lines.push(`${label}${typeof total === "number" ? `: ${money(total)}` : ""}${typeof section.files === "number" ? ` · ${section.files} ${fr ? "dossiers" : "files"}` : ""}${typeof volume === "number" ? ` · volume: ${money(volume)}` : ""}`);
    }
  }
  if (lenders && !Array.isArray(data?.paid?.lenders)) lines.push(String(data?.paid_error ?? (fr ? "Tableau des prêteurs indisponible." : "Lender table unavailable.")));
  if (!lenders && Array.isArray(data?.paid_by_broker)) {
    lines.push(fr ? "Courtier | Déboursées | Dossiers | Volume" : "Broker | Paid | Files | Volume");
    for (const row of data.paid_by_broker) {
      if (typeof row.amount === "number" && typeof row.loan_volume === "number") lines.push(`${row.name} | ${money(row.amount)} | ${row.files ?? "—"} | ${money(row.loan_volume)}`);
    }
  }
  return lines.join("\n") || String(data?.message ?? (fr ? "Chiffres indisponibles." : "Figures unavailable."));
}