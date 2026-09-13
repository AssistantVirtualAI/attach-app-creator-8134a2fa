import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Phone, BarChart3, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

type Broker = { user_id: string | null; full_name: string | null; extension: string | null; email: string | null };
type Did = { extension: string | null; phone_number_e164: string | null; status: string | null; display_name: string | null };

const L = (lang: string, fr: string, en: string) => (lang === "en" ? en : fr);

/** Relance ciblée de la synchronisation des appareils d'UN courtier. */
export function BrokerDeviceResyncCard() {
  const { lang } = useMplanipretLang();
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    supabase
      .from("planipret_profiles")
      .select("user_id, full_name, extension, email")
      .not("extension", "is", null)
      .order("extension")
      .then(({ data }) => setBrokers((data as Broker[]) ?? []));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return brokers.slice(0, 300);
    return brokers
      .filter((b) => `${b.full_name ?? ""} ${b.extension ?? ""} ${b.email ?? ""}`.toLowerCase().includes(s))
      .slice(0, 300);
  }, [brokers, q]);

  const run = useCallback(async () => {
    const broker = brokers.find((b) => b.user_id === sel);
    if (!broker?.user_id) {
      toast.error(L(lang, "Choisissez un courtier", "Pick a broker"));
      return;
    }
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("ns-provision-broker-devices", {
      body: { broker_id: broker.user_id, force: true },
    });
    setBusy(false);
    if (error) {
      toast.error(L(lang, "Resynchronisation échouée", "Resync failed"), { description: error.message });
      return;
    }
    setResult(data);
    const ok = (data as any)?.success !== false;
    if (ok) toast.success(L(lang, `Appareils resynchronisés — poste ${broker.extension}`, `Devices resynced — ext ${broker.extension}`));
    else toast.error((data as any)?.error ?? L(lang, "Échec", "Failed"));
  }, [brokers, sel, lang]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <RefreshCw className="h-4 w-4" />
          {L(lang, "Resynchroniser un courtier", "Resync one broker")}
        </CardTitle>
        <CardDescription className="text-xs">
          {L(
            lang,
            "Relance immédiatement les appareils SIP (mobile + web) d'un seul courtier, sans attendre le traitement de la liste complète.",
            "Immediately rebuilds the SIP devices (mobile + web) of a single broker, without waiting for the full list run.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L(lang, "Rechercher (nom, poste, courriel)", "Search (name, ext, email)")}
            className="h-9 w-56 rounded-md border border-border bg-background px-3 text-sm"
          />
          <select
            value={sel}
            onChange={(e) => setSel(e.target.value)}
            className="h-9 min-w-[16rem] rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">{L(lang, "— Courtier —", "— Broker —")}</option>
            {filtered.map((b) => (
              <option key={`${b.user_id}-${b.extension}`} value={b.user_id ?? ""} disabled={!b.user_id}>
                {b.extension} · {b.full_name ?? b.email ?? b.user_id}
                {b.user_id ? "" : L(lang, " (sans compte)", " (no account)")}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={run} disabled={busy || !sel}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {L(lang, "Resynchroniser maintenant", "Resync now")}
          </Button>
        </div>
        {result && (
          <pre className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

/** DID assigné à un poste + vérification du routage NetSapiens. */
export function ExtensionDidCard({ defaultExtension = "1136" }: { defaultExtension?: string }) {
  const { lang } = useMplanipretLang();
  const [ext, setExt] = useState(defaultExtension);
  const [dids, setDids] = useState<Did[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("planipret_did_assignments")
      .select("extension, phone_number_e164, status, display_name")
      .eq("extension", ext);
    setDids((data as Did[]) ?? []);
    setLoading(false);
  }, [ext]);

  useEffect(() => { void load(); }, [load]);

  const runVerify = useCallback(async () => {
    const e164 = dids[0]?.phone_number_e164;
    if (!e164) { toast.error(L(lang, "Aucun numéro assigné à ce poste", "No number assigned to this extension")); return; }
    setVerifying(true);
    const { data, error } = await supabase.functions.invoke("pp-did-assign", { body: { action: "verify", e164, extension: ext } });
    setVerifying(false);
    if (error) { toast.error(L(lang, "Vérification échouée", "Verification failed"), { description: error.message }); return; }
    setVerify(data);
    const ok = (data as any)?.success !== false && (data as any)?.ok !== false;
    if (ok) toast.success(L(lang, "Routage vérifié sur le serveur", "Routing verified on the server"));
    else toast.error(L(lang, "Routage incorrect — voir le détail", "Routing mismatch — see details"));
  }, [dids, ext, lang]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Phone className="h-4 w-4" />
          {L(lang, "Numéro du poste", "Extension number")}
        </CardTitle>
        <CardDescription className="text-xs">
          {L(lang, "Numéro public qui sonne sur ce poste, et vérification du routage.", "Public number that rings this extension, plus routing verification.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={ext}
            onChange={(e) => setExt(e.target.value.replace(/\D/g, ""))}
            className="h-9 w-28 rounded-md border border-border bg-background px-3 font-mono text-sm"
            placeholder="1136"
          />
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {L(lang, "Recharger", "Reload")}
          </Button>
          <Button size="sm" onClick={runVerify} disabled={verifying || dids.length === 0}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {L(lang, "Vérifier le routage", "Verify routing")}
          </Button>
        </div>

        {dids.length === 0 ? (
          <p className="text-xs text-muted-foreground">{L(lang, "Aucun numéro assigné à ce poste.", "No number assigned to this extension.")}</p>
        ) : (
          <ul className="space-y-1">
            {dids.map((d) => (
              <li key={d.phone_number_e164} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-mono">{d.phone_number_e164}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{d.display_name ?? "—"}</span>
                  <Badge variant="outline">{d.status ?? "—"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}

        {verify && (
          <pre className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px]">{JSON.stringify(verify, null, 2)}</pre>
        )}
      </CardContent>
    </Card>
  );
}

type StatRow = {
  extension: string;
  name: string;
  inbound: number;
  outbound: number;
  missed: number;
  totalDuration: number;
  answered: number;
  cdrErrors: number;
};

/** Statistiques par poste : entrants, sortants, durée moyenne, erreurs CDR. */
export function ExtensionStatsCard() {
  const { lang } = useMplanipretLang();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<keyof StatRow>("inbound");

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const [{ data: calls }, { data: profiles }] = await Promise.all([
      supabase
        .from("planipret_phone_calls")
        .select("extension, direction, status, duration_seconds, ns_cdr_id, ns_callid, pipeline_error")
        .gte("started_at", since)
        .is("deleted_at", null)
        .limit(20000),
      supabase.from("planipret_profiles").select("extension, full_name").not("extension", "is", null),
    ]);
    const names = new Map((profiles ?? []).map((p: any) => [String(p.extension), p.full_name as string]));
    const map = new Map<string, StatRow>();
    for (const c of (calls as any[]) ?? []) {
      const ext = String(c.extension ?? "").trim();
      if (!ext) continue;
      const r = map.get(ext) ?? {
        extension: ext, name: names.get(ext) ?? "—",
        inbound: 0, outbound: 0, missed: 0, totalDuration: 0, answered: 0, cdrErrors: 0,
      };
      if (c.direction === "outbound") r.outbound += 1;
      else if (c.direction === "missed") { r.missed += 1; r.inbound += 1; }
      else r.inbound += 1;
      const d = Number(c.duration_seconds ?? 0);
      if (d > 0) { r.totalDuration += d; r.answered += 1; }
      if (!c.ns_cdr_id && !c.ns_callid) r.cdrErrors += 1;
      else if (c.pipeline_error) r.cdrErrors += 1;
      map.set(ext, r);
    }
    setRows([...map.values()]);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a[sort], vb = b[sort];
      if (typeof va === "number" && typeof vb === "number") return vb - va;
      return String(va).localeCompare(String(vb));
    });
    return arr;
  }, [rows, sort]);

  const fmtAvg = (r: StatRow) => (r.answered ? `${Math.round(r.totalDuration / r.answered)} s` : "—");

  const exportCsv = () => {
    const head = ["extension", "name", "inbound", "outbound", "missed", "avg_seconds", "cdr_errors"];
    const lines = sorted.map((r) => [r.extension, r.name, r.inbound, r.outbound, r.missed, r.answered ? Math.round(r.totalDuration / r.answered) : 0, r.cdrErrors].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stats-postes-${days}j.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <BarChart3 className="h-4 w-4" />
          {L(lang, "Statistiques par poste", "Per-extension statistics")}
        </CardTitle>
        <CardDescription className="text-xs">
          {L(lang, "Appels entrants, sortants, durée moyenne et anomalies de CDR.", "Inbound, outbound, average duration and CDR anomalies.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value={7}>{L(lang, "7 jours", "7 days")}</option>
            <option value={30}>{L(lang, "30 jours", "30 days")}</option>
            <option value={90}>{L(lang, "90 jours", "90 days")}</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as keyof StatRow)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="inbound">{L(lang, "Trier : entrants", "Sort: inbound")}</option>
            <option value="outbound">{L(lang, "Trier : sortants", "Sort: outbound")}</option>
            <option value="cdrErrors">{L(lang, "Trier : erreurs CDR", "Sort: CDR errors")}</option>
            <option value="extension">{L(lang, "Trier : poste", "Sort: extension")}</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {L(lang, "Recharger", "Reload")}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!sorted.length}>CSV</Button>
          <span className="text-xs text-muted-foreground">{sorted.length} {L(lang, "postes", "extensions")}</span>
        </div>

        <div className="pa-scroll max-h-[460px] overflow-auto rounded-md border">
          <table className="pa-table w-full text-sm">
            <thead>
              <tr>
                <th>{L(lang, "Poste", "Ext")}</th>
                <th>{L(lang, "Courtier", "Broker")}</th>
                <th className="pa-num">{L(lang, "Entrants", "Inbound")}</th>
                <th className="pa-num">{L(lang, "Manqués", "Missed")}</th>
                <th className="pa-num">{L(lang, "Sortants", "Outbound")}</th>
                <th className="pa-num">{L(lang, "Durée moy.", "Avg duration")}</th>
                <th className="pa-num">{L(lang, "Erreurs CDR", "CDR errors")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">{loading ? "…" : L(lang, "Aucune donnée sur la période", "No data for this period")}</td></tr>
              ) : sorted.map((r) => (
                <tr key={r.extension}>
                  <td className="font-mono">{r.extension}</td>
                  <td>{r.name}</td>
                  <td className="pa-num">{r.inbound}</td>
                  <td className="pa-num">{r.missed}</td>
                  <td className="pa-num">{r.outbound}</td>
                  <td className="pa-num">{fmtAvg(r)}</td>
                  <td className="pa-num">
                    {r.cdrErrors > 0 ? <Badge variant="outline" className="border-amber-500/30 text-amber-600">{r.cdrErrors}</Badge> : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
