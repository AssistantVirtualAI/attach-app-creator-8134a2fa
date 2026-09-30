// Lemtel UC shared helpers. Isolated from Planipret: touches only luc_* tables.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

export { corsHeaders };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export async function requireUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await c.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export type LucRole = "platform_admin" | "tenant_admin" | "tenant_support" | "end_user";

export async function hasRole(db: SupabaseClient, uid: string, tenantId: string | null, roles: LucRole[]): Promise<boolean> {
  const { data } = await db.from("luc_memberships").select("role,tenant_id").eq("user_id", uid);
  return (data ?? []).some((m: any) => m.role === "platform_admin" || (tenantId && m.tenant_id === tenantId && roles.includes(m.role)));
}

async function key(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(Deno.env.get("LUC_CRED_KEY") ?? "");
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

/** AES-GCM; only ciphertext is ever stored. Never returned to clients. */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function hmacHex(body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("LUC_EDGE_SECRET") ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
