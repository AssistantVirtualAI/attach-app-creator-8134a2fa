import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, Mail, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Dot = { label: string; value: string; ok: boolean | null; to: string; Icon: React.ComponentType<{ className?: string }> };

export default function OvConnectionsStrip({ profile, lang }: { profile: any; lang: "fr" | "en" }) {
  const [maestro, setMaestro] = useState<boolean | null>(null);
  const [m365, setM365] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mRes, oRes] = await Promise.all([
        supabase.functions.invoke("maestro-oauth-status", { body: {} }).catch(() => ({ data: null } as any)),
        supabase.functions.invoke("ms365-stats", { body: { days: 1, insights: false } }).catch(() => ({ data: null } as any)),
      ]);
      if (cancelled) return;
      const md: any = (mRes as any)?.data;
      setMaestro(Boolean(md?.connected || md?.status === "connected"));
      const od: any = (oRes as any)?.data;
      setM365(Boolean(od) && (od as any).connected !== false);
    })();
    return () => { cancelled = true; };
  }, []);

  const dots: Dot[] = [
    {
      label: "Maestro", Icon: Link2, to: "/planipret/broker/settings", ok: maestro,
      value: maestro == null ? "…" : maestro ? (lang === "en" ? "Connected" : "Connecté") : (lang === "en" ? "Reconnect" : "À reconnecter"),
    },
    {
      label: "Microsoft 365", Icon: Mail, to: "/planipret/broker/microsoft", ok: m365,
      value: m365 == null ? "…" : m365 ? (lang === "en" ? "Connected" : "Connecté") : (lang === "en" ? "Not connected" : "Non connecté"),
    },
    {
      label: lang === "en" ? "Telephony" : "Téléphonie", Icon: Phone, to: "/planipret/broker/settings", ok: Boolean(profile?.extension),
      value: profile?.extension ? `${lang === "en" ? "Ext." : "Poste"} ${profile.extension}` : (lang === "en" ? "No extension" : "Aucun poste"),
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {dots.map(({ label, value, ok, to, Icon }) => (
        <Link key={label} to={to} className="pp-card flex items-center gap-2" style={{ padding: "8px 12px" }}>
          <Icon className="w-3.5 h-3.5" style={{ color: "var(--pp-text-muted)" }} />
          <span style={{ fontSize: 11, color: "var(--pp-text-secondary)" }}>{label}</span>
          <span
            className="inline-block rounded-full"
            style={{ width: 7, height: 7, background: ok == null ? "var(--pp-text-muted)" : ok ? "#22c55e" : "#E8A33C" }}
          />
          <span style={{ fontSize: 11, color: "var(--pp-text-primary)" }}>{value}</span>
        </Link>
      ))}
    </div>
  );
}
