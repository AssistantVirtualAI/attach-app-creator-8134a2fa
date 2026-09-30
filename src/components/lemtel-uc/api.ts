// Typed client for the isolated Lemtel UC area. Touches only luc_* tables and luc-* functions.
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type LucRole = "platform_admin" | "tenant_admin" | "tenant_support" | "end_user";
export type Membership = { id: string; tenant_id: string | null; role: LucRole; email: string | null; display_name: string | null; user_id: string };
export type Tenant = { id: string; name: string; slug: string; status: string; seat_limit: number; created_at: string };

async function fn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

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
  bootstrap: () => fn("luc-provision", { action: "bootstrap" }),
  createTenant: (name: string, slug: string) => fn("luc-provision", { action: "create_tenant", name, slug }),
  createPbx: (tenant_id: string, name: string, pbx_domain: string, api_credential?: string) => fn("luc-provision", { action: "create_pbx_connection", tenant_id, name, pbx_domain, api_credential }),
  provisionUser: (p: { tenant_id: string; email: string; extension: string; role: LucRole; display_name?: string; sip_password?: string; pbx_connection_id?: string }) => fn("luc-provision", { action: "provision_user", ...p }),
  simulate: (tenant_id: string, user_id?: string) => fn("luc-provision", { action: "simulate_events", tenant_id, user_id }),
  enrollDevice: (tenant_id: string, label: string, platform: string) => fn("luc-device", { action: "enroll", tenant_id, label, platform }),
  deviceAction: (tenant_id: string, device_id: string, action: "revoke" | "renew") => fn("luc-device", { action, tenant_id, device_id }),
  pbx: (tenant_id: string, connection_id: string, action: "validate" | "sync_extensions") => fn("luc-pbx-adapter", { tenant_id, connection_id, action }),
};

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
