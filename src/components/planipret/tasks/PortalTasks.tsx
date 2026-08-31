import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import TasksSection from "@/components/planipret/mobile/TasksSection";

interface BrokerOption {
  maestro_broker_id: string;
  name: string;
}

/**
 * Page Tâches du portail (admin + courtier). Elle réutilise exactement le même
 * moteur que l'application mobile (`planipret-task-api` → Maestro) et le même
 * composeur, calqué sur l'écran de création de tâches de Maestro.
 *
 * Isolation : un courtier ne voit que ses propres tâches. Un admin voit les
 * siennes par défaut et peut basculer sur un autre courtier (lecture seule).
 */
export default function PortalTasks({ lang }: { lang: "fr" | "en" }) {
  const isFr = lang !== "en";
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [scope, setScope] = useState<string>("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      if (!alive) return;
      setUserId(uid);
      if (!uid) return;
      const { data: p } = await supabase
        .from("planipret_profiles")
        .select("role, full_name, first_name, last_name, maestro_broker_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (!alive) return;
      setProfile(p ?? null);
      const role = String((p as any)?.role ?? "");
      if (role !== "admin" && role !== "planipret_admin" && role !== "super_admin") return;
      const { data: rows } = await supabase
        .from("planipret_profiles")
        .select("full_name, first_name, last_name, maestro_broker_id")
        .not("maestro_broker_id", "is", null)
        .order("full_name", { ascending: true });
      if (!alive) return;
      const seen = new Set<string>();
      const opts: BrokerOption[] = [];
      for (const r of (rows ?? []) as any[]) {
        const id = String(r.maestro_broker_id ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        opts.push({
          maestro_broker_id: id,
          name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || `#${id}`,
        });
      }
      setBrokers(opts);
    })();
    return () => { alive = false; };
  }, []);

  const ownBrokerId = profile?.maestro_broker_id ? String(profile.maestro_broker_id) : "";
  const isAdmin = useMemo(() => {
    const role = String(profile?.role ?? "");
    return role === "admin" || role === "planipret_admin" || role === "super_admin";
  }, [profile]);

  const viewingOther = Boolean(scope) && scope !== ownBrokerId;

  return (
    <div className="max-w-3xl space-y-3">
      {isAdmin && brokers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="pp-task-broker" className="text-xs" style={{ color: "var(--pp-text-muted)" }}>
            {isFr ? "Courtier" : "Broker"}
          </label>
          <select
            id="pp-task-broker"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="min-h-[36px] rounded-lg px-2 text-xs"
            style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}
          >
            <option value="">{isFr ? "Mes tâches" : "My tasks"}</option>
            {brokers.map((b) => (
              <option key={b.maestro_broker_id} value={b.maestro_broker_id}>
                {b.name} · #{b.maestro_broker_id}
              </option>
            ))}
          </select>
          {viewingOther && (
            <span className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.14)", color: "#B45309" }}>
              {isFr ? "Lecture seule" : "Read-only"}
            </span>
          )}
        </div>
      )}

      <TasksSection
        key={scope || "self"}
        userId={userId}
        lang={lang}
        defaultTarget={ownBrokerId || null}
        brokerId={viewingOther ? scope : null}
        readOnly={viewingOther}
      />
    </div>
  );
}
