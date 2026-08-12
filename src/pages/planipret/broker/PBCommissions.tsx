import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { TrendingUp, Cloud, Database, Loader2, ShieldCheck, Archive } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import CommissionDashboard from "@/components/planipret/commissions/CommissionDashboard";
import CommissionProvenance from "@/components/planipret/commissions/CommissionProvenance";
import RegisterCommissions from "@/components/planipret/commissions/RegisterCommissions";
import MaestroConnectCard from "@/components/planipret/mobile/MaestroConnectCard";
import { supabase } from "@/integrations/supabase/client";
import type { BrokerCtx } from "./PlanipretBrokerLayout";

type Source = "maestro" | "internal" | "provenance" | "register";


export default function PBCommissions() {
  const { authUserId, profile } = useOutletContext<BrokerCtx>();
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const [source, setSource] = useState<Source>("register");

  const [maestroConnected, setMaestroConnected] = useState<boolean | null>(null);
  const [info, setInfo] = useState<{ ok: boolean; code?: string; error?: string; dealCount?: number } | null>(null);

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

  const notConnected = maestroConnected === false || info?.code === "maestro_not_connected";

  const tab = (value: Source, Icon: typeof Cloud, label: string) => (
    <button
      key={value}
      onClick={() => setSource(value)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        background: source === value ? "var(--pp-brand-accent-2)" : "var(--pp-bg-elevated)",
        color: source === value ? "#fff" : "var(--pp-text-secondary)",
        border: "1px solid var(--pp-bg-border)",
      }}
    >
      <Icon className="w-3.5 h-3.5" />{label}
    </button>
  );

  return (
    <PAPage>
      <PAPageHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title={isFr ? "Mes commissions" : "My commissions"}
        subtitle={isFr
          ? "Votre performance et la répartition de vos commissions"
          : "Your personal performance and commission breakdown"}
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tab("register", Archive, isFr ? "Registre 2022+" : "Register 2022+")}
        {tab("maestro", Cloud, "Maestro")}
        {tab("internal", Database, isFr ? "Données internes" : "Internal data")}
        {tab("provenance", ShieldCheck, isFr ? "Provenance" : "Provenance")}
        {source === "maestro" && maestroConnected === null && (
          <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {isFr ? "Vérification de Maestro…" : "Checking Maestro…"}
          </span>
        )}
        {source === "maestro" && info?.ok && (
          <span style={{ fontSize: 12, color: "var(--pp-text-muted)" }}>
            {isFr ? `${info.dealCount ?? 0} dossiers synchronisés depuis Maestro` : `${info.dealCount ?? 0} deals synced from Maestro`}
          </span>
        )}
      </div>

      {source === "register" ? (
        <RegisterCommissions lang={isFr ? "fr" : "en"} />
      ) : (source === "maestro" || source === "provenance") && notConnected ? (
        <div className="max-w-xl">
          <p className="mb-3" style={{ fontSize: 13, color: "var(--pp-text-muted)" }}>
            {isFr
              ? "Connectez votre compte Maestro pour afficher vos commissions en temps réel."
              : "Connect your Maestro account to display your commissions in real time."}
          </p>
          <MaestroConnectCard />
        </div>
      ) : source === "provenance" ? (
        <CommissionProvenance lang={isFr ? "fr" : "en"} />
      ) : (
        <>
          {source === "maestro" && info && !info.ok && info.error && (
            <div className="pp-card mb-3" style={{ padding: 12, fontSize: 12.5, color: "var(--pp-danger)" }}>
              {info.error}
            </div>
          )}
          <CommissionDashboard
            lang={isFr ? "fr" : "en"}
            scope="broker"
            source={source === "internal" ? "internal" : "maestro"}
            brokerUserId={authUserId}
            brokerName={(profile as any)?.full_name}
            onSourceResult={setInfo}
          />
        </>
      )}


    </PAPage>
  );
}
