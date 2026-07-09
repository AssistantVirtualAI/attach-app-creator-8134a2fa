import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Sparkles, TrendingUp, ThumbsUp, ThumbsDown, Bot, Mail, Zap, CheckCircle2, XCircle, Inbox, Send, Calendar, AlertCircle, Video, ExternalLink } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";

const ACCENT = "#2E9BDC";
const SUCCESS = "#00D4AA";
const DANGER = "#E84C4C";
const WARNING = "#F5A623";
const AGENT = "#9B7FE8";

type Row = {
  user_id: string;
  broker_name?: string;
  broker_email?: string | null;
  analyses_30d: number;
  urgent_30d: number;
  leads_30d: number;
  actions_ok_30d: number;
  actions_err_30d: number;
  actions_modified_30d: number;
  ms365_connected?: boolean;
  emails_received?: number;
  emails_sent?: number;
  meetings?: number;
};

type MicrosoftAnalytics = {
  connected_brokers: number;
  scanned_brokers: number;
  graph_mode?: "delegated" | "application" | "none";
  truncated?: boolean;
  totals: { emails_received: number; emails_sent: number; emails_unread: number; meetings: number; meeting_minutes: number };
  topSenders: Array<{ name: string; count: number }>;
  upcomingMeetings: Array<{ broker?: string; subject: string; start: string; attendees: number; is_online: boolean; join_url: string | null }>;
  brokerSummaries: Array<{ broker_user_id: string; broker_name: string; email: string | null; emails_received: number; emails_sent: number; meetings: number }>;
  graphErrors: Array<{ broker: string | null; error: string }>;
};

const TooltipDark = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--pp-bg-deep)", border: "1px solid var(--pp-bg-border-2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--pp-text-primary)" }}>
      {label && <div style={{ color: "var(--pp-text-muted)", marginBottom: 4 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || p.fill }} />
          <span>{p.name}: <strong>{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
};

function KpiTile({ icon, label, value, color, sub }: { icon: any; label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="pp-card relative overflow-hidden" style={{ padding: 16 }}>
      <div aria-hidden className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}>
          {icon}
        </div>
      </div>
      <div className="tabular-nums" style={{ fontSize: 26, fontWeight: 700, marginTop: 8, color: "var(--pp-text-primary)" }}>{value}</div>
      <p style={{ fontSize: 11, color: "var(--pp-text-secondary)", marginTop: 4 }}>{label}</p>
      {sub && <p style={{ fontSize: 10, color: "var(--pp-text-faint)", marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

export default function PAAva() {
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fbStats, setFbStats] = useState({ up: 0, down: 0, modified: 0, skipped: 0 });
  const [tuning, setTuning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dailySeries, setDailySeries] = useState<Array<{ day: string; analyses: number; leads: number; urgent: number; ms_emails_received?: number; ms_emails_sent?: number; ms_meetings?: number }>>([]);
  const [toolMix, setToolMix] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [recentActions, setRecentActions] = useState<any[]>([]);
  const [microsoft, setMicrosoft] = useState<MicrosoftAnalytics | null>(null);
  const [insights, setInsights] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setApiError(null);
    const { data, error } = await supabase.functions.invoke("planipret-admin-ava-analytics", {
      body: { days: 30, includeGraph: true, insights: true },
    });
    if (error || !(data as any)?.ok) {
      setApiError(error?.message ?? (data as any)?.error ?? "Analytics indisponible");
      setRows([]);
      setDailySeries([]);
      setToolMix([]);
      setRecentActions([]);
      setMicrosoft(null);
      setInsights([]);
      setLoading(false);
      return;
    }
    const payload = data as any;
    const list = (payload.rows ?? []) as Row[];
    const names: Record<string, string> = {};
    list.forEach((row) => { names[row.user_id] = row.broker_name || row.user_id.slice(0, 8); });
    setRows(list);
    setProfiles(names);
    setFbStats(payload.feedback ?? { up: 0, down: 0, modified: 0, skipped: 0 });
    setDailySeries(payload.dailySeries ?? []);
    setToolMix(payload.toolMix ?? []);
    setRecentActions(payload.recentActions ?? []);
    setMicrosoft(payload.microsoft ?? null);
    setInsights(payload.insights ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("admin-ava")
      .on("postgres_changes", { event: "*", schema: "public", table: "planipret_ava_feedback" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "planipret_ava_email_analyses" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "planipret_ava_action_log" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const retune = async () => {
    setTuning(true);
    const { data, error } = await supabase.functions.invoke("ava-prompt-tuner", { body: {} });
    setTuning(false);
    if (error || !(data as any)?.success) { toast.error("Échec du réentraînement"); return; }
    toast.success(`AVA réentraînée sur ${(data as any).count} courtier(s)`);
    load();
  };
  const analyzeAll = async () => {
    setAnalyzing(true);
    const tid = toast.loading("Analyse des emails des courtiers…");
    try {
      const { data, error } = await supabase.functions.invoke("ava-analyze-all", { body: { top: 20 } });
      if (error) throw error;
      const d = data as any;
      if (!d?.ok) throw new Error(d?.error ?? "Échec");
      toast.success(`${d.total_analyses} email(s) analysé(s) sur ${d.analyzed_brokers} courtier(s)`, { id: tid });
      await load();
    } catch (e: any) {
      toast.error(`Analyse échouée: ${e.message ?? e}`, { id: tid });
    } finally {
      setAnalyzing(false);
    }
  };

  const totals = rows.reduce((acc, r) => ({
    analyses: acc.analyses + (r.analyses_30d ?? 0),
    urgent: acc.urgent + (r.urgent_30d ?? 0),
    leads: acc.leads + (r.leads_30d ?? 0),
    ok: acc.ok + (r.actions_ok_30d ?? 0),
    err: acc.err + (r.actions_err_30d ?? 0),
    modified: acc.modified + (r.actions_modified_30d ?? 0),
  }), { analyses: 0, urgent: 0, leads: 0, ok: 0, err: 0, modified: 0 });

  const approvalRate = totals.ok + totals.err > 0 ? Math.round((totals.ok / (totals.ok + totals.err)) * 100) : 0;
  const fbTotal = fbStats.up + fbStats.down + fbStats.modified + fbStats.skipped;
  const satisfaction = fbTotal > 0 ? Math.round(((fbStats.up) / fbTotal) * 100) : 0;

  const feedbackDonut = useMemo(() => [
    { name: "👍 Positif", value: fbStats.up, color: SUCCESS },
    { name: "👎 Négatif", value: fbStats.down, color: DANGER },
    { name: "✏️ Modifié", value: fbStats.modified, color: WARNING },
    { name: "↷ Ignoré", value: fbStats.skipped, color: "#6B7280" },
  ].filter((s) => s.value > 0), [fbStats]);

  const brokerLeaderboard = useMemo(() => {
    return [...rows]
      .sort((a, b) => ((b.analyses_30d ?? 0) + (b.emails_received ?? 0) + (b.meetings ?? 0)) - ((a.analyses_30d ?? 0) + (a.emails_received ?? 0) + (a.meetings ?? 0)))
      .slice(0, 10)
      .map((r) => ({
        name: r.broker_name || profiles[r.user_id] || r.user_id.slice(0, 8),
        analyses: r.analyses_30d ?? 0,
        leads: r.leads_30d ?? 0,
        ok: r.actions_ok_30d ?? 0,
        err: r.actions_err_30d ?? 0,
        emails: r.emails_received ?? 0,
        meetings: r.meetings ?? 0,
      }));
  }, [rows, profiles]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ fontFamily: "Inter,sans-serif", fontWeight: 700, fontSize: 22, color: "var(--pp-text-primary)" }}>AVA · Analytics 30 jours</h1>
          <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }} className="mt-0.5">
            Analyses d'emails, actions, feedback et apprentissage — sync automatique en temps réel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={analyzeAll} disabled={analyzing} variant="default" size="sm">
            {analyzing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            Analyser les emails maintenant
          </Button>
          <Button onClick={retune} disabled={tuning} variant="outline" size="sm">
            {tuning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            Réentraîner AVA
          </Button>
        </div>
      </div>

      {apiError && (
        <div className="pp-card flex items-start gap-3" style={{ padding: 14, borderColor: `${DANGER}55` }}>
          <AlertCircle className="w-5 h-5 shrink-0" style={{ color: DANGER }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pp-text-primary)" }}>Analytics non chargés</div>
            <div style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>{apiError}</div>
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiTile icon={<Mail className="w-4 h-4" />} label="Analyses" value={totals.analyses} color={ACCENT} />
        <KpiTile icon={<TrendingUp className="w-4 h-4" />} label="Leads détectés" value={totals.leads} color={SUCCESS} />
        <KpiTile icon={<Zap className="w-4 h-4" />} label="Urgent" value={totals.urgent} color={WARNING} />
        <KpiTile icon={<CheckCircle2 className="w-4 h-4" />} label="Actions exécutées" value={totals.ok} color={SUCCESS} sub={`${approvalRate}% succès`} />
        <KpiTile icon={<XCircle className="w-4 h-4" />} label="Erreurs" value={totals.err} color={DANGER} />
        <KpiTile icon={<Bot className="w-4 h-4" />} label="Courtiers actifs" value={rows.length} color={AGENT} />
        <KpiTile icon={<ThumbsUp className="w-4 h-4" />} label="Feedback 👍" value={fbStats.up} color={SUCCESS} />
        <KpiTile icon={<ThumbsDown className="w-4 h-4" />} label="Feedback 👎" value={fbStats.down} color={DANGER} />
        <KpiTile icon={<Sparkles className="w-4 h-4" />} label="Satisfaction" value={`${satisfaction}%`} color={AGENT} sub={`${fbTotal} avis`} />
        <KpiTile icon={<Sparkles className="w-4 h-4" />} label="Modifiées" value={totals.modified} color={WARNING} />
        <KpiTile icon={<Inbox className="w-4 h-4" />} label="Emails reçus M365" value={microsoft?.totals.emails_received ?? 0} color={ACCENT} sub={`${microsoft?.totals.emails_unread ?? 0} non lus`} />
        <KpiTile icon={<Send className="w-4 h-4" />} label="Emails envoyés M365" value={microsoft?.totals.emails_sent ?? 0} color={SUCCESS} />
        <KpiTile icon={<Calendar className="w-4 h-4" />} label="Réunions M365" value={microsoft?.totals.meetings ?? 0} color={AGENT} sub={`${Math.round((microsoft?.totals.meeting_minutes ?? 0) / 60)}h total`} />
        <KpiTile icon={<CheckCircle2 className="w-4 h-4" />} label="Courtiers M365 scannés" value={`${microsoft?.scanned_brokers ?? microsoft?.connected_brokers ?? 0}/${rows.length}`} color={(microsoft?.scanned_brokers ?? microsoft?.connected_brokers ?? 0) ? SUCCESS : WARNING} sub={microsoft?.graph_mode === "application" ? "Azure app" : "Tokens courtier"} />
      </div>

      {/* Microsoft 365 + AVA insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="pp-card lg:col-span-2" style={{ padding: 20 }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)" }}>Microsoft 365 · emails et réunions réels</h3>
            {microsoft?.truncated && <span style={{ fontSize: 10, color: WARNING }}>Top {microsoft.scanned_brokers} courtiers scannés</span>}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#4A7FA5" }} />
              <YAxis tick={{ fontSize: 10, fill: "#4A7FA5" }} />
              <Tooltip content={<TooltipDark />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ms_emails_received" name="Emails reçus" fill={ACCENT} radius={[4, 4, 0, 0]} />
              <Bar dataKey="ms_emails_sent" name="Emails envoyés" fill={SUCCESS} radius={[4, 4, 0, 0]} />
              <Bar dataKey="ms_meetings" name="Réunions" fill={AGENT} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="pp-card" style={{ padding: 20 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Insights AVA</h3>
          {insights.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--pp-text-faint)", padding: "50px 0", textAlign: "center" }}>Chargement des insights…</p>
          ) : (
            <ul className="space-y-2">
              {insights.map((item, i) => (
                <li key={i} className="flex gap-2" style={{ fontSize: 12, color: "var(--pp-text-secondary)" }}>
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: AGENT }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {microsoft && ((microsoft.upcomingMeetings?.length ?? 0) > 0 || (microsoft.topSenders?.length ?? 0) > 0 || (microsoft.graphErrors?.length ?? 0) > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="pp-card lg:col-span-2" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Prochaines réunions Teams</h3>
            {microsoft.upcomingMeetings.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }}>Aucune réunion à venir trouvée.</p>
            ) : (
              <div className="space-y-2">
                {microsoft.upcomingMeetings.slice(0, 8).map((meeting, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
                    <Calendar className="w-4 h-4 shrink-0" style={{ color: AGENT }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-primary)" }}>{meeting.subject || "Réunion"}</div>
                      <div style={{ fontSize: 10, color: "var(--pp-text-muted)" }}>{meeting.broker} · {meeting.start ? new Date(meeting.start).toLocaleString("fr-CA", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} · {meeting.attendees} participant(s)</div>
                    </div>
                    {meeting.is_online && meeting.join_url && (
                      <a href={meeting.join_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-md" style={{ fontSize: 10, fontWeight: 700, color: AGENT, background: `${AGENT}1A` }}>
                        <Video className="w-3 h-3" /> Rejoindre <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pp-card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Top expéditeurs</h3>
            {microsoft.topSenders.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }}>Aucun email reçu sur la période.</p>
            ) : (
              <div className="space-y-2">
                {microsoft.topSenders.map((sender) => (
                  <div key={sender.name} className="flex items-center justify-between gap-2">
                    <span className="truncate" style={{ fontSize: 11, color: "var(--pp-text-secondary)" }}>{sender.name}</span>
                    <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>{sender.count}</span>
                  </div>
                ))}
              </div>
            )}
            {microsoft.graphErrors.length > 0 && (
              <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--pp-bg-border-2)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: WARNING, marginBottom: 6 }}>Connexions limitées</div>
                <div style={{ fontSize: 10, color: "var(--pp-text-faint)" }}>{microsoft.graphErrors.length} courtier(s) doivent reconnecter Microsoft.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="pp-card lg:col-span-2" style={{ padding: 20 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Analyses par jour · 30 j</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#4A7FA5" }} />
              <YAxis tick={{ fontSize: 10, fill: "#4A7FA5" }} />
              <Tooltip content={<TooltipDark />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="analyses" name="Analyses" stroke={ACCENT} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="leads" name="Leads" stroke={SUCCESS} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="urgent" name="Urgent" stroke={WARNING} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="pp-card" style={{ padding: 20 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Satisfaction courtier</h3>
          {feedbackDonut.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--pp-text-faint)", padding: "60px 0", textAlign: "center" }}>Pas encore de feedback</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={feedbackDonut} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={4}>
                  {feedbackDonut.map((e, i) => <Cell key={i} fill={e.color} stroke="var(--pp-bg-surface)" strokeWidth={2} />)}
                </Pie>
                <Tooltip content={<TooltipDark />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Broker leaderboard + tool mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="pp-card lg:col-span-2" style={{ padding: 20 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Top courtiers · analyses vs actions</h3>
          {brokerLeaderboard.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--pp-text-faint)", padding: "40px 0", textAlign: "center" }}>Aucune donnée AVA pour le moment.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={brokerLeaderboard} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#4A7FA5" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#8FA8C0" }} width={140} />
                <Tooltip content={<TooltipDark />} cursor={{ fill: "rgba(46,155,220,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="analyses" name="Analyses" fill={ACCENT} radius={[0, 4, 4, 0]} />
                <Bar dataKey="emails" name="Emails reçus" fill={AGENT} radius={[0, 4, 4, 0]} />
                <Bar dataKey="meetings" name="Réunions" fill={WARNING} radius={[0, 4, 4, 0]} />
                <Bar dataKey="ok" name="Actions ✓" fill={SUCCESS} radius={[0, 4, 4, 0]} />
                <Bar dataKey="err" name="Erreurs" fill={DANGER} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="pp-card" style={{ padding: 20 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Outils AVA appelés</h3>
          {toolMix.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--pp-text-faint)", padding: "60px 0", textAlign: "center" }}>Aucun appel d'outil récent</p>
          ) : (
            <div className="space-y-2">
              {toolMix.map((t) => {
                const max = Math.max(...toolMix.map((x) => x.value));
                const pct = Math.round((t.value / max) * 100);
                return (
                  <div key={t.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ fontSize: 11, color: "var(--pp-text-secondary)" }} className="truncate">{t.name}</span>
                      <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: t.color }}>{t.value}</span>
                    </div>
                    <div style={{ height: 6, background: "var(--pp-bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: t.color, transition: "width .3s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent actions */}
      <div className="pp-card" style={{ padding: 20 }}>
        <h3 style={{ fontWeight: 600, fontSize: 14, color: "var(--pp-text-primary)", marginBottom: 12 }}>Actions AVA récentes</h3>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }}>Chargement…</p>
        ) : recentActions.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--pp-text-faint)" }}>Aucune action AVA récente.</p>
        ) : (
          <div className="space-y-1">
            {recentActions.map((a) => {
              const ok = a.success === true || a.status === "ok" || a.status === "success" || a.status === "executed";
              const color = ok ? SUCCESS : a.status === "error" ? DANGER : WARNING;
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--pp-text-primary)" }} className="truncate flex-1">
                    {a.action_type ?? a.action ?? "action"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--pp-text-muted)" }}>{a.broker_name || profiles[a.broker_user_id] || profiles[a.user_id] || a.broker_user_id?.slice(0, 8) || a.user_id?.slice(0, 8)}</span>
                  <span style={{ fontSize: 10, color: "var(--pp-text-faint)" }} className="tabular-nums">
                    {(a.executed_at || a.created_at) ? new Date(a.executed_at || a.created_at).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
