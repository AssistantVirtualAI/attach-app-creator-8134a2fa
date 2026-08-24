import { useEffect, useState } from "react";
import { TrendingUp, Cloud, CheckCircle2 } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import MaestroReconnectButton from "@/components/planipret/commissions/MaestroReconnectButton";
import MaestroSyncDiagnostics from "@/components/planipret/commissions/MaestroSyncDiagnostics";
import RegisterCommissions from "@/components/planipret/commissions/RegisterCommissions";
import MaestroConnectCard from "@/components/planipret/mobile/MaestroConnectCard";
import { supabase } from "@/integrations/supabase/client";

export default function PBCommissions() {
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const [maestroConnected, setMaestroConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data } = await supabase.functions.invoke("maestro-oauth-status", {
          body: {},
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        const d = (data ?? {}) as any;
        if (!cancelled) setMaestroConnected(Boolean(d?.connected || d?.status === "connected"));
      } catch {
        if (!cancelled) setMaestroConnected(false);
      }
    };
    void check();
    const onConnected = () => void check();
    window.addEventListener("maestro:connected", onConnected);
    return () => { cancelled = true; window.removeEventListener("maestro:connected", onConnected); };
  }, []);

  return (
    <PAPage>
      <PAPageHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title={isFr ? "Mes commissions" : "My commissions"}
        subtitle={isFr
          ? "Votre performance et la répartition de vos commissions"
          : "Your personal performance and commission breakdown"}
      />

      {maestroConnected === false && (
        <div className="max-w-xl mb-3">
          <p className="mb-2 flex items-center gap-1.5" style={{ fontSize: 12.5, color: "var(--pp-text-muted)" }}>
            <Cloud className="w-3.5 h-3.5" />
            {isFr
              ? "Connectez votre compte Maestro pour garder vos commissions à jour automatiquement."
              : "Connect your Maestro account to keep your commissions updated automatically."}
          </p>
          <MaestroConnectCard />
        </div>
      )}

      {maestroConnected === true && (
        <p className="mb-2 inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>
          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#16a34a" }} />
          {isFr ? "Données synchronisées via Maestro" : "Data synced via Maestro"}
        </p>
      )}

      <div className="mb-2">
        <MaestroReconnectButton lang={isFr ? "fr" : "en"} />
      </div>
      <MaestroSyncDiagnostics lang={isFr ? "fr" : "en"} />

      <RegisterCommissions lang={isFr ? "fr" : "en"} />
    </PAPage>
  );
}
