import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { deny } from "./lemtelNodeEnrollment.ts";
export type Backend = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>; actor: (token: string) => Promise<string | null> };
function client() {
  // Runtime-only: not called by imports, static validation or dependency-injected tests.
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return deny();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(2000) }) } });
}
export const backend: Backend = {
  rpc: async (name, args) => { const { data, error } = await client().rpc(name, args); if (error) return deny(); return data; },
  actor: async (token) => { const { data, error } = await client().auth.getUser(token); return error ? null : data.user?.id ?? null; },
};
export const enabled = () => Deno.env.get("LEMTEL_NODE_ENROLLMENT_ENABLED") === "approved_publication_only";
