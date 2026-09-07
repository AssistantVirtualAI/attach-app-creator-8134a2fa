import { useEffect, useMemo, useState } from "react";
import { Phone, MessageSquare, CheckSquare, TrendingUp, Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { usePlanipretTasks } from "@/hooks/planipret/usePlanipretTasks";

type Kind = "call" | "sms" | "task" | "commission";

export type JourneyItem = {
  id: string;
  kind: Kind;
  at: string;
  client: string;
  title: string;
  detail?: string | null;
  amount?: number | null;
};

const d10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

const fmtMoney = (v: number | null | undefined) =>
  new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v || 0);

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" });
};

const KIND_META: Record<Kind, { Icon: typeof Phone; color: string; fr: string; en: string }> = {
  call: { Icon: Phone, color: "#2563EB", fr: "Appel", en: "Call" },
  sms: { Icon: MessageSquare, color: "#7C3AED", fr: "Texto", en: "Text" },
  task: { Icon: CheckSquare, color: "#0891B2", fr: "Tâche", en: "Task" },
  commission: { Icon: TrendingUp, color: "#16A34A", fr: "Commission", en: "Commission" },
};

/**
 * Chronological journey for one broker: calls, texts, tasks, commissions and
 * AI findings merged on a single date axis, grouped per client.
 */
export default function BrokerJourney({
  brokerIds,
  brokerName,
  maestroBrokerId,
  userId,
  en,
}: {
  brokerIds: string[];
  brokerName: string;
  maestroBrokerId: string | null;
  userId: string | null;
  en: boolean;
}) {
  const [rows, setRows] = useState<JourneyItem[] | null>(null);
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ call: true, sms: true, task: true, commission: true });
  const [q, setQ] = useState("");
  const { tasks } = usePlanipretTasks(userId, { brokerId: maestroBrokerId ?? undefined });

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const ids = brokerIds.filter(Boolean);
    void (async () => {
      const [calls, msgs, comms] = await Promise.all([
        ids.length
          ? supabase
              .from("planipret_phone_calls")
              .select("id, direction, from_number, to_number, duration_seconds, ai_summary, ai_coaching, transcript, maestro_client_name, started_at, created_at")
              .in("user_id", ids)
              .order("created_at", { ascending: false })
              .limit(400)
          : Promise.resolve({ data: [] as any[] }),
        ids.length
          ? supabase
              .from("planipret_phone_messages")
              .select("id, direction, from_number, to_number, body, created_at")
              .in("user_id", ids)
              .order("created_at", { ascending: false })
              .limit(400)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("planipret_commission_register")
          .select("id, primary_client_name, secondary_client_name, amount, institution, mortgage_type, loan_amt, date_trans, agent_name, broker_user_id, maestro_broker_id")
          .or(
            [
              ids.length ? `broker_user_id.in.(${ids.join(",")})` : null,
              maestroBrokerId ? `maestro_broker_id.eq.${maestroBrokerId}` : null,
              brokerName ? `agent_name.ilike.%${brokerName}%` : null,
            ].filter(Boolean).join(","),
          )
          .order("date_trans", { ascending: false })
          .limit(400),
      ]);
      if (cancelled) return;

      const out: JourneyItem[] = [];

      for (const c of (calls.data ?? []) as any[]) {
        const peer = c.direction === "inbound" ? c.from_number : c.to_number;
        const mins = Math.round((c.duration_seconds || 0) / 60);
        out.push({
          id: `call-${c.id}`,
          kind: "call",
          at: c.started_at || c.created_at,
          client: c.maestro_client_name || d10(peer) || "—",
          title: `${c.direction === "inbound" ? (en ? "Inbound call" : "Appel entrant") : (en ? "Outbound call" : "Appel sortant")} · ${mins ? `${mins} min` : `${c.duration_seconds || 0} s`}`,
          detail: c.ai_summary || c.ai_coaching || (c.transcript ? String(c.transcript).slice(0, 240) : null),
        });
      }

      for (const m of (msgs.data ?? []) as any[]) {
        const peer = m.direction === "inbound" ? m.from_number : m.to_number;
        out.push({
          id: `sms-${m.id}`,
          kind: "sms",
          at: m.created_at,
          client: d10(peer) || "—",
          title: m.direction === "inbound" ? (en ? "Text received" : "Texto reçu") : (en ? "Text sent" : "Texto envoyé"),
          detail: m.body ? String(m.body).slice(0, 240) : null,
        });
      }

      for (const r of (comms.data ?? []) as any[]) {
        out.push({
          id: `comm-${r.id}`,
          kind: "commission",
          at: r.date_trans || r.created_at,
          client: [r.primary_client_name, r.secondary_client_name].filter(Boolean).join(" & ") || "—",
          title: `${en ? "Commission" : "Commission"} · ${r.institution || "—"}${r.mortgage_type ? ` · ${r.mortgage_type}` : ""}`,
          detail: r.loan_amt ? `${en ? "Loan" : "Prêt"} ${fmtMoney(Number(r.loan_amt))}` : null,
          amount: r.amount != null ? Number(r.amount) : null,
        });
      }

      setRows(out);
    })();
    return () => { cancelled = true; };
  }, [brokerIds.join(","), brokerName, maestroBrokerId, en]);

  const taskItems = useMemo<JourneyItem[]>(
    () =>
      (tasks ?? []).map((t: any) => ({
        id: `task-${t.id}`,
        kind: "task" as const,
        at: t.due_at || t.updated_at || t.created_at || new Date().toISOString(),
        client: t.client_name || t.contact_name || "—",
        title: `${en ? "Task" : "Tâche"} · ${t.title || t.subject || "—"}${t.completed_at ? (en ? " (done)" : " (complétée)") : ""}`,
        detail: t.description || t.notes || null,
      })),
    [tasks, en],
  );

  const merged = useMemo(() => {
    const all = [...(rows ?? []), ...taskItems].filter((i) => kinds[i.kind]);
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter((i) => `${i.client} ${i.title} ${i.detail ?? ""}`.toLowerCase().includes(needle))
      : all;
    return filtered.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [rows, taskItems, kinds, q]);

  const byDay = useMemo(() => {
    const map = new Map<string, JourneyItem[]>();
    for (const i of merged) {
      const key = new Date(i.at).toLocaleDateString("fr-CA");
      const arr = map.get(key) ?? [];
      arr.push(i);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [merged]);

  if (rows === null) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <PPSkeleton key={i} style={{ height: 44 }} />)}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="pp-card flex flex-wrap items-center gap-2" style={{ padding: 10 }}>
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const { Icon, color, fr, en: enL } = KIND_META[k];
          const on = kinds[k];
          const count = [...(rows ?? []), ...taskItems].filter((i) => i.kind === k).length;
          return (
            <button
              key={k}
              onClick={() => setKinds((s) => ({ ...s, [k]: !s[k] }))}
              className="px-2.5 py-1 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5"
              style={on
                ? { background: color, color: "#fff" }
                : { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-muted)" }}
            >
              <Icon className="w-3.5 h-3.5" /> {en ? enL : fr} <span style={{ opacity: 0.8 }}>{count}</span>
            </button>
          );
        })}
        <label className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 min-h-[32px]"
          style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={en ? "Search a client…" : "Chercher un client…"}
            className="bg-transparent text-[12.5px] outline-none"
            style={{ color: "var(--pp-text-primary)", minWidth: 180 }}
          />
        </label>
      </div>

      {!byDay.length ? (
        <PPEmptyState
          icon={<Sparkles className="w-5 h-5" />}
          title={en ? "No activity" : "Aucune activité"}
          description={en ? "No call, text, task or commission for this broker yet." : "Aucun appel, texto, tâche ou commission pour ce courtier."}
        />
      ) : (
        byDay.map(([day, items]) => (
          <div key={day} className="space-y-1.5">
            <div className="text-[12px] font-semibold px-1" style={{ color: "var(--pp-text-muted)" }}>{day}</div>
            {items.map((i) => {
              const { Icon, color } = KIND_META[i.kind];
              return (
                <div key={i.id} className="pp-card flex items-start gap-2.5" style={{ padding: 10 }}>
                  <span className="mt-0.5 rounded-lg p-1.5 shrink-0" style={{ background: `${color}1A`, color }}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-semibold">{i.client}</span>
                      <span className="text-[11.5px]" style={{ color: "var(--pp-text-muted)" }}>{fmtDate(i.at)}</span>
                      {i.amount != null ? (
                        <span className="ml-auto text-[12.5px] font-semibold" style={{ color: "#16A34A" }}>{fmtMoney(i.amount)}</span>
                      ) : null}
                    </div>
                    <div className="text-[12.5px]">{i.title}</div>
                    {i.detail ? (
                      <div className="text-[12px] mt-0.5" style={{ color: "var(--pp-text-muted)" }}>{i.detail}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
