import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { usePlanipretTasks } from "@/hooks/planipret/usePlanipretTasks";
import ClientMaestroDetail from "@/components/planipret/clients/ClientMaestroDetail";

/** Écran par client dans le portail web : tâches, dossiers, commissions, appels. */
export default function PAMaestroClientDetail() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const navigate = useNavigate();
  const { clientKey = "" } = useParams();
  const [params] = useSearchParams();
  const broker = params.get("broker") || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!broker) { setOwnerIds(uid ? [uid] : []); return; }
      const { data: rows } = await supabase
        .from("planipret_profiles")
        .select("user_id, maestro_broker_id")
        .eq("maestro_broker_id", broker)
        .limit(1);
      if (!alive) return;
      const ownerId = (rows ?? [])[0]?.user_id ?? null;
      setOwnerIds(ownerId ? [ownerId] : []);
    })();
    return () => { alive = false; };
  }, [broker]);

  const { tasks, loading, lastSyncAt, setFilter } = usePlanipretTasks(userId, { brokerId: broker || null });
  useEffect(() => { setFilter("all"); }, [setFilter]);

  return (
    <PAPage>
      <PAPageHeader
        icon={<Users className="w-5 h-5" />}
        title={en ? "Client file" : "Fiche client"}
        subtitle={en ? "Tasks, files, commissions and calls for this client." : "Tâches, dossiers, commissions et appels de ce client."}
        actions={
          <button
            onClick={() => navigate(-1)}
            className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5"
            style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> {en ? "Back" : "Retour"}
          </button>
        }
      />
      <ClientMaestroDetail
        clientKey={clientKey}
        tasks={tasks}
        userIds={ownerIds}
        lang={en ? "en" : "fr"}
        lastSyncAt={lastSyncAt}
        loading={loading}
      />
    </PAPage>
  );
}
