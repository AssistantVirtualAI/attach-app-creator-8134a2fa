import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

type Table = "planipret_phone_calls" | "planipret_phone_messages" | "planipret_voicemails";

export type PPActivityKind = "calls" | "messages" | "recordings" | "voicemail";

const ACCENTS: Record<PPActivityKind, [string, string]> = {
  calls: ["#3B82F6", "#22D3EE"],
  messages: ["#6366F1", "#A855F7"],
  recordings: ["#10B981", "#22D3EE"],
  voicemail: ["#F59E0B", "#F97316"],
};

const TABLE: Record<PPActivityKind, Table> = {
  calls: "planipret_phone_calls",
  recordings: "planipret_phone_calls",
  messages: "planipret_phone_messages",
  voicemail: "planipret_voicemails",
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: "var(--pp-bg-elevated)",
        border: "1px solid var(--pp-bg-border)",
        boxShadow: "0 16px 32px -26px rgba(0,0,0,.8)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--pp-text-secondary)", marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ height: 180 }}>{children}</div>
    </div>
  );
}

const tooltipStyle = {
  background: "rgba(6,13,26,.92)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 12,
  fontSize: 12,
  color: "#fff",
  backdropFilter: "blur(8px)",
} as const;

/**
 * Self-contained analytics strip (30 days) rendered at the top of
 * Planiprêt telephony pages. Broker scope is always filtered on user_id.
 */
export default function PPActivityCharts({
  kind,
  lang,
  userId,
  days = 30,
}: {
  kind: PPActivityKind;
  lang: "fr" | "en";
  /** Broker scope: restricts to this user. Omit for the admin (global) view. */
  userId?: string | null;
  days?: number;
}) {
  const isFr = lang !== "en";
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [a1, a2] = ACCENTS[kind];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const table = TABLE[kind];
      const cols =
        table === "planipret_phone_calls"
          ? "created_at,direction,status,duration"
          : table === "planipret_phone_messages"
            ? "created_at,direction,read_at"
            : "created_at,duration,is_read";
      let q: any = (supabase.from(table) as any).select(cols).gte("created_at", since).limit(5000);
      if (userId) q = q.eq("user_id", userId);
      if (kind === "recordings") q = q.eq("has_recording", true);
      const { data } = await q;
      if (cancelled) return;
      setRows((data as any[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [kind, userId, days]);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) map.set(dayKey(new Date(Date.now() - i * 86400000)), 0);
    for (const r of rows) {
      const k = String(r.created_at ?? "").slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].map(([d, v]) => ({ d: d.slice(5), v }));
  }, [rows, days]);

  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ h: `${h}h`, v: 0 }));
    for (const r of rows) {
      const dt = r.created_at ? new Date(r.created_at) : null;
      if (dt && !Number.isNaN(dt.getTime())) buckets[dt.getHours()].v++;
    }
    return buckets.filter((b) => Number(b.h.replace("h", "")) >= 6 && Number(b.h.replace("h", "")) <= 22);
  }, [rows]);

  const split = useMemo(() => {
    if (kind === "voicemail") {
      const read = rows.filter((r) => r.is_read).length;
      return [
        { name: isFr ? "Écoutés" : "Read", value: read },
        { name: isFr ? "Non écoutés" : "Unread", value: rows.length - read },
      ];
    }
    const inbound = rows.filter((r) => String(r.direction ?? "").includes("in")).length;
    const missed = kind === "calls" ? rows.filter((r) => r.status === "missed").length : 0;
    return [
      { name: isFr ? "Entrants" : "Inbound", value: Math.max(0, inbound - missed) },
      { name: isFr ? "Sortants" : "Outbound", value: Math.max(0, rows.length - inbound) },
      ...(kind === "calls" ? [{ name: isFr ? "Manqués" : "Missed", value: missed }] : []),
    ].filter((s) => s.value > 0);
  }, [rows, kind, isFr]);

  const pieColors = [a1, a2, "#EF4444", "#8B5CF6"];

  if (loading) {
    return (
      <div className="grid gap-3 mb-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl animate-pulse"
            style={{ height: 220, background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border)" }}
          />
        ))}
      </div>
    );
  }

  if (!rows.length) return null;

  return (
    <div className="grid gap-3 mb-4 md:grid-cols-3">
      <Card title={isFr ? `Activité — ${days} derniers jours` : `Activity — last ${days} days`}>
        <ResponsiveContainer>
          <AreaChart data={daily} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id={`ppa-${kind}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={a1} stopOpacity={0.75} />
                <stop offset="100%" stopColor={a1} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false} />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "var(--pp-text-secondary)" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-secondary)" }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="v" stroke={a1} strokeWidth={2} fill={`url(#ppa-${kind})`} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card title={isFr ? "Répartition par heure" : "By hour of day"}>
        <ResponsiveContainer>
          <BarChart data={hourly} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id={`ppb-${kind}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={a2} />
                <stop offset="100%" stopColor={a1} stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 10, fill: "var(--pp-text-secondary)" }} interval={1} />
            <YAxis tick={{ fontSize: 10, fill: "var(--pp-text-secondary)" }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,.05)" }} />
            <Bar dataKey="v" fill={`url(#ppb-${kind})`} radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title={isFr ? "Répartition" : "Breakdown"}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={split} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={3}>
              {split.map((_, i) => (
                <Cell key={i} fill={pieColors[i % pieColors.length]} stroke="rgba(6,13,26,.6)" />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--pp-text-secondary)" }} />
          </PieChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
