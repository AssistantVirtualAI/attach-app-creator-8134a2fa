import { backend, enabled, type Backend } from "../_shared/lemtelNodeEnrollmentBackend.ts";
import { boundedJSON, empty, exact, fingerprint, fingerprintOK, observationText, role, uuid, validateDescriptor, verifyProof } from "../_shared/lemtelNodeEnrollment.ts";
type Deps = Pick<Backend, "rpc"> & { enabled: () => boolean; now: () => number };
export function createSignedStatusHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return empty(405);
    if (req.headers.has("Origin") || req.headers.has("Sec-Fetch-Mode")) return empty(403);
    if (!d.enabled()) return empty(503);
    if (req.headers.get("Content-Type") !== "application/json") return empty(415);
    try {
      const raw = await boundedJSON(req, 1024);
      if (!exact(raw, ["requestId", "role", "fingerprint", "sequence", "envelope", "signature"]) || !uuid(raw.requestId) || !role(raw.role) || !fingerprintOK(raw.fingerprint)
        || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1 || typeof raw.envelope !== "string") return empty(400);
      const envelope: Record<string, unknown> = JSON.parse(raw.envelope);
      if (observationText(envelope, d.now()) !== raw.envelope || envelope.nodeRole !== raw.role) return empty(400);
      const found = await d.rpc("lemtel_node_publication_lookup", { p_id: raw.requestId, p_role: raw.role, p_fingerprint: raw.fingerprint });
      if (!exact(found, ["descriptor", "grantedUntil"]) || !Number.isSafeInteger(found.grantedUntil) || (found.grantedUntil as number) <= d.now()) return empty(409);
      const descriptor = await validateDescriptor(found.descriptor);
      if (await fingerprint(descriptor) !== raw.fingerprint) return empty(409);
      const payload = { requestId: raw.requestId, role: raw.role, fingerprint: raw.fingerprint, sequence: raw.sequence, envelope: raw.envelope };
      if (!await verifyProof(descriptor, "observe", payload, raw.signature)) return empty(401);
      const result = await d.rpc("lemtel_record_enrolled_node_status", { p_id: raw.requestId, p_role: raw.role, p_fingerprint: raw.fingerprint, p_sequence: raw.sequence, p_observed_at: envelope.observedAt,
        p_agent_state: envelope.agentState, p_runtime_state: envelope.runtimeState, p_replication_state: envelope.replicationState, p_storage_state: envelope.storageState });
      return result === true ? empty(204) : empty(409);
    } catch { return empty(409); }
  };
}
export const handler = createSignedStatusHandler({ ...backend, enabled, now: () => Math.floor(Date.now() / 1000) });
if (import.meta.main) Deno.serve(handler);
