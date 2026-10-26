export type PaidPeriod = "year" | "quarter" | "month";

/** Same Toronto cutoff for portal, broker charts and mobile paid reports. */
export function paidCommissionPeriod(year: number, period: PaidPeriod = "year", index = 1, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(now);
  const firstMonth = period === "year" ? 1 : period === "quarter" ? (index - 1) * 3 + 1 : index;
  const lastMonth = period === "year" ? 12 : period === "quarter" ? index * 3 : index;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date_from = `${year}-${pad(firstMonth)}-01`;
  const end = `${year}-${pad(lastMonth)}-${new Date(Date.UTC(year, lastMonth, 0)).getUTCDate()}`;
  return { date_from, date_to: end > today ? today : end };
}