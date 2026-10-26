/** One financial identity per report; presentation sorting must not fork totals. */
export function commissionReportRequest(body: any) {
  if (!body || typeof body !== "object" || !body.filters || typeof body.filters !== "object") return body;
  if (!["summary", "by_agent", "pending", "analytics"].includes(String(body.action ?? "summary"))) return body;
  const filters = { ...body.filters };
  delete filters.order_by;
  delete filters.sort;
  delete filters.page;
  delete filters.per_page;
  return { ...body, filters };
}