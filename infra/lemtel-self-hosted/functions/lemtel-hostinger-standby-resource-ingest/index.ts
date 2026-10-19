// Private Hostinger-standby resource ingress. Observation-only and role-bound: a signed publication, NOT a secure
// enrollment. No DO writer, command, browser or telemetry-history path. The DO writer secret is never accepted here.
import { createClient } from "npm:@supabase/supabase-js@2";
export type HostingerStandbyResources = { observedAt: string; cpuPercent: number; memoryPercent: number; diskPercent: number; load1Milli: number; load5Milli: number; load15Milli: number };
export const HOSTINGER_STANDBY_SECRET_ENV = "LEMTEL_HOSTINGER_STANDBY_PUBLISHER_SECRET";
export const HOSTINGER_STANDBY_SIGNATURE_HEADER = "X-Lemtel-Hostinger-Standby-Resource-Signature";
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 320;
const empty = (status: number) => new Response(null, { status, headers: HEADERS });
const percentage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
const load = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000;
export function validateHostingerStandbyResources(text: string, now: number): HostingerStandbyResources | null {
  let raw: Record<string, unknown>; try { raw = JSON.parse(text); } catch { return null; }
  const keys = ["observedAt", "cpuPercent", "memoryPercent", "diskPercent", "load1Milli", "load5Milli", "load15Milli"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) return null;
  if (typeof raw.observedAt !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(raw.observedAt)) return null;
  const observed = Date.parse(raw.observedAt);
  if (!Number.isFinite(observed) || new Date(observed).toISOString().replace(".000Z", "Z") !== raw.observedAt || observed < now - 180_000 || observed > now + 120_000
    || !percentage(raw.cpuPercent) || !percentage(raw.memoryPercent) || !percentage(raw.diskPercent) || !load(raw.load1Milli) || !load(raw.load5Milli) || !load(raw.load15Milli)) return null;
  const value: HostingerStandbyResources = { observedAt: raw.observedAt, cpuPercent: raw.cpuPercent, memoryPercent: raw.memoryPercent, diskPercent: raw.diskPercent, load1Milli: raw.load1Milli, load5Milli: raw.load5Milli, load15Milli: raw.load15Milli };
  return JSON.stringify(value) === text ? value : null;
}
async function boundedBody(req: Request): Promise<string | null> {
  if (!req.body) return null;
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; } finally { reader.releaseLock(); }
}
type Dependencies = { env: (key: string) => string | undefined; now: () => number; persist: (url: string, key: string, value: HostingerStandbyResources) => Promise<boolean> };
export function createHostingerStandbyResourceHandler(dependencies: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return empty(405);
    if (req.headers.has("Origin") || req.headers.has("Sec-Fetch-Mode") || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers.get("Content-Type") ?? "")) return empty(403);
    try {
      const header = req.headers.get("Content-Length"); if (header !== null && (!/^\d+$/.test(header) || Number(header) > MAX_BODY_BYTES)) return empty(413);
      const text = await boundedBody(req); if (text === null) return empty(413);
      const value = validateHostingerStandbyResources(text, dependencies.now()); if (!value) return empty(400);
      const secret = dependencies.env(HOSTINGER_STANDBY_SECRET_ENV); const proof = req.headers.get(HOSTINGER_STANDBY_SIGNATURE_HEADER);
      if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return empty(503);
      if (!proof || !/^sha256=[a-f0-9]{64}$/.test(proof)) return empty(401);
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const actual = Uint8Array.from(proof.slice(7).match(/../g)!, (byte) => parseInt(byte, 16));
      if (!await crypto.subtle.verify("HMAC", key, actual, new TextEncoder().encode(text))) return empty(401);
      const url = dependencies.env("SUPABASE_URL"), service = dependencies.env("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !service) return empty(503);
      return empty(await dependencies.persist(url, service, value) ? 204 : 503);
    } catch { return empty(503); }
  };
}
export const handler = createHostingerStandbyResourceHandler({
  env: (key) => Deno.env.get(key), now: () => Date.now(),
  persist: async (url, service, value) => {
    const { error } = await createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }).rpc("lemtel_record_hostinger_standby_resource_status", { p_observed_at: value.observedAt, p_cpu_percent: value.cpuPercent, p_memory_percent: value.memoryPercent, p_disk_percent: value.diskPercent, p_load1_milli: value.load1Milli, p_load5_milli: value.load5Milli, p_load15_milli: value.load15Milli });
    return !error;
  },
});
if (import.meta.main) Deno.serve(handler);
