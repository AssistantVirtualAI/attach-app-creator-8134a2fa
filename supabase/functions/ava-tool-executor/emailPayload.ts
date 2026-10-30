/** Adapt the shared AVA email schema to Microsoft 365 without changing approvals. */
export function normalizeAvaEmailPayload(parameters: Record<string, unknown>) {
  const payload = { ...parameters };
  const hasRecipient = Array.isArray(payload.to)
    ? payload.to.some((value) => typeof value === "string" && value.trim().length > 0)
    : typeof payload.to === "string" && payload.to.trim().length > 0;
  if (!hasRecipient && typeof payload.to_email === "string" && payload.to_email.trim()) {
    payload.to = payload.to_email.trim();
  }
  return payload;
}