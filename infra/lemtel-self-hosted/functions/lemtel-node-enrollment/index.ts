import { backend, enabled, type Backend } from "../_shared/lemtelNodeEnrollmentBackend.ts";
import { boundedJSON, canonical, empty, exact, fingerprint, fingerprintOK, publicationEndpoint, response, role, sealConfig, uuid, validateChallenge, validateDescriptor, verifyProof, type Challenge, type Descriptor } from "../_shared/lemtelNodeEnrollment.ts";
import { authorizationToken, externalSignerAuthority, externalSignerEnabled, requestExternalSignerDelivery, type ExternalSignerAuthority } from "../_shared/lemtelExternalPlatformSigner.ts";
type Deps = Pick<Backend, "rpc"> & { enabled: () => boolean; externalSignerEnabled: () => boolean; now: () => number; endpoint: () => string | undefined; authority: () => ExternalSignerAuthority | undefined; deliver: typeof requestExternalSignerDelivery };
export function createEnrollmentHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return empty(405);
    if (req.headers.has("Origin") || req.headers.has("Sec-Fetch-Mode")) return empty(403);
    if (!d.enabled() || !d.externalSignerEnabled()) return empty(503);
    if (req.headers.get("Content-Type") !== "application/json") return empty(415);
    try {
      const raw = await boundedJSON(req); if (!raw) return empty(400);
      let requestId: unknown, nodeRole: unknown, fp: unknown;
      if (raw.action === "challenge") {
        if (!exact(raw, ["action", "requestId", "role", "fingerprint"])) return empty(400);
        requestId = raw.requestId; nodeRole = raw.role; fp = raw.fingerprint;
      } else if (raw.action === "attest" || raw.action === "claim") {
        if (!exact(raw, raw.action === "attest" ? ["action", "challenge", "descriptor", "signature"] : ["action", "challenge", "signature"])) return empty(400);
        const c = validateChallenge(raw.challenge, d.now()); requestId = c.requestId; nodeRole = c.role; fp = c.fingerprint;
        if (c.purpose !== raw.action) return empty(400);
      } else return empty(400);
      if (!uuid(requestId) || !role(nodeRole) || !fingerprintOK(fp)) return empty(400);
      const found = await d.rpc("lemtel_node_enrollment_challenge", { p_id: requestId, p_role: nodeRole, p_fingerprint: fp });
      if (!exact(found, ["challenge", "descriptor", "grantedUntil"])) return empty(409);
      const challenge: Challenge = validateChallenge(found.challenge, d.now());
      if (challenge.requestId !== requestId || challenge.role !== nodeRole || challenge.fingerprint !== fp) return empty(409);
      // Public nonce is never identity or bearer authentication; the challenge grants nothing.
      if (raw.action === "challenge") return response({ challenge });
      if (canonical(raw.challenge) !== canonical(challenge)) return empty(409);
      const descriptor: Descriptor = await validateDescriptor(raw.action === "attest" ? raw.descriptor : found.descriptor);
      if (await fingerprint(descriptor) !== fp || !await verifyProof(descriptor, challenge.purpose, challenge, raw.signature)) return empty(401);
      if (raw.action === "attest") {
        if (challenge.purpose !== "attest") return empty(409);
        const result = await d.rpc("lemtel_node_enrollment_attest", { p_id: requestId, p_role: nodeRole, p_fingerprint: fp, p_nonce: challenge.nonce, p_signing_key: descriptor.signingKey, p_encryption_key: descriptor.encryptionKey });
        return result === true ? empty(204) : empty(409);
      }
      if (challenge.purpose !== "claim") return empty(409);
      const endpoint = d.endpoint(); if (!publicationEndpoint(endpoint)) return empty(503);
      const authority = d.authority(); if (!authority) return empty(503);
      await crypto.subtle.importKey("jwk", authority.key, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      if (!Number.isSafeInteger(found.grantedUntil) || (found.grantedUntil as number) <= d.now() || (found.grantedUntil as number) > d.now() + 3600) return empty(409);
      // Durable claim before encryption/response. Failure or a lost response is never retried.
      const consumed = await d.rpc("lemtel_node_enrollment_claim", { p_id: requestId, p_role: nodeRole, p_fingerprint: fp, p_nonce: challenge.nonce });
      if (consumed !== true) return empty(409);
      const sealed = await sealConfig(descriptor, challenge, { format: "lemtel-node-publication-v1", requestId, role: nodeRole, fingerprint: fp, endpoint, grantedUntil: found.grantedUntil as number }, d.now());
      const authorization = await authorizationToken(authority, sealed, challenge, d.now());
      return response(await d.deliver({ purpose: "node_enrollment_publication_delivery", requestId, role: nodeRole, recipientFingerprint: fp, sealed, authorization }));
    } catch { return empty(409); } // Never serialize DB/crypto errors, keys, request or ciphertext.
  };
}
export const handler = createEnrollmentHandler({ ...backend, enabled, externalSignerEnabled, now: () => Math.floor(Date.now() / 1000), endpoint: () => Deno.env.get("LEMTEL_NODE_PUBLICATION_ENDPOINT"), authority: () => externalSignerAuthority(Deno.env.get("LEMTEL_NODE_ENROLLMENT_AUTHORIZATION_PRIVATE_JWK"), Deno.env.get("LEMTEL_NODE_ENROLLMENT_AUTHORIZATION_KEY_ID")), deliver: requestExternalSignerDelivery });
if (import.meta.main) Deno.serve(handler);
