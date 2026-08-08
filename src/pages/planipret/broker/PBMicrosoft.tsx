import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Mail, Inbox, Send, Calendar, Video, ExternalLink, Sparkles, X, Loader2, RefreshCw } from "lucide-react";
import { PAPage, PAPageHeader } from "@/components/planipret/admin/PAPageShell";
import { PPEmptyState, PPSkeleton } from "@/components/planipret/admin/PPPrimitives";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";
import { fmtDateTime } from "@/lib/planipret/brokerFormat";
import GranularityToggle from "@/components/planipret/broker/GranularityToggle";
import { bucketSeries, GRANULARITY_LABELS, type Granularity } from "@/lib/planipret/timeBuckets";

type Stats = {
  connected?: boolean;
  days?: number;
  totals?: { emails_received: number; emails_sent: number; emails_unread: number; meetings: number; meeting_minutes: number };
  daily?: Array<{ date: string; emails_received: number; emails_sent: number; meetings: number }>;
  topSenders?: Array<{ name: string; count: number }>;
  upcomingMeetings?: Array<{ subject: string; start: string; end: string; attendees: number; is_online: boolean; join_url: string | null }>;
  insights?: string[];
};

const PAGE_SIZE = 25;

export default function PBMicrosoft() {
  const { lang } = useMplanipretLang();
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsErr, setStatsErr] = useState<string | null>(null);

  const [folder, setFolder] = useState("inbox");
  const [page, setPage] = useState(1);
  const [emails, setEmails] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mailLoading, setMailLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadStats = async () => {
    setStatsLoading(true); setStatsErr(null);
    const { data, error } = await supabase.functions.invoke("ms365-stats", { body: { days, insights: true } });
    if (error) { setStatsErr(error.message); setStatsLoading(false); return; }
    setStats(data as Stats); setStatsLoading(false);
  };

  const loadEmails = async () => {
    setMailLoading(true);
    const { data } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "read_emails", payload: { folder, top: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE } },
    });
    setEmails((data as any)?.emails ?? []);
    setHasMore(Boolean((data as any)?.hasMore));
    setMailLoading(false);
  };

  useEffect(() => { void loadStats(); }, [days]);
  useEffect(() => { void loadEmails(); }, [folder, page]);

  const openEmail = async (id: string) => {
    setDetailLoading(true); setDetail({ id, loading: true });
    const { data } = await supabase.functions.invoke("ms365-actions", {
      body: { action: "read_email_detail", payload: { message_id: id } },
    });
    setDetail((data as any)?.email ?? null);
    setDetailLoading(false);
  };

  const t = stats?.totals;
  const series = bucketSeries(
    (stats?.daily ?? []).map((d) => ({ date: d.date, label: d.date, ...d })),
    granularity, lang as "fr" | "en", [],
  );
  const filtered = search.trim()
    ? emails.filter((e) => JSON.stringify(e).toLowerCase().includes(search.trim().toLowerCase()))
    : emails;

  return (
    <PAPage>
      <PAPageHeader
        icon={<Mail className="w-4 h-4" />}
        title="Microsoft 365"
        subtitle={lang === "en" ? "My emails and meetings" : "Mes courriels et réunions"}
      />

      <div className="pp-card flex flex-wrap items-center gap-2" style={{ padding: 12 }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="pp-input" style={{ fontSize: 12 }}>
          <option value={7}>{lang === "en" ? "Last 7 days" : "7 derniers jours"}</option>
          <option value={30}>{lang === "en" ? "Last 30 days" : "30 derniers jours"}</option>
          <option value={90}>{lang === "en" ? "Last 90 days" : "90 derniers jours"}</option>
          <option value={180}>{lang === "en" ? "Last 6 months" : "6 derniers mois"}</option>
          <option value={365}>{lang === "en" ? "Last 12 months" : "12 derniers mois"}</option>
        </select>
        <button onClick={() => { void loadStats(); void loadEmails(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ border: "1px solid var(--pp-bg-border)", color: "var(--pp-text-secondary)" }}>
          <RefreshCw className="w-3.5 h-3.5" />{lang === "en" ? "Refresh" : "Actualiser"}
        </button>
      </div>

      {statsLoading ? (
        <div className="pp-card p-4 space-y-2">{[0, 1, 2].map((i) => <PPSkeleton key={i} className="h-16 w-full" />)}</div>
      ) : statsErr ? (
        <div className="pp-card" style={{ padding: 16, color: "var(--pp-danger)", fontSize: 13 }}>Microsoft 365: {statsErr}</div>
      ) : stats?.connected === false ? (
        <div className="pp-card"><PPEmptyState icon={<Mail className="w-5 h-5" />}
          title={lang === "en" ? "Microsoft 365 not connected" : "Microsoft 365 non connecté"}
          description={lang === "en" ? "Connect your account from Settings." : "Connectez votre compte dans Réglages."} /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label={lang === "en" ? "Emails received" : "Courriels reçus"} value={t?.emails_received ?? 0} sub={`${t?.emails_unread ?? 0} ${lang === "en" ? "unread" : "non lus"}`} icon={<Inbox className="w-4 h-4" style={{ color: "#3b82f6" }} />} />
            <Kpi label={lang === "en" ? "Emails sent" : "Courriels envoyés"} value={t?.emails_sent ?? 0} icon={<Send className="w-4 h-4" style={{ color: "#10b981" }} />} />
            <Kpi label={lang === "en" ? "Meetings" : "Réunions"} value={t?.meetings ?? 0} sub={`${Math.round((t?.meeting_minutes ?? 0) / 60)}h`} icon={<Calendar className="w-4 h-4" style={{ color: "#9B7FE8" }} />} />
            <Kpi label={lang === "en" ? "Avg / day" : "Moy. / jour"} value={((t?.emails_received ?? 0) / Math.max(1, stats?.days ?? days)).toFixed(1)} sub={lang === "en" ? "received" : "reçus"} icon={<Mail className="w-4 h-4" style={{ color: "#f59e0b" }} />} />
          </div>

          {(stats?.daily?.length ?? 0) > 0 && (
            <div className="pp-card" style={{ padding: 14 }}>
              <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)" }}>
                  {lang === "en" ? `${GRANULARITY_LABELS[granularity].en} activity` : `Activité — ${GRANULARITY_LABELS[granularity].fr.toLowerCase()}`}
                </div>
                <GranularityToggle value={granularity} onChange={setGranularity} lang={lang as "fr" | "en"} />
              </div>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="emails_received" name={lang === "en" ? "Received" : "Reçus"} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="emails_sent" name={lang === "en" ? "Sent" : "Envoyés"} fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="meetings" name={lang === "en" ? "Meetings" : "Réunions"} fill="#9B7FE8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {(stats?.daily?.length ?? 0) > 0 && (
            <div className="grid gap-3 lg:grid-cols-3">
              {(["week", "month", "quarter"] as const).map((g) => {
                const rows = bucketSeries(
                  (stats?.daily ?? []).map((d) => ({ date: d.date, label: d.date, ...d })),
                  g, lang as "fr" | "en", [],
                );
                return (
                  <div key={g} className="pp-card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)", marginBottom: 8 }}>
                      {lang === "en" ? `${GRANULARITY_LABELS[g].en} trend` : `Tendance — ${GRANULARITY_LABELS[g].fr.toLowerCase()}`}
                    </div>
                    <div style={{ height: 190 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--pp-bg-border)" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
                          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                          <Tooltip />
                          <Area type="monotone" dataKey="emails_received" stackId="1" name={lang === "en" ? "Received" : "Reçus"} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                          <Area type="monotone" dataKey="emails_sent" stackId="1" name={lang === "en" ? "Sent" : "Envoyés"} stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                          <Area type="monotone" dataKey="meetings" stackId="1" name={lang === "en" ? "Meetings" : "Réunions"} stroke="#9B7FE8" fill="#9B7FE8" fillOpacity={0.3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          )}


          <div className="grid gap-3 lg:grid-cols-2">
            {(stats?.upcomingMeetings?.length ?? 0) > 0 && (
              <div className="pp-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)", marginBottom: 8 }}>
                  {lang === "en" ? "Upcoming meetings" : "Prochaines réunions"}
                </div>
                <div className="space-y-2">
                  {stats!.upcomingMeetings!.map((m, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate" style={{ fontSize: 13, color: "var(--pp-text-primary)" }}>{m.subject}</div>
                        <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{fmtDateTime(m.start, lang)} · {m.attendees} {lang === "en" ? "attendees" : "participants"}</div>
                      </div>
                      {m.is_online && m.join_url && (
                        <a href={m.join_url} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ fontSize: 11.5, color: "var(--pp-brand-accent-2)" }}>
                          <Video className="w-3.5 h-3.5" />{lang === "en" ? "Join" : "Joindre"}<ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(stats?.topSenders?.length ?? 0) > 0 && (
              <div className="pp-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)", marginBottom: 8 }}>
                  {lang === "en" ? "Top senders" : "Principaux expéditeurs"}
                </div>
                <div className="space-y-1.5">
                  {stats!.topSenders!.map((s, i) => (
                    <div key={i} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                      <span className="truncate" style={{ color: "var(--pp-text-primary)" }}>{s.name}</span>
                      <span style={{ color: "var(--pp-text-muted)" }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(stats?.insights?.length ?? 0) > 0 && (
            <div className="pp-card" style={{ padding: 14 }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 700, color: "var(--pp-text-secondary)", marginBottom: 6 }}>
                <Sparkles className="w-3.5 h-3.5" style={{ color: "#9B7FE8" }} />{lang === "en" ? "AVA insights" : "Analyses AVA"}
              </div>
              <ul className="space-y-1" style={{ fontSize: 12.5, color: "var(--pp-text-secondary)" }}>
                {stats!.insights!.map((s, i) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
        </>
      )}


      {tab === "mail" && <MailPanel lang={lang as "fr" | "en"} />}
      {tab === "teams" && <TeamsPanel lang={lang as "fr" | "en"} />}
      {tab === "calendar" && <CalendarPanel lang={lang as "fr" | "en"} />}

    </PAPage>
  );
}

function Kpi({ label, value, sub, icon }: { label: string; value: number | string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="pp-card" style={{ padding: 14 }}>
      <div className="flex items-center gap-2" style={{ fontSize: 11.5, color: "var(--pp-text-muted)" }}>{icon}{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--pp-text-primary)", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{sub}</div>}
    </div>
  );
}
