// Private Lemtel node-status ingress. It receives observations only; it cannot command a node.
import { createClient } from "npm:@supabase/supabase-js@2";

export type NodeRole = "do_writer" | "hostinger_standby";
export type AgentState = "healthy" | "degraded" | "unknown";
export type RuntimeState = "ready" | "degraded" | "unknown";
export type ReplicationState = "streaming" | "degraded" | "unknown";
export type StorageState = "synced" | "degraded" | "unknown";
export type NodeStatusEnvelope = {
  nodeRole: NodeRole;
  observedAt: string;
  agentState: AgentState;
  runtimeState: RuntimeState;
  replicationState: ReplicationState;
  storageState: StorageState;
};

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 384;
const PAST_SKEW_MS = 180_000;
const FUTURE_SKEW_MS = 120_000;
const empty = (status: number) => new Response(null, { status, headers: HEADERS });
const isState = (value: unknown): value is AgentState => value === "healthy" || value === "degraded" || value === "unknown";
const isRuntime = (value: unknown): value is RuntimeState => value === "ready" || value === "degraded" || value === "unknown";
const isReplication = (value: unknown): value is ReplicationState => value === "streaming" || value === "degraded" || value === "unknown";
const isStorage = (value: unknown): value is StorageState => value === "synced" || value === "degraded" || value === "unknown";

/** Exact compact JSON rejects duplicate keys, whitespace and alternate encodings. */
export function validateEnvelope(text: string, now: number): NodeStatusEnvelope | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = ["nodeRole", "observedAt", "agentState", "runtimeState", "replicationState", "storageState"];
  if (Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) return null;
  if (raw.nodeRole !== "do_writer" && raw.nodeRole !== "hostinger_standby") return null;
  if (typeof raw.observedAt !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(raw.observedAt)) return null;
  const timestamp = Date.parse(raw.observedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().replace(".000Z", "Z") !== raw.observedAt
    || timestamp < Date.UTC(2026, 0, 1) || timestamp >= Date.UTC(2100, 0, 1)
    || timestamp < now - PAST_SKEW_MS || timestamp > now + FUTURE_SKEW_MS
    || !isState(raw.agentState) || !isRuntime(raw.runtimeState) || !isReplication(raw.replicationState) || !isStorage(raw.storageState)) return null;
  const envelope: NodeStatusEnvelope = {
    nodeRole: raw.nodeRole, observedAt: raw.observedAt, agentState: raw.agentState,
    runtimeState: raw.runtimeState, replicationState: raw.replicationState, storageState: raw.storageState,
  };
  return JSON.stringify(envelope) === text ? envelope : null;
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

function secretName(role: NodeRole) {
  return role === "do_writer"
    ? "LEMTEL_NODE_STATUS_DO_WRITER_SECRET"
    : "LEMTEL_NODE_STATUS_HOSTINGER_STANDBY_SECRET";
}

type Dependencies = {
  env: (key: string) => string | undefined;
  now: () => number;
  persist: (url: string, key: string, envelope: NodeStatusEnvelope) => Promise<"recorded" | "failed">;
};

export function createNodeStatusHandler(dependencies: Dependencies) {
  return async (req: Request): Promise<Response> => {
    // There is deliberately no CORS preflight path: only non-browser POST is accepted.
    if (req.method !== "POST") return empty(405);
    if (req.headers.has("Origin") || req.headers.has("Sec-Fetch-Mode")) return empty(403);
    try {
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers.get("Content-Type") ?? "")) return empty(415);
      const length = req.headers.get("Content-Length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return empty(413);
      const signature = req.headers.get("X-Lemtel-Node-Status-Signature");
      if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return empty(401);
      const text = await boundedBody(req);
      if (text === null) return empty(413);
      const envelope = validateEnvelope(text, dependencies.now());
      if (!envelope) return empty(400);
      const secret = dependencies.env(secretName(envelope.nodeRole));
      if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return empty(503);
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const proof = Uint8Array.from(signature.slice(7).match(/../g)!, (byte) => parseInt(byte, 16));
      if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode(text))) return empty(401);
      const url = dependencies.env("SUPABASE_URL");
      const serviceKey = dependencies.env("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) return empty(503);
      return empty((await dependencies.persist(url, serviceKey, envelope)) === "recorded" ? 204 : 503);
    } catch { return empty(503); }
  };
}

export const handler = createNodeStatusHandler({
  env: (key) => Deno.env.get(key), now: () => Date.now(),
  persist: async (url, key, envelope) => {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.rpc("lemtel_record_node_status", {
      p_node_role: envelope.nodeRole, p_observed_at: envelope.observedAt, p_agent_state: envelope.agentState,
      p_runtime_state: envelope.runtimeState, p_replication_state: envelope.replicationState, p_storage_state: envelope.storageState,
    });
    return error ? "failed" : "recorded";
  },
});

if (import.meta.main) Deno.serve(handler);
