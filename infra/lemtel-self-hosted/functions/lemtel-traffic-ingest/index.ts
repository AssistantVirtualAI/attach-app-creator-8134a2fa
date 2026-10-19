// Private Lemtel aggregate ingress. No request logging, browser access or identifiers.
import { createClient } from "npm:@supabase/supabase-js@2";

export type TrafficEnvelope = {
  nodeRole: "do_writer" | "hostinger_standby";
  observedAt: string;
  periodSeconds: number;
  rxBytes: number;
  txBytes: number;
  tcpEstablished: number;
};
export const HOSTINGER_STANDBY_TRAFFIC_SECRET_ENV = "LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET";
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 512;
const empty = (status: number) => new Response(null, { status, headers: HEADERS });
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/** Exact canonical compact JSON also rejects duplicate keys and alternate encodings. */
export function validateEnvelope(text: string, now: number): TrafficEnvelope | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = ["nodeRole", "observedAt", "periodSeconds", "rxBytes", "txBytes", "tcpEstablished"];
  if (Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) return null;
  if (raw.nodeRole !== "do_writer" && raw.nodeRole !== "hostinger_standby") return null;
  if (typeof raw.observedAt !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(raw.observedAt)) return null;
  const timestamp = Date.parse(raw.observedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().replace(".000Z", "Z") !== raw.observedAt
    || timestamp < Date.UTC(2026, 0, 1) || timestamp >= Date.UTC(2100, 0, 1)
    || timestamp < now - 180_000 || timestamp > now + 120_000) return null;
  if (!integer(raw.periodSeconds, 30, 300) || !integer(raw.rxBytes, 0, 1_000_000_000_000)
    || !integer(raw.txBytes, 0, 1_000_000_000_000) || !integer(raw.tcpEstablished, 0, 1_000_000)) return null;
  const value: TrafficEnvelope = {
    nodeRole: raw.nodeRole, observedAt: raw.observedAt, periodSeconds: raw.periodSeconds,
    rxBytes: raw.rxBytes, txBytes: raw.txBytes, tcpEstablished: raw.tcpEstablished,
  };
  return JSON.stringify(value) === text ? value : null;
}

async function boundedBody(req: Request): Promise<string | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; } finally { reader.releaseLock(); }
}

type Dependencies = {
  env: (key: string) => string | undefined;
  now: () => number;
  persist: (url: string, key: string, envelope: TrafficEnvelope) => Promise<"inserted" | "duplicate" | "failed">;
};

export function createTrafficHandler(dependencies: Dependencies) {
  return async (req: Request): Promise<Response> => {
    // No Access-Control-Allow-Origin header, no origin reflection, no browser ingestion.
    if (req.method === "OPTIONS") return empty(204);
    if (req.method !== "POST") return empty(405);
    if (req.headers.has("Origin")) return empty(403);
    try {
      const secret = dependencies.env("LEMTEL_TRAFFIC_COLLECTOR_SECRET");
      if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return empty(503);
      const signature = req.headers.get("X-Lemtel-Traffic-Signature");
      if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return empty(401);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers.get("Content-Type") ?? "")) return empty(415);
      const length = req.headers.get("Content-Length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return empty(413);
      const text = await boundedBody(req);
      if (text === null) return empty(413);
      const envelope = validateEnvelope(text, dependencies.now());
      if (!envelope) return empty(400);
      // Role-bound secrets: the DO collector secret can only write do_writer rows, and the Hostinger standby
      // publisher secret can only write hostinger_standby rows (signed publication, not a secure enrollment).
      const roleSecret = envelope.nodeRole === "do_writer" ? secret : dependencies.env(HOSTINGER_STANDBY_TRAFFIC_SECRET_ENV);
      if (!roleSecret || !/^[a-f0-9]{64}$/.test(roleSecret) || (envelope.nodeRole === "hostinger_standby" && roleSecret === secret)) return empty(503);
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(roleSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const proof = Uint8Array.from(signature.slice(7).match(/../g)!, (byte) => parseInt(byte, 16));
      if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode(text))) return empty(401);
      const url = dependencies.env("SUPABASE_URL");
      const serviceKey = dependencies.env("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) return empty(503);
      const result = await dependencies.persist(url, serviceKey, envelope);
      return empty(result === "failed" ? 503 : 204);
    } catch { return empty(503); }
  };
}

export const handler = createTrafficHandler({
  env: (key) => Deno.env.get(key), now: () => Date.now(),
  persist: async (url, key, envelope) => {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("lemtel_traffic_samples").insert({
      node_role: envelope.nodeRole, observed_at: envelope.observedAt,
      period_seconds: envelope.periodSeconds, rx_bytes: envelope.rxBytes, tx_bytes: envelope.txBytes,
      tcp_established: envelope.tcpEstablished, collector_state: "collecting",
    });
    return !error ? "inserted" : error.code === "23505" ? "duplicate" : "failed";
  },
});
if (import.meta.main) Deno.serve(handler);
