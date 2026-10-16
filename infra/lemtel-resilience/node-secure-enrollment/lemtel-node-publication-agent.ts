// Source-only local preparation. No transport, subprocess, runtime command or environment discovery.
import { b64, canonical, deny, exact, fingerprint, generateNodeKeys, observationText, openDelivery, publicationEndpoint, role, signProof, unb64, validateChallenge, validateConfig, type Descriptor, type Delivery } from "../../lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts";
const CONFIG = "/etc/lemtel-node-publication", STATE = "/var/lib/lemtel-node-publication";
const now = () => Math.floor(Date.now() / 1000);
export function safeMetadata(v: Pick<Deno.FileInfo, "uid" | "gid" | "mode" | "nlink" | "isFile" | "isDirectory" | "isSymlink">, mode?: number) {
  if (v.uid !== 0 || v.gid !== 0 || v.isSymlink || v.mode === null || (v.mode & 0o022) !== 0) return false;
  return mode === undefined ? v.isDirectory : v.isFile && v.nlink === 1 && (v.mode & 0o777) === mode;
}
async function secure(path: string, mode?: number) {
  let part = ""; const parts = path.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    part += "/" + parts[i];
    const meta = await Deno.lstat(part);
    if (!safeMetadata(meta, i === parts.length - 1 ? mode : undefined)) return deny();
  }
  const meta = await Deno.lstat(path);
  if (mode === undefined && (meta.mode! & 0o777) !== 0o700 && [CONFIG, STATE].includes(path)) return deny();
  return meta;
}
async function read(path: string, limit = 4096): Promise<unknown> {
  const before = await secure(path, 0o600), file = await Deno.open(path, { read: true });
  try {
    const after = await file.stat();
    if (!safeMetadata(after, 0o600) || after.ino !== before.ino || after.dev !== before.dev || after.size > limit) return deny();
    const raw = new Uint8Array(limit + 1); let total = 0;
    for (;;) { const n = await file.read(raw.subarray(total)); if (n === null) break; total += n; if (total > limit) return deny(); }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(0, total)), value = JSON.parse(text);
    if (text !== canonical(value)) return deny();
    return value;
  } finally { file.close(); }
}
async function writeNew(path: string, value: unknown) {
  await secure(path.slice(0, path.lastIndexOf("/")));
  const file = await Deno.open(path, { write: true, createNew: true, mode: 0o600 });
  try {
    const raw = new TextEncoder().encode(canonical(value)); let offset = 0;
    while (offset < raw.length) offset += await file.write(raw.subarray(offset));
    await file.sync();
  } finally { file.close(); }
  const parent = await Deno.open(path.slice(0, path.lastIndexOf("/")), { read: true });
  try { await parent.sync(); } finally { parent.close(); }
}
async function localKeys() {
  const value = await read(CONFIG + "/keys.json");
  if (!exact(value, ["descriptor", "signingPrivate", "encryptionPrivate"])) return deny();
  const signing = value.signingPrivate as JsonWebKey, encryption = value.encryptionPrivate as JsonWebKey, descriptor = value.descriptor as Descriptor;
  if (!signing?.d || !encryption?.d) return deny();
  // Prove local private material and descriptor are the same keys, not swapped files.
  const publicRaw = async (jwk: JsonWebKey, name: string, usage: KeyUsage[]) => {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name, namedCurve: "P-256" }, true, usage);
    return b64(await crypto.subtle.exportKey("raw", key));
  };
  if (descriptor.signingKey !== await publicRaw(signing, "ECDSA", ["verify"]) || descriptor.encryptionKey !== await publicRaw(encryption, "ECDH", [])) return deny();
  await fingerprint(descriptor);
  return { descriptor, signing, encryption };
}
async function main(mode: string) {
  if (Deno.uid() !== 0 || Deno.args.length !== 1) return deny();
  await secure(CONFIG); await secure(STATE);
  if (mode === "init") {
    if (Deno.env.get("LEMTEL_NODE_LOCAL_APPROVAL") !== "generate_publication_keys_only") return deny();
    // No overwrites/rotation. Partial failures require explicit local review.
    const keys = await generateNodeKeys();
    await writeNew(CONFIG + "/keys.json", keys);
    console.log("status=initialized fingerprint=" + await fingerprint(keys.descriptor));
    return;
  }
  if (!["check", "attest", "claim-proof", "accept", "observation-proof"].includes(mode)) return deny();
  const keys = await localKeys(), fp = await fingerprint(keys.descriptor);
  if (mode === "check") { console.log("status=prepared_no_network"); return; }
  if (mode === "attest" || mode === "claim-proof" || mode === "accept") {
    const challenge = validateChallenge(await read(CONFIG + "/challenge.json"), now());
    const identity = await read(CONFIG + "/binding.json");
    if (!exact(identity, ["requestId", "role", "fingerprint", "endpoint", "platformSigningKey"]) || !role(identity.role) || identity.requestId !== challenge.requestId || identity.role !== challenge.role || identity.fingerprint !== fp || challenge.fingerprint !== fp
      || !publicationEndpoint(identity.endpoint) || typeof identity.platformSigningKey !== "string") return deny();
    await crypto.subtle.importKey("raw", unb64(identity.platformSigningKey, 65), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (mode === "accept") {
      if (challenge.purpose !== "claim") return deny();
      // Durable local one-shot claim BEFORE decrypting, even on corruption or unknown response.
      await writeNew(STATE + "/claim-" + challenge.requestId + ".consumed", { state: "consumed" });
      const config = await openDelivery(keys.encryption, await read(CONFIG + "/sealed.json") as Delivery, challenge, identity.platformSigningKey, identity.endpoint, now());
      await writeNew(CONFIG + "/publication.json", config);
    } else {
      const purpose = mode === "attest" ? "attest" : "claim";
      if (challenge.purpose !== purpose) return deny();
      const signature = await signProof(keys.signing, purpose, challenge);
      const wire = purpose === "attest" ? { action: purpose, challenge, descriptor: keys.descriptor, signature } : { action: purpose, challenge, signature };
      await writeNew(STATE + "/" + purpose + "-" + challenge.requestId + ".json", wire);
    }
    console.log("status=prepared_no_network"); return;
  }
  const configValue = await read(CONFIG + "/publication.json");
  if (!exact(configValue, ["format", "requestId", "role", "fingerprint", "endpoint", "grantedUntil"]) || configValue.fingerprint !== fp) return deny();
  const config = validateConfig(configValue, { requestId: configValue.requestId as string, role: configValue.role as "do_writer" | "hostinger_standby", fingerprint: fp, purpose: "claim", nonce: "0".repeat(64), expiresAt: now() + 1 }, now());
  const binding = await read(CONFIG + "/binding.json");
  if (!exact(binding, ["requestId", "role", "fingerprint", "endpoint", "platformSigningKey"]) || binding.requestId !== config.requestId || binding.role !== config.role
    || binding.fingerprint !== fp || binding.endpoint !== config.endpoint || typeof binding.platformSigningKey !== "string") return deny();
  await crypto.subtle.importKey("raw", unb64(binding.platformSigningKey, 65), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const claimState = await read(STATE + "/claim-" + config.requestId + ".consumed");
  if (!exact(claimState, ["state"]) || claimState.state !== "consumed") return deny();
  const observed = await read(CONFIG + "/observation.json", 384), envelopeText = observationText(observed, now());
  if ((observed as Record<string, unknown>).nodeRole !== config.role) return deny();
  // Sequence ledger uses createNew per slot. Replays/concurrent preparations cannot reuse a sequence.
  let last = 0;
  for await (const entry of Deno.readDir(STATE)) {
    const match = entry.name.match(new RegExp("^seq-" + config.requestId + "-([1-9][0-9]{0,15})\\.consumed$"));
    if (match) { await secure(STATE + "/" + entry.name, 0o600); const n = Number(match[1]); if (!Number.isSafeInteger(n)) return deny(); last = Math.max(last, n); }
  }
  if (last >= Number.MAX_SAFE_INTEGER) return deny();
  const sequence = last + 1;
  await writeNew(STATE + "/seq-" + config.requestId + "-" + sequence + ".consumed", { state: "consumed" });
  const payload = { requestId: config.requestId, role: config.role, fingerprint: fp, sequence, envelope: envelopeText };
  const signature = await signProof(keys.signing, "observe", payload);
  await writeNew(STATE + "/observation-" + config.requestId + "-" + sequence + ".json", { ...payload, signature });
  console.log("status=prepared_no_network");
}
if (import.meta.main) {
  try { await main(Deno.args[0] ?? ""); } catch { console.error("status=blocked"); Deno.exitCode = 78; }
}
