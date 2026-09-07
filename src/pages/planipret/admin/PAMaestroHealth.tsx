import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { toast } from "sonner";

interface Row {
  userId: string;
  name: string;
  email: string;
  brokerId: string | null;
  connected: boolean;
  lastSync: string | null;
  calls: number;
  callsLinked: number;
  msgs: number;
  msgsSynced: number;
  recSynced: number;
  recPending: number;
  aiPushed: number;
}

interface TestStep { key: string; label: string; ok: boolean; status?: number; detail?: string }
interface TestResult { success: boolean; steps: TestStep[]; totals?: any; broker?: any }

const surface = { background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-primary)" };
const muted = { color: "var(--pp-text-muted)" };

/** Santé Maestro : ce qui est réellement enregistré dans Maestro, par courtier. */
export default function PAMaestroHealth() {
  const { lang } = useMplanipretLang();
  const en = lang === "en";
  const L = (fr: string, e: string) => (en ? e : fr);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ userId: string; data: TestResult } | null>(null);
  const [replaying, setReplaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const [profiles, calls, msgs, recs, pushes] = await Promise.all([
      supabase.from("planipret_profiles")
        .select("user_id, full_name, email, maestro_broker_id, maestro_connected, maestro_last_sync_at")
        .limit(1000),
      supabase.from("planipret_phone_calls").select("user_id, maestro_call_id").gte("created_at", since).limit(10000),
      supabase.from("planipret_phone_messages").select("user_id, maestro_synced").gte("created_at", since).limit(10000),
      supabase.from("planipret_recording_uploads").select("user_id, status").gte("created_at", since).limit(10000),
      supabase.from("planipret_pipeline_logs").select("user_id, step, status").gte("created_at", since)
        .in("step", ["ai_summary_push", "recording_push"]).limit(10000),
    ]);

    const map = new Map<string, Row>();
    for (const p of (profiles.data ?? []) as any[]) {
      const uid = String(p.user_id ?? "");
      if (!uid) continue;
      map.set(uid, {
        userId: uid,
        name: p.full_name || p.email || uid.slice(0, 8),
        email: p.email ?? "",
        brokerId: p.maestro_broker_id ? String(p.maestro_broker_id) : null,
        connected: Boolean(p.maestro_connected),
        lastSync: p.maestro_last_sync_at ?? null,
        calls: 0, callsLinked: 0, msgs: 0, msgsSynced: 0, recSynced: 0, recPending: 0, aiPushed: 0,
      });
    }
    const bump = (uid: any, fn: (r: Row) => void) => {
      const r = map.get(String(uid ?? ""));
      if (r) fn(r);
    };
    for (const c of (calls.data ?? []) as any[]) bump(c.user_id, (r) => { r.calls++; if (c.maestro_call_id) r.callsLinked++; });
    for (const m of (msgs.data ?? []) as any[]) bump(m.user_id, (r) => { r.msgs++; if (m.maestro_synced) r.msgsSynced++; });
    for (const x of (recs.data ?? []) as any[]) bump(x.user_id, (r) => {
      if (x.status === "synced") r.recSynced++;
      else if (x.status === "pending") r.recPending++;
    });
    for (const p of (pushes.data ?? []) as any[]) bump(p.user_id, (r) => { if (p.status === "success" && p.step === "ai_summary_push") r.aiPushed++; });

    const out = [...map.values()].filter((r) => r.calls || r.msgs || r.connected);
    out.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
    setRows(out);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  const totals = useMemo(() => ({
    connected: rows.filter((r) => r.connected).length,
    calls: rows.reduce((s, r) => s + r.calls, 0),
    callsLinked: rows.reduce((s, r) => s + r.callsLinked, 0),
    msgs: rows.reduce((s, r) => s + r.msgs, 0),
    msgsSynced: rows.reduce((s, r) => s + r.msgsSynced, 0),
    recPending: rows.reduce((s, r) => s + r.recPending, 0),
  }), [rows]);

  const runTest = async (userId: string) => {
    setTesting(userId);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("pp-maestro-e2e-test", { body: { user_id: userId, write_test: true } });
    setTesting(null);
    if (error) { toast.error(L("Test impossible", "Test failed")); return; }
    setResult({ userId, data: data as TestResult });
    toast[(data as TestResult)?.success ? "success" : "warning"](
      (data as TestResult)?.success ? L("Tout passe vers Maestro", "Everything reaches Maestro") : L("Points à corriger détectés", "Issues detected"),
    );
  };

  const replayAll = async () => {
    setReplaying(true);
    const [sweeper, cdr] = await Promise.all([
      supabase.functions.invoke("pp-maestro-push-sweeper", { body: { limit: 100 } }),
      supabase.functions.invoke("maestro-cdr-retry-job", { body: { limit: 50, sweep: true } }),
    ]);
    setReplaying(false);
    if (sweeper.error && cdr.error) toast.error(L("Relance impossible", "Replay failed"));
    else { toast.success(L("Relance lancée", "Replay started")); setTick((t) => t + 1); }
  };

  return (
    <PAPage>
      <PAPageHeader
        icon={<Activity className="w-5 h-5" />}
        title={L("Santé Maestro", "Maestro health")}
        subtitle={L(
          "Ce qui est réellement enregistré dans Maestro par courtier : appels, textos, enregistrements et résumés IA (14 jours).",
          "What actually reaches Maestro per broker: calls, texts, recordings and AI summaries (14 days).",
        )}
        actions={
          <div className="flex gap-2">
            <button onClick={replayAll} disabled={replaying} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
              <PlayCircle className={`w-3.5 h-3.5 ${replaying ? "animate-pulse" : ""}`} /> {L("Relancer les envois", "Replay pushes")}
            </button>
            <button onClick={() => setTick((t) => t + 1)} className="min-h-[36px] px-3 rounded-lg text-xs inline-flex items-center gap-1.5" style={surface}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {L("Actualiser", "Refresh")}
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <PPSkeleton key={i} style={{ height: 56 }} />)}</div>
      ) : rows.length === 0 ? (
        <PPEmptyState icon={<Activity className="w-5 h-5" />} title={L("Aucune activité", "No activity")} />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={L("Courtiers autorisés", "Authorized brokers")} value={`${totals.connected}/${rows.length}`} />
            <Kpi label={L("Appels dans Maestro", "Calls in Maestro")} value={`${totals.callsLinked}/${totals.calls}`} />
            <Kpi label={L("Textos dans Maestro", "Texts in Maestro")} value={`${totals.msgsSynced}/${totals.msgs}`} />
            <Kpi label={L("Enregistrements en attente", "Recordings pending")} value={String(totals.recPending)} />
          </div>

          <div className="rounded-xl overflow-x-auto" style={surface}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                  <Th>{L("Courtier", "Broker")}</Th>
                  <Th>{L("ID Maestro", "Maestro ID")}</Th>
                  <Th>{L("Appels envoyés", "Calls sent")}</Th>
                  <Th>{L("Textos envoyés", "Texts sent")}</Th>
                  <Th>{L("Enregistrements", "Recordings")}</Th>
                  <Th>{L("Résumés IA", "AI summaries")}</Th>
                  <Th>{L("Test", "Test")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} style={{ borderBottom: "1px solid var(--pp-bg-border)" }}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p style={muted}>{r.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      {r.brokerId ? r.brokerId : <span style={{ color: "#B91C1C" }}>{L("non autorisé", "not authorized")}</span>}
                    </td>
                    <td className="px-3 py-2 font-semibold">{r.callsLinked}/{r.calls}</td>
                    <td className="px-3 py-2 font-semibold">{r.msgsSynced}/{r.msgs}</td>
                    <td className="px-3 py-2">
                      {r.recSynced}
                      {r.recPending ? <span style={{ color: "#B45309" }}> (+{r.recPending} {L("en attente", "pending")})</span> : null}
                    </td>
                    <td className="px-3 py-2">{r.aiPushed}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => void runTest(r.userId)}
                        disabled={testing === r.userId}
                        className="min-h-[30px] px-2.5 rounded-lg text-[11px] inline-flex items-center gap-1"
                        style={surface}
                      >
                        {testing === r.userId ? <RefreshCw className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
                        {L("Tester", "Test")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result && (
            <div className="rounded-xl p-4 space-y-2" style={surface}>
              <p className="text-sm font-semibold">
                {L("Résultat du test", "Test result")} — {rows.find((r) => r.userId === result.userId)?.name}
              </p>
              {result.data?.steps?.map((s) => (
                <div key={s.key} className="flex items-start gap-2 text-xs">
                  {s.ok
                    ? <CheckCircle2 className="w-4 h-4 mt-0.5" style={{ color: "#10B981" }} />
                    : <XCircle className="w-4 h-4 mt-0.5" style={{ color: "#B91C1C" }} />}
                  <div>
                    <p className="font-medium">{s.label}</p>
                    {s.detail && <p style={muted}>{s.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PAPage>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={surface}>
      <p className="text-[11px] uppercase tracking-wide" style={muted}>{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide" style={muted}>{children}</th>
  );
}
