type SyncOutcome = {
  action?: string | null;
  success?: boolean | null;
  response_status?: number | null;
  response_body?: unknown;
};

/** Only legacy widget logs omitted success; never reinterpret other business outcomes. */
export function isMaestroSyncSuccessful(row: SyncOutcome): boolean {
  if (row.success != null) return row.success;
  if (row.action !== "widget.sync" && row.action !== "widget.release") return false;
  const body = row.response_body;
  if (body && typeof body === "object") {
    const result = body as Record<string, unknown>;
    if (result.error || result.skipped || result.success === false || result.ok === false) return false;
  }
  return typeof row.response_status === "number" && row.response_status >= 200 && row.response_status < 300;
}