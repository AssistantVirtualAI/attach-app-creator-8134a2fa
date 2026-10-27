/** One financial identity per report; presentation sorting must not fork totals. */
export function commissionReportRequest(body: any) {
  if (!body || typeof body !== "object" || !body.filters || typeof body.filters !== "object") return body;
  const action = String(body.action ?? "summary");
  if (!["summary", "by_agent", "pending", "analytics", "deposits"].includes(action)) return body;
  const filters = { ...body.filters };
  // Scott's official paid report excludes third-party splits; pending is unchanged.
  if (action !== "pending" && !filters.split_type) filters.split_type = "planipret";
  if (action === "deposits") return { ...body, filters };
  delete filters.order_by;
  delete filters.sort;
  delete filters.page;
  delete filters.per_page;
  return { ...body, filters };
}