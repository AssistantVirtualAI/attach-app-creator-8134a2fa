import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lucApi, type Membership, type Tenant } from "./api";

type Ctx = {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  tenants: Tenant[];
  tenantId: string | null;
  setTenantId: (id: string) => void;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isStaff: boolean;
  refresh: () => Promise<void>;
};

const LucCtx = createContext<Ctx | null>(null);
const KEY = "luc.tenant";

export function LucProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTid] = useState<string | null>(() => sessionStorage.getItem(KEY));

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setMemberships([]); setTenants([]); setLoading(false); return; }
    try {
      const [m, t] = await Promise.all([lucApi.myMemberships(s.user.id), lucApi.tenants()]);
      setMemberships(m); setTenants(t);
      setTid((cur) => (cur && t.some((x) => x.id === cur) ? cur : t[0]?.id ?? null));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); void load(s); });
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); void load(data.session); });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const setTenantId = (id: string) => { sessionStorage.setItem(KEY, id); setTid(id); };
  const isPlatformAdmin = memberships.some((m) => m.role === "platform_admin");
  const isTenantAdmin = isPlatformAdmin || memberships.some((m) => m.tenant_id === tenantId && m.role === "tenant_admin");
  const isStaff = isTenantAdmin || memberships.some((m) => m.tenant_id === tenantId && m.role === "tenant_support");

  return (
    <LucCtx.Provider value={{ session, loading, memberships, tenants, tenantId, setTenantId, isPlatformAdmin, isTenantAdmin, isStaff, refresh: () => load(session) }}>
      {children}
    </LucCtx.Provider>
  );
}

export function useLuc() {
  const c = useContext(LucCtx);
  if (!c) throw new Error("useLuc outside LucProvider");
  return c;
}
