// deno-lint-ignore-file require-await
// Async dependency mocks deliberately implement the production Promise-based RPC contract.
import { strict as assert } from "node:assert";
import { canonical, fingerprint, generateNodeKeys, observationText, openConfig, openDelivery, publicationEndpoint, sealConfig, signDelivery, signProof, unb64, validateChallenge, validateDescriptor, verifyProof, type Challenge } from "../_shared/lemtelNodeEnrollment.ts";
import { authorizationToken, exchangeExternalSigner } from "../_shared/lemtelExternalPlatformSigner.ts";
import { createEnrollmentHandler } from "./index.ts";
import { createEnrollmentAdminHandler } from "../lemtel-node-enrollment-admin/index.ts";
import { createSignedStatusHandler } from "../lemtel-node-status-signed-ingest/index.ts";
import { safeMetadata } from "../../../lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts";
// Ephemeral synthetic test keys in memory only: no node initialization, runtime secret, files or transport.
const now = 1790000040;
const id = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222";
const endpoint = "https://publication.invalid/functions/v1/lemtel-node-status-signed-ingest";
const keys = await generateNodeKeys(), platform = await generateNodeKeys(), fp = await fingerprint(keys.descriptor);
const authority = { key: platform.signingPrivate, keyId: "f".repeat(64) };
const directExternalDelivery = async (request: { sealed: Awaited<ReturnType<typeof sealConfig>> }) => signDelivery(request.sealed, platform.signingPrivate);
const challenge: Challenge = { requestId: id, role: "do_writer", fingerprint: fp, purpose: "attest", nonce: "a".repeat(64), expiresAt: now + 120 };
const config = { format: "lemtel-node-publication-v1" as const, requestId: id, role: "do_writer" as const, fingerprint: fp, endpoint, grantedUntil: now + 1800 };
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://test.invalid/functions/v1/lemtel-node-enrollment", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : canonical(body) });
Deno.test("separate P-256 keys, domain-separated proof and strict descriptor pinning", async () => {
  const signature = await signProof(keys.signingPrivate, "attest", challenge);
  assert.equal(await verifyProof(keys.descriptor, "attest", challenge, signature), true);
  assert.equal(await verifyProof(keys.descriptor, "claim", challenge, signature), false);
  assert.equal(await verifyProof(keys.descriptor, "attest", { ...challenge, role: "hostinger_standby" }, signature), false);
  assert.equal(await verifyProof(keys.descriptor, "attest", { ...challenge, fingerprint: "sha256:" + "0".repeat(64) }, signature), false);
  await assert.rejects(() => validateDescriptor({ ...keys.descriptor, signingPrivate: {} }));
  await assert.rejects(() => validateDescriptor({ signingKey: keys.descriptor.signingKey, encryptionKey: keys.descriptor.signingKey }));
  assert.throws(() => unb64(keys.descriptor.signingKey + "="));
});
Deno.test("ECDH/HKDF/AES-GCM roundtrip, authenticated metadata, tampering and expiry", async () => {
  const c: Challenge = { ...challenge, purpose: "claim" };
  const sealed = await sealConfig(keys.descriptor, c, config, now);
  assert.deepEqual(await openConfig(keys.encryptionPrivate, sealed, c, now), config);
  const delivery = await signDelivery(sealed, platform.signingPrivate);
  assert.deepEqual(await openDelivery(keys.encryptionPrivate, delivery, c, platform.descriptor.signingKey, endpoint, now), config);
  await assert.rejects(() => openDelivery(keys.encryptionPrivate, delivery, c, keys.descriptor.signingKey, endpoint, now));
  await assert.rejects(() => openDelivery(keys.encryptionPrivate, delivery, c, platform.descriptor.signingKey, endpoint.replace("publication.invalid", "other.invalid"), now));
  const forged = await signDelivery(sealed, keys.signingPrivate);
  await assert.rejects(() => openDelivery(keys.encryptionPrivate, forged, c, platform.descriptor.signingKey, endpoint, now));
  const last = sealed.ciphertext.slice(-2); const corrupt = sealed.ciphertext.slice(0, -2) + (last === "AA" ? "BA" : "AA");
  await assert.rejects(() => openConfig(keys.encryptionPrivate, { ...sealed, ciphertext: corrupt }, c, now));
  await assert.rejects(() => openConfig(keys.encryptionPrivate, sealed, { ...c, role: "hostinger_standby" }, now));
  await assert.rejects(() => openConfig(keys.encryptionPrivate, sealed, c, c.expiresAt));
  await assert.rejects(() => sealConfig(keys.descriptor, challenge, config, now));
  assert.throws(() => validateChallenge({ ...c, expiresAt: now + 301 }, now));
  for (const value of ["http://publication.invalid/functions/v1/lemtel-node-status-signed-ingest", "https://127.0.0.1/functions/v1/lemtel-node-status-signed-ingest", endpoint + "?secret=synthetic", endpoint.replace("publication.invalid", "user@publication.invalid"), endpoint.replace("signed-ingest", "command")]) assert.equal(publicationEndpoint(value), false);
});
Deno.test("enrollment only consumes verified exact bound attestation, rejecting malformed/browser/replays", async () => {
  let state = "invited", writes = 0;
  const handler = createEnrollmentHandler({ enabled: () => true, externalSignerEnabled: () => true, now: () => now, endpoint: () => endpoint, authority: () => authority, deliver: directExternalDelivery, rpc: async (name) => {
    if (name.endsWith("challenge")) return state === "invited" ? { challenge, descriptor: null, grantedUntil: null } : null;
    if (name.endsWith("attest")) { assert.equal(state, "invited"); state = "pending"; writes++; return true; }
    throw new Error("unexpected");
  } });
  const signature = await signProof(keys.signingPrivate, "attest", challenge), body = { action: "attest", challenge, descriptor: keys.descriptor, signature };
  assert.equal((await handler(request(body, { Origin: "https://test.invalid" }))).status, 403);
  assert.equal((await handler(request(body, { "Sec-Fetch-Mode": "cors" }))).status, 403);
  assert.equal((await handler(request({ ...body, extra: "synthetic" }))).status, 400);
  assert.equal((await handler(request("{" + '"action":"attest","action":"attest"' + "}"))).status, 400);
  assert.equal((await handler(request(" "+canonical(body)))).status, 400);
  assert.equal((await handler(request("x".repeat(2049)))).status, 400);
  assert.equal((await handler(request({ ...body, signature: "A".repeat(86) }))).status, 401);
  assert.equal((await handler(request({ ...body, challenge: { ...challenge, nonce: "b".repeat(64) } }))).status, 409);
  assert.equal(writes, 0);
  assert.equal((await handler(request(body))).status, 204);
  assert.equal((await handler(request(body))).status, 409);
  assert.equal(writes, 1);
});
Deno.test("claim requires explicit approval, returns ciphertext only to node, burns on loss or crypto error", async () => {
  const c: Challenge = { ...challenge, purpose: "claim" }; let state = "approved", claims = 0;
  const rpc = async (name: string) => {
    if (name.endsWith("challenge")) return state === "approved" ? { challenge: c, descriptor: keys.descriptor, grantedUntil: config.grantedUntil } : null;
    if (name.endsWith("claim")) { state = "delivered"; claims++; return true; }
    throw new Error("unexpected");
  };
  const handler = createEnrollmentHandler({ enabled: () => true, externalSignerEnabled: () => true, now: () => now, endpoint: () => endpoint, authority: () => authority, deliver: directExternalDelivery, rpc });
  const body = { action: "claim", challenge: c, signature: await signProof(keys.signingPrivate, "claim", c) };
  const reply = await handler(request(body)); assert.equal(reply.status, 200);
  const text = await reply.text(); assert.equal(text.includes(endpoint), false); assert.equal(text.includes('"descriptor"'), false);
  assert.deepEqual(await openDelivery(keys.encryptionPrivate, JSON.parse(text), c, platform.descriptor.signingKey, endpoint, now), config);
  assert.equal((await handler(request(body))).status, 409); assert.equal(claims, 1);
  state = "approved";
  const fail = createEnrollmentHandler({ enabled: () => true, externalSignerEnabled: () => true, now: () => now, endpoint: () => endpoint, authority: () => authority, deliver: directExternalDelivery, rpc: async (name) => {
    const value = await rpc(name); if (name.endsWith("claim")) throw new Error("unknown_response_synthetic"); return value;
  } });
  assert.equal((await fail(request(body))).status, 409); assert.equal(state, "delivered");
  assert.equal((await fail(request(body))).status, 409);
  const disabled = createEnrollmentHandler({ enabled: () => false, externalSignerEnabled: () => false, now: () => now, endpoint: () => { throw new Error("not_called"); }, authority: () => { throw new Error("not_called"); }, deliver: async () => { throw new Error("not_called"); }, rpc: async () => { throw new Error("not_called"); } });
  assert.equal((await disabled(request(body))).status, 503);
});
Deno.test("platform-admin only, verified actor is not body-controlled, exact approval and redacted response", async () => {
  let active = false, calls = 0;
  const h = createEnrollmentAdminHandler({ enabled: () => true, actor: async () => actor, rpc: async (name, args) => {
    assert.equal(args.p_actor, actor);
    if (name.endsWith("is_admin")) return active;
    calls++; return { requestId: id, role: challenge.role, fingerprint: fp, state: "approved_publication_only", expiresAt: now + 300,
      nonce: "synthetic_ignored", signingKey: "synthetic_ignored", ciphertext: "synthetic_ignored", endpoint: "synthetic_ignored" };
  } });
  const auth = { Authorization: "Bearer " + "synthetic-token-value-00001" };
  const body = { action: "approve", requestId: id, role: challenge.role, fingerprint: fp, confirmation: "APPROVE_PUBLICATION_ONLY", evidence: "OUT_OF_BAND_KEY_VERIFIED" };
  assert.equal((await h(request(body))).status, 401);
  assert.equal((await h(request(body, auth))).status, 403); assert.equal(calls, 0);
  active = true;
  assert.equal((await h(request({ ...body, actorId: actor }, auth))).status, 400);
  assert.equal((await h(request({ ...body, evidence: "TRUST_SELF_CLAIM" }, auth))).status, 400);
  const reply = await h(request(body, auth)); assert.equal(reply.status, 200);
  const result = await reply.json(); assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "fingerprint", "requestId", "role", "state"].sort()); assert.equal(calls, 1);
});
Deno.test("external signer receives one canonical, request-bound delivery and no local signing fallback", async () => {
  const c: Challenge = { ...challenge, purpose: "claim" };
  const sealed = await sealConfig(keys.descriptor, c, { ...config, requestId: c.requestId, role: c.role, fingerprint: c.fingerprint }, now);
  const authorization = await authorizationToken(authority, sealed, c, now);
  const outbound = { purpose: "node_enrollment_publication_delivery" as const, requestId: c.requestId, role: c.role, recipientFingerprint: c.fingerprint, sealed, authorization };
  const received = await exchangeExternalSigner(outbound, async (raw) => {
    assert.equal(raw, canonical(outbound));
    assert.equal(JSON.parse(raw).sealed.challenge.nonce, c.nonce);
    return canonical(await directExternalDelivery(outbound));
  });
  assert.deepEqual(await openDelivery(keys.encryptionPrivate, received, c, platform.descriptor.signingKey, endpoint, now), config);
  await assert.rejects(() => exchangeExternalSigner(outbound, async () => canonical({ sealed: { ...sealed, iv: sealed.iv.slice(1) }, signature: "A".repeat(86) })));
  const h = createEnrollmentHandler({ enabled: () => true, externalSignerEnabled: () => false, now: () => now, endpoint: () => endpoint, authority: () => authority, deliver: directExternalDelivery, rpc: async () => { throw new Error("not_called"); } });
  assert.equal((await h(request({ action: "challenge", requestId: c.requestId, role: c.role, fingerprint: c.fingerprint }))).status, 503);
});
Deno.test("signed observations require delivered live binding and monotonic atomic write", async () => {
  let seq = 0, available = true;
  const h = createSignedStatusHandler({ enabled: () => true, now: () => now, rpc: async (name, args) => {
    if (name.endsWith("lookup")) return available ? { descriptor: keys.descriptor, grantedUntil: config.grantedUntil } : null;
    const n = args.p_sequence as number; if (n <= seq) throw new Error("replay"); seq = n; return true;
  } });
  const envelope = JSON.stringify({ nodeRole: "do_writer", observedAt: new Date(now * 1000).toISOString().replace(".000Z", "Z"), agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" });
  const payload = { requestId: id, role: "do_writer", fingerprint: fp, sequence: 1, envelope }, body = { ...payload, signature: await signProof(keys.signingPrivate, "observe", payload) };
  assert.equal((await h(request({ ...body, signature: "A".repeat(86) }))).status, 401); assert.equal(seq, 0);
  assert.equal((await h(request(body))).status, 204);
  assert.equal((await h(request(body))).status, 409);
  assert.equal((await h(request({ ...body, hostname: "not-permitted.invalid" }))).status, 400);
  available = false; assert.equal((await h(request(body))).status, 409);
});
Deno.test("local canonical observation encoding keeps PR275 field order and rejects false identity fields", () => {
  const observation = { nodeRole: "do_writer", observedAt: new Date(now * 1000).toISOString().replace(".000Z", "Z"), agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" };
  assert.equal(observationText(JSON.parse(canonical(observation)), now), JSON.stringify(observation));
  assert.throws(() => observationText({ ...observation, hostname: "not-permitted.invalid" }, now));
  assert.throws(() => observationText({ ...observation, agentState: "unverified_healthy" }, now));
});
Deno.test("root-only metadata refuses symlink, hardlink, missing ownership and writable parents", () => {
  const v = { uid: 0, gid: 0, mode: 0o100600, nlink: 1, isFile: true, isDirectory: false, isSymlink: false };
  assert.equal(safeMetadata(v, 0o600), true);
  for (const change of [{ uid: 1000 }, { gid: 1000 }, { nlink: 2 }, { isSymlink: true }, { mode: 0o100644 }, { mode: null }]) assert.equal(safeMetadata({ ...v, ...change }, 0o600), false);
  assert.equal(safeMetadata({ ...v, isFile: false, isDirectory: true, mode: 0o40700 }), true);
  assert.equal(safeMetadata({ ...v, isFile: false, isDirectory: true, mode: 0o40770 }), false);
});
Deno.test("slow request body is cancelled at the fixed two-second deadline", async () => {
  let cancelled = false, calls = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  const h = createEnrollmentHandler({ enabled: () => true, externalSignerEnabled: () => true, now: () => now, endpoint: () => endpoint, authority: () => authority, deliver: directExternalDelivery, rpc: async () => { calls++; throw new Error("not_called"); } });
  const reply = await h(new Request("https://test.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }));
  assert.equal(reply.status, 400); assert.equal(cancelled, true); assert.equal(calls, 0);
});
