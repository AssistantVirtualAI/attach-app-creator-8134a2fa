// Typed client for the isolated Lemtel UC area. Touches only luc_* tables and luc-* functions.
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type LucRole = "platform_admin" | "tenant_admin" | "tenant_support" | "end_user";
export type Membership = { id: string; tenant_id: string | null; role: LucRole; email: string | null; display_name: string | null; user_id: string };
export type Tenant = { id: string; name: string; slug: string; status: string; seat_limit: number; created_at: string };

// Phase 0: read-only preview. No write helpers exist in this client.
export const READ_ONLY = "Preview is read-only. Live administration remains in the existing Lemtel portal.";

export const lucApi = {
  myMemberships: async (uid: string): Promise<Membership[]> => {
    const { data, error } = await db.from("luc_memberships").select("id,tenant_id,role,email,display_name,user_id").eq("user_id", uid);
    if (error) throw error; return data ?? [];
  },
  tenants: async (): Promise<Tenant[]> => {
    const { data, error } = await db.from("luc_tenants").select("id,name,slug,status,seat_limit,created_at").order("created_at");
    if (error) throw error; return data ?? [];
  },
  list: async (table: string, tenantId: string, cols = "*", order = "created_at", extra?: (q: any) => any) => {
    let q = db.from(table).select(cols).eq("tenant_id", tenantId).order(order, { ascending: false }).limit(200);
    if (extra) q = extra(q);
    const { data, error } = await q; if (error) throw error; return data ?? [];
  },
};

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
