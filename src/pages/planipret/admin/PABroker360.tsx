import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UserSquare2, Users, FolderKanban, TrendingUp, CheckSquare, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader, PATableWrap } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import PBMaestroClients from "@/pages/planipret/broker/PBMaestroClients";
import RegisterCommissions from "@/components/planipret/commissions/RegisterCommissions";
import TasksSection from "@/components/planipret/mobile/TasksSection";

type BrokerRow = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  extension: string | null;
  maestro_broker_id: string | null;
  maestro_telecom_user_id: string | null;
};

type TabKey = "contacts" | "deals" | "commissions" | "tasks";

const brokerName = (b: BrokerRow) =>
  b.full_name || b.email || `#${b.id.slice(0, 8)}`;

const fmtMoney = (v: number | null | undefined) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v || 0);

/** Dossiers (mortgage files) mirrored locally for the selected broker. */
function DealsPanel({ broker, en }: { broker: BrokerRow; en: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void (async () => {
      const ids = [broker.id, broker.user_id].filter(Boolean) as string[];
      const { data } = await supabase
        .from("planipret_pipeline")
        .select("id, contact_name, contact_number, stage, value_estimate, notes, maestro_contact_id, updated_at")
        .in("user_id", ids)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!cancelled) setRows((data ?? []) as any[]);
    })();
    return () => { cancelled = true; };
  }, [broker.id, broker.user_id]);

  if (rows === null) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <PPSkeleton key={i} style={{ height: 32 }} />)}</div>;
  }
  if (!rows.length) {
    return (
      <PPEmptyState
        icon={<FolderKanban className="w-5 h-5" />}
        title={en ? "No file for this broker" : "Aucun dossier pour ce courtier"}
        description={en ? "Files appear once Maestro contacts are synced." : "Les dossiers apparaissent dès que les contacts Maestro sont synchronisés."}
      />
    );
  }

  return (
    <PATableWrap>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ textAlign: "left", color: "var(--pp-text-muted)" }}>
            <th style={{ padding: "10px 12px" }}>{en ? "Client" : "Client"}</th>
            <th style={{ padding: "10px 12px" }}>{en ? "Stage" : "Étape"}</th>
            <th style={{ padding: "10px 12px" }}>{en ? "Estimated value" : "Valeur estimée"}</th>
            <th style={{ padding: "10px 12px" }}>{en ? "Updated" : "Mise à jour"}</th>
            <th style={{ padding: "10px 12px" }} className="text-right">Maestro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: "var(--pp-border, #e2e8f0)" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                {r.contact_name || "—"}
                {r.contact_number ? <span style={{ color: "var(--pp-text-muted)" }}> · {r.contact_number}</span> : null}
              </td>
              <td style={{ padding: "10px 12px" }}>{r.stage || "—"}</td>
              <td style={{ padding: "10px 12px" }}>{fmtMoney(r.value_estimate)}</td>
              <td style={{ padding: "10px 12px" }}>{r.updated_at ? new Date(r.updated_at).toLocaleDateString("fr-CA") : "—"}</td>
              <td style={{ padding: "10px 12px" }} className="text-right">
                {r.maestro_contact_id ? (
                  <a
                    href={`https://client.planipret.com/main/clients?client_id=${encodeURIComponent(r.maestro_contact_id)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold"
                    style={{ color: "var(--pp-brand-accent-2)" }}
                  >
                    {en ? "Open" : "Ouvrir"} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PATableWrap>
  );
}

/**
 * Admin 360° view of a single broker: the exact portal screens (contacts,
 * files, commissions, tasks) scoped to the selected broker, read-only.
 */
export default function PABroker360() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const [params, setParams] = useSearchParams();
  const brokerParam = params.get("broker") ?? "";
  const tab = (params.get("tab") as TabKey) || "contacts";

  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("planipret_profiles")
        .select("id, user_id, full_name, email, extension, maestro_broker_id, maestro_telecom_user_id")
        .order("full_name", { ascending: true })
        .limit(500);
      if (cancelled) return;
      setBrokers((data ?? []) as BrokerRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const broker = useMemo(
    () => brokers.find((b) => b.id === brokerParam || b.user_id === brokerParam) ?? null,
    [brokers, brokerParam],
  );

  const patch = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => { if (!v) p.delete(k); else p.set(k, v); });
    setParams(p, { replace: true });
  };

  const TABS: { key: TabKey; label: string; Icon: typeof Users }[] = [
    { key: "contacts", label: en ? "Contacts" : "Contacts", Icon: Users },
    { key: "deals", label: en ? "Files" : "Dossiers", Icon: FolderKanban },
    { key: "commissions", label: en ? "Commissions" : "Commissions", Icon: TrendingUp },
    { key: "tasks", label: en ? "Tasks" : "Tâches", Icon: CheckSquare },
  ];

  return (
    <PAPage>
      <PAPageHeader
        icon={<UserSquare2 className="w-5 h-5" />}
        title={en ? "Broker 360" : "Vue courtier 360"}
        subtitle={en
          ? "Every portal screen for one broker: contacts, files, commissions and tasks"
          : "Tous les écrans du portail pour un courtier : contacts, dossiers, commissions et tâches"}
        actions={
          <select
            value={broker?.id ?? ""}
            onChange={(e) => patch({ broker: e.target.value || null })}
            className="min-h-[36px] rounded-lg px-2 text-[13px]"
            style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}
            aria-label={en ? "Select a broker" : "Choisir un courtier"}
          >
            <option value="">{loading ? (en ? "Loading…" : "Chargement…") : (en ? "Select a broker" : "Choisir un courtier")}</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{brokerName(b)}{b.extension ? ` · ${b.extension}` : ""}</option>
            ))}
          </select>
        }
      />

      {!broker ? (
        <PPEmptyState
          icon={<UserSquare2 className="w-5 h-5" />}
          title={en ? "Select a broker" : "Choisissez un courtier"}
          description={en ? "Pick a broker above to see their full portal view." : "Sélectionnez un courtier ci-dessus pour voir sa vue complète du portail."}
        />
      ) : (
        <>
          <div className="pp-card flex flex-wrap items-center gap-2" style={{ padding: 12 }}>
            <span className="text-[13px] font-semibold">{brokerName(broker)}</span>
            <span className="text-[12px]" style={{ color: "var(--pp-text-muted)" }}>
              {broker.email ?? "—"}
              {broker.maestro_broker_id ? ` · Maestro #${broker.maestro_broker_id}` : ""}
            </span>
            <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.14)", color: "#B45309" }}>
              {en ? "Read-only" : "Lecture seule"}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => patch({ tab: key })}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5"
                style={tab === key
                  ? { background: "var(--pp-brand-accent-2)", color: "#fff" }
                  : { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" }}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === "contacts" && (
            <PBMaestroClients embedded telecomUserId={broker.maestro_telecom_user_id ?? broker.maestro_broker_id ?? null} />
          )}
          {tab === "deals" && <DealsPanel broker={broker} en={en} />}
          {tab === "commissions" && (
            <RegisterCommissions lang={en ? "en" : "fr"} scope="admin" forcedAgent={brokerName(broker)} />
          )}
          {tab === "tasks" && (
            <TasksSection
              key={broker.id}
              userId={broker.user_id ?? broker.id}
              lang={en ? "en" : "fr"}
              defaultTarget={broker.maestro_broker_id ?? null}
              brokerId={broker.maestro_broker_id ?? null}
              readOnly
            />
          )}
        </>
      )}
    </PAPage>
  );
}
