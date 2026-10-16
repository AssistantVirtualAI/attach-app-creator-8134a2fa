import { backend, enabled, type Backend } from "../_shared/lemtelNodeEnrollmentBackend.ts";
import { boundedJSON, empty, exact, fingerprintOK, response, role, uuid } from "../_shared/lemtelNodeEnrollment.ts";
type Deps = Backend & { enabled: () => boolean };
export function redacted(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("enrollment_rejected");
  const v = value as Record<string, unknown>;
  if (!uuid(v.requestId) || !role(v.role) || !fingerprintOK(v.fingerprint) || !["invited_unverified", "pending_unverified", "approved_publication_only", "delivered_publication_only", "revoked", "expired"].includes(v.state as string)
    || !Number.isSafeInteger(v.expiresAt)) throw new Error("enrollment_rejected");
  // Never return a raw row. Even an unexpected DB column cannot reach the portal.
  return { requestId: v.requestId, role: v.role, fingerprint: v.fingerprint, state: v.state, expiresAt: v.expiresAt };
}
export function createEnrollmentAdminHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return empty(405);
    if (!d.enabled()) return empty(503);
    if (req.headers.get("Content-Type") !== "application/json") return empty(415);
    const token = req.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/)?.[1];
    if (!token) return empty(401);
    try {
      const actor = await d.actor(token); if (!uuid(actor)) return empty(401);
      // Independent server-side membership lookup, and SQL checks again inside every transaction.
      if (await d.rpc("lemtel_node_enrollment_is_admin", { p_actor: actor }) !== true) return empty(403);
      const raw = await boundedJSON(req, 768); if (!raw) return empty(400);
      const args: Record<string, unknown> = { p_actor: actor };
      if (raw.action === "invite") {
        if (!exact(raw, ["action", "role", "fingerprint", "confirmation"]) || !role(raw.role) || !fingerprintOK(raw.fingerprint) || raw.confirmation !== "PIN_OUT_OF_BAND_PUBLIC_KEY") return empty(400);
        Object.assign(args, { p_role: raw.role, p_fingerprint: raw.fingerprint, p_confirmation: raw.confirmation });
      } else if (raw.action === "read") {
        if (!exact(raw, ["action", "requestId"]) || !uuid(raw.requestId)) return empty(400);
        args.p_id = raw.requestId;
      } else if (raw.action === "approve" || raw.action === "revoke") {
        const approve = raw.action === "approve";
        if (!exact(raw, approve ? ["action", "requestId", "role", "fingerprint", "confirmation", "evidence"] : ["action", "requestId", "role", "fingerprint", "confirmation"])
          || !uuid(raw.requestId) || !role(raw.role) || !fingerprintOK(raw.fingerprint) || raw.confirmation !== (approve ? "APPROVE_PUBLICATION_ONLY" : "REVOKE_PUBLICATION_ONLY")
          || (approve && raw.evidence !== "OUT_OF_BAND_KEY_VERIFIED")) return empty(400);
        Object.assign(args, { p_id: raw.requestId, p_role: raw.role, p_fingerprint: raw.fingerprint, p_confirmation: raw.confirmation });
        if (approve) args.p_evidence = raw.evidence;
      } else return empty(400);
      const value = await d.rpc(`lemtel_node_enrollment_${raw.action}`, args);
      return response(redacted(value));
    } catch { return empty(409); }
  };
}
export const handler = createEnrollmentAdminHandler({ ...backend, enabled });
if (import.meta.main) Deno.serve(handler);
