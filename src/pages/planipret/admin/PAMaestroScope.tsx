import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, RefreshCw, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { supabase } from "@/integrations/supabase/client";

type ScopeState = {
  configured: boolean;
  source: "static" | "client_credentials" | "none";
  reason: string | null;
  env: Record<string, boolean | string>;
  probe: null | { ok: boolean; status: number; rows: number; total: number | null; message: string | null; distinct_agents: string[] };
  brokers: { total: number; connected: number };
};

const Row = ({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) => (
  <div className="flex items-center gap-2 py-1" style={{ fontSize: 12.5 }}>
    {ok ? <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} /> : <XCircle className="w-4 h-4" style={{ color: "#ef4444" }} />}
    <code style={{ color: "var(--pp-text-primary)", fontWeight: 700 }}>{label}</code>
    {hint && <span style={{ color: "var(--pp-text-muted)" }}>{hint}</span>}
  </div>
);

export default function PAMaestroScope() {
  const { lang } = useMplanipretLang();
  const isFr = lang !== "en";
  const [state, setState] = useState<ScopeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async (probe: boolean) => {
    probe ? setProbing(true) : setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("pp-maestro-admin-scope", {
        body: { probe },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (error) throw error;
      setState(data as ScopeState);
    } catch (e: any) {
      toast.error(isFr ? "Vérification impossible" : "Check failed", { description: e?.message });
    } finally {
      setLoading(false); setProbing(false);
    }
  }, [isFr]);

  useEffect(() => { void load(false); }, [load]);

  const card: React.CSSProperties = {
    background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)",
    borderRadius: 14, padding: 14, marginBottom: 12,
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<ShieldCheck className="w-5 h-5" />}
        title={isFr ? "Portée Maestro (firme)" : "Maestro firm scope"}
        subtitle={isFr
          ? "Vérifiez et configurez le jeton à portée firme qui permet de lire les commissions de tous les courtiers"
          : "Verify and configure the firm-wide credential used to read every broker's commissions"}
      />

      <div style={card}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)" }}>
            {isFr ? "État actuel" : "Current state"}
          </span>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : state?.configured ? (
            <span className="px-2 py-0.5 rounded-full" style={{ fontSize: 11.5, fontWeight: 800, background: "rgba(22,163,74,.15)", color: "#16a34a" }}>
              {isFr ? `Configurée (${state.source})` : `Configured (${state.source})`}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full" style={{ fontSize: 11.5, fontWeight: 800, background: "rgba(245,158,11,.15)", color: "#f59e0b" }}>
              {isFr ? "Non configurée" : "Not configured"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => load(false)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ fontSize: 12, fontWeight: 700, background: "var(--pp-bg-card)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
              <RefreshCw className="w-3.5 h-3.5" />{isFr ? "Actualiser" : "Refresh"}
            </button>
            <button onClick={() => load(true)} disabled={probing || !state?.configured}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
              style={{ fontSize: 12, fontWeight: 700, background: "var(--pp-brand-accent-2)", color: "#fff", border: "1px solid var(--pp-bg-border)", opacity: probing || !state?.configured ? .6 : 1 }}>
              {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
              {isFr ? "Tester l'accès" : "Test access"}
            </button>
          </div>
        </div>

        {state && (
          <>
            <Row label="MAESTRO_ADMIN_ACCESS_TOKEN" ok={state.env.MAESTRO_ADMIN_ACCESS_TOKEN === true}
              hint={isFr ? "jeton statique à portée firme" : "static firm-wide bearer token"} />
            <Row label="MAESTRO_ADMIN_CLIENT_ID" ok={state.env.MAESTRO_ADMIN_CLIENT_ID === true} />
            <Row label="MAESTRO_ADMIN_CLIENT_SECRET" ok={state.env.MAESTRO_ADMIN_CLIENT_SECRET === true}
              hint={isFr ? "flux client_credentials" : "client_credentials flow"} />
            <div style={{ fontSize: 12, color: "var(--pp-text-muted)", marginTop: 4 }}>
              {isFr ? "Portée demandée" : "Requested scope"} : <code>{String(state.env.MAESTRO_ADMIN_SCOPE)}</code>
            </div>
            {state.reason && (
              <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6 }}>{state.reason}</div>
            )}
            <div style={{ fontSize: 12, color: "var(--pp-text-secondary)", marginTop: 8 }}>
              {isFr
                ? `${state.brokers.connected} courtier(s) connecté(s) individuellement sur ${state.brokers.total}.`
                : `${state.brokers.connected} of ${state.brokers.total} brokers connected individually.`}
            </div>
          </>
        )}
      </div>

      {state?.probe && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 6 }}>
            {isFr ? "Résultat du test" : "Test result"}
          </div>
          <div style={{ fontSize: 12.5, color: state.probe.ok ? "#16a34a" : "#ef4444", fontWeight: 700 }}>
            HTTP {state.probe.status} · {state.probe.ok ? (isFr ? "accès accordé" : "access granted") : (state.probe.message ?? "error")}
          </div>
          {state.probe.ok && (
            <div style={{ fontSize: 12, color: "var(--pp-text-secondary)", marginTop: 4 }}>
              {isFr
                ? `${state.probe.rows} ligne(s) d'échantillon · total déclaré ${state.probe.total ?? "?"} · courtiers vus : ${state.probe.distinct_agents.join(", ") || "—"}`
                : `${state.probe.rows} sample row(s) · reported total ${state.probe.total ?? "?"} · agents seen: ${state.probe.distinct_agents.join(", ") || "—"}`}
            </div>
          )}
        </div>
      )}

      {!loading && !state?.configured && (
        <div style={{ ...card, borderColor: "rgba(245,158,11,.45)", background: "rgba(245,158,11,.08)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pp-text-primary)", marginBottom: 6 }}>
            {isFr ? "Comment l'activer" : "How to enable it"}
          </div>
          <ol style={{ fontSize: 12.5, color: "var(--pp-text-secondary)", paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{isFr
              ? "Demandez à Planiprêt (Maestro) un accès API à portée firme pour les rapports de commissions — un jeton statique, ou un couple client_id / client_secret en grant client_credentials."
              : "Ask Planiprêt (Maestro) for a firm-scoped API access to the commission reports — a static token, or a client_id / client_secret pair with the client_credentials grant."}</li>
            <li>{isFr
              ? "Transmettez-le-moi dans le chat : je l'enregistre comme secret backend (MAESTRO_ADMIN_ACCESS_TOKEN, ou MAESTRO_ADMIN_CLIENT_ID + MAESTRO_ADMIN_CLIENT_SECRET)."
              : "Send it to me in chat: I store it as a backend secret (MAESTRO_ADMIN_ACCESS_TOKEN, or MAESTRO_ADMIN_CLIENT_ID + MAESTRO_ADMIN_CLIENT_SECRET)."}</li>
            <li>{isFr
              ? "Revenez ici et lancez « Tester l'accès » : si l'API renvoie les dépôts de plusieurs courtiers, la portée est bonne."
              : "Come back here and run \"Test access\": if the API returns deposits for several agents, the scope is right."}</li>
            <li>{isFr
              ? "Lancez ensuite « Synchroniser maintenant » sur la page Commissions : les 200+ courtiers remontent sans connexion individuelle."
              : "Then run \"Sync now\" on the Commissions page: all 200+ brokers appear without individual connections."}</li>
          </ol>
          <div style={{ fontSize: 12, color: "var(--pp-text-muted)", marginTop: 8 }}>
            {isFr
              ? "En attendant, seuls les courtiers ayant autorisé Maestro individuellement, plus le registre global importé, alimentent la page Commissions."
              : "Meanwhile only brokers who authorized Maestro individually, plus the imported global register, feed the Commissions page."}
          </div>
        </div>
      )}
    </PAPage>
  );
}
