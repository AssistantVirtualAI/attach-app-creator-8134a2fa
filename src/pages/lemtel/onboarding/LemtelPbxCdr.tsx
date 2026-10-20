import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { pbxGateway, PbxGatewayError, type CdrFilter, type CdrRecord, type CdrStats } from "./lemtelPbxGatewayApi";
import { errorMessage, formatSeconds, L, type Lang } from "./lemtelPbxLabels";

const err = (lang: Lang, e: unknown) => errorMessage(lang, e instanceof PbxGatewayError ? e.code : "server_error");
const dayStart = (offsetDays: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offsetDays); return d; };
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInput = (s: string, endOfDay = false) => { const [y, m, d] = s.split("-").map(Number); const x = new Date(y, m - 1, d); if (endOfDay) x.setDate(x.getDate() + 1); return x.toISOString(); };

function PeriodBar({ lang, from, to, setFrom, setTo }: { lang: Lang; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const preset = (days: number) => { setFrom(toInput(dayStart(days))); setTo(toInput(dayStart(0))); };
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs lt-ink-2">{L(lang, "Du", "From")}<input type="date" className="lt-input mt-1 !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
    <label className="text-xs lt-ink-2">{L(lang, "Au", "To")}<input type="date" className="lt-input mt-1 !py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    {[[0, L(lang, "Aujourd’hui", "Today")], [6, L(lang, "7 jours", "7 days")], [29, L(lang, "30 jours", "30 days")]].map(([d, label]) => <button key={String(d)} className="lt-btn lt-btn-ghost !py-1.5 text-xs" onClick={() => preset(Number(d))}>{label}</button>)}
  </div>;
}

export function DirectionIcon({ r }: { r: Pick<CdrRecord, "direction" | "missed" | "billsec"> }) {
  if (r.missed || (r.direction === "inbound" && !r.billsec)) return <PhoneMissed className="w-4 h-4" style={{ color: "hsl(var(--lt-danger))" }} aria-label="missed" />;
  return r.direction === "outbound" ? <PhoneOutgoing className="w-4 h-4" aria-label="outbound" /> : <PhoneIncoming className="w-4 h-4" aria-label="inbound" />;
}

/** Call history (admins: the whole domain; members: their extension — enforced by the server) with recording playback and CSV export. */
export function LemtelPbxCallHistory({ lang, organizationId, recordedOnly = false, canExport = true, canSync = true }: { lang: Lang; organizationId: string; recordedOnly?: boolean; canExport?: boolean; canSync?: boolean }) {
  const [from, setFrom] = useState(toInput(dayStart(6)));
  const [to, setTo] = useState(toInput(dayStart(0)));
  const [direction, setDirection] = useState("");
  const [search, setSearch] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ records: CdrRecord[]; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const pageSize = 50;
  const filter = useMemo<CdrFilter>(() => ({ from: fromInput(from), to: fromInput(to, true), direction: direction || undefined, search: search.trim() || undefined, missedOnly, recordedOnly, limit: pageSize, offset: page * pageSize }),
    [direction, from, missedOnly, page, recordedOnly, search, to]);
  const load = useCallback(async () => {
    try { setData(await pbxGateway.cdr(organizationId, filter)); } catch (e) { setData({ records: [], total: 0 }); toast.error(err(lang, e)); }
  }, [filter, lang, organizationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);
  const sync = async () => { setBusy("sync"); try { const r = await pbxGateway.syncCdr(organizationId); toast.success(`${L(lang, "Synchronisé", "Synced")} : ${r.rowsSeen}`); await load(); } catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); } };
  const exportCsv = async () => {
    setBusy("csv");
    try { const blob = await pbxGateway.cdrCsv(organizationId, { ...filter, offset: 0 }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lemtel-cdr-${from}-${to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); }
  };
  const play = async (r: CdrRecord) => {
    setBusy(r.id);
    try { const blob = await pbxGateway.recording(organizationId, r.id); if (audio) URL.revokeObjectURL(audio.url); setAudio({ id: r.id, url: URL.createObjectURL(blob) }); }
    catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  return <section className="lt-card p-5" aria-label={recordedOnly ? L(lang, "Enregistrements", "Recordings") : L(lang, "Historique des appels", "Call history")}>
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <PeriodBar lang={lang} from={from} to={to} setFrom={(v) => { setFrom(v); setPage(0); }} setTo={(v) => { setTo(v); setPage(0); }} />
      <div className="flex flex-wrap gap-2">
        {canSync && <button className="lt-btn lt-btn-ghost !py-1.5" onClick={() => void sync()} disabled={busy !== null}>{busy === "sync" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{L(lang, "Synchroniser", "Sync")}</button>}
        {canExport && <button className="lt-btn lt-btn-ghost !py-1.5" onClick={() => void exportCsv()} disabled={busy !== null}>{busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}CSV</button>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2 mb-3 text-sm">
      <select className="lt-input !py-1.5 !w-auto" aria-label={L(lang, "Direction", "Direction")} value={direction} onChange={(e) => { setDirection(e.target.value); setPage(0); }}>
        <option value="">{L(lang, "Toutes directions", "All directions")}</option><option value="inbound">{L(lang, "Entrants", "Inbound")}</option><option value="outbound">{L(lang, "Sortants", "Outbound")}</option><option value="local">{L(lang, "Internes", "Internal")}</option>
      </select>
      <input className="lt-input !py-1.5 !w-auto" aria-label={L(lang, "Numéro ou nom", "Number or name")} placeholder={L(lang, "Numéro ou nom", "Number or name")} value={search} maxLength={40} onChange={(e) => { setSearch(e.target.value.replace(/[^0-9A-Za-z+ ._-]/g, "")); setPage(0); }} />
      <label className="flex items-center gap-2"><input type="checkbox" checked={missedOnly} onChange={(e) => { setMissedOnly(e.target.checked); setPage(0); }} />{L(lang, "Manqués seulement", "Missed only")}</label>
    </div>
    {audio && <audio className="w-full mb-3" controls autoPlay src={audio.url} aria-label={L(lang, "Lecture de l’enregistrement", "Recording playback")} />}
    {data === null ? <div className="lt-skeleton h-32" /> : data.records.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun appel sur cette période. La copie locale se synchronise automatiquement (au plus toutes les 2 minutes).", "No call in this period. The local copy synchronizes automatically (at most every 2 minutes).")}</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-2" /><th className="p-2">{L(lang, "Date", "Date")}</th><th className="p-2">{L(lang, "De", "From")}</th><th className="p-2">{L(lang, "Vers", "To")}</th><th className="p-2">{L(lang, "Durée", "Duration")}</th><th className="p-2">{L(lang, "Fin", "Hangup")}</th><th className="p-2" /></tr></thead>
        <tbody>{data.records.map((r) => <tr key={r.id} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
          <td className="p-2"><DirectionIcon r={r} /></td>
          <td className="p-2 whitespace-nowrap">{r.startAt ? new Date(r.startAt).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA") : "—"}</td>
          <td className="p-2"><div>{r.callerNumber || "—"}</div>{r.callerName && <div className="lt-ink-2 text-xs">{r.callerName}</div>}</td>
          <td className="p-2">{r.destination || "—"}</td><td className="p-2 tabular-nums">{formatSeconds(r.billsec)}</td><td className="p-2 text-xs lt-ink-2">{r.hangupCause ?? "—"}</td>
          <td className="p-2 text-right">{r.hasRecording && <button className="lt-btn lt-btn-ghost !py-1 text-xs" disabled={busy !== null} onClick={() => void play(r)}>{busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}{L(lang, "Écouter", "Play")}</button>}</td>
        </tr>)}</tbody></table>
        <div className="flex items-center justify-between mt-3 text-sm"><span className="lt-ink-2">{data.total} {L(lang, "appels", "calls")}</span><div className="flex gap-2 items-center"><button className="lt-btn lt-btn-ghost !py-1" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button><span>{page + 1} / {pages}</span><button className="lt-btn lt-btn-ghost !py-1" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>›</button></div></div>
      </div>}
  </section>;
}

function Bars({ items, label, value }: { items: Array<Record<string, unknown>>; label: string; value: string }) {
  const max = Math.max(1, ...items.map((i) => Number(i[value]) || 0));
  return <ul className="space-y-1.5">{items.map((i) => <li key={String(i[label])} className="grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-2 text-xs">
    <span className="truncate lt-ink-2">{String(i[label])}</span>
    <span className="h-2.5 rounded-full" style={{ width: `${(Number(i[value]) / max) * 100}%`, minWidth: 2, background: "hsl(var(--lt-cyan))" }} />
    <span className="tabular-nums">{String(i[value])}</span></li>)}</ul>;
}

export function LemtelPbxStats({ lang, organizationId }: { lang: Lang; organizationId: string }) {
  const [from, setFrom] = useState(toInput(dayStart(29)));
  const [to, setTo] = useState(toInput(dayStart(0)));
  const [stats, setStats] = useState<CdrStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    pbxGateway.cdrStats(organizationId, { from: fromInput(from), to: fromInput(to, true) }).then((r) => { if (!cancelled) setStats(r.stats); }).catch((e) => { if (!cancelled) { setStats(null); toast.error(err(lang, e)); } });
    return () => { cancelled = true; };
  }, [from, lang, organizationId, to]);
  const tiles: Array<[string, string]> = stats ? [
    [L(lang, "Appels", "Calls"), String(stats.total)], [L(lang, "Répondus", "Answered"), String(stats.answered)], [L(lang, "Manqués", "Missed"), String(stats.missed)],
    [L(lang, "Taux de réponse", "Answer rate"), stats.total ? `${Math.round((stats.answered / stats.total) * 100)} %` : "—"],
    [L(lang, "Temps de parole", "Talk time"), formatSeconds(stats.talkSeconds)], [L(lang, "Durée moyenne", "Average duration"), formatSeconds(stats.averageTalkSeconds)],
    [L(lang, "Entrants / sortants", "Inbound / outbound"), `${stats.inbound} / ${stats.outbound}`], [L(lang, "Enregistrés", "Recorded"), String(stats.recorded)],
  ] : [];
  return <section className="space-y-4" aria-label={L(lang, "Statistiques", "Statistics")}>
    <div className="lt-card p-5"><PeriodBar lang={lang} from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
    {!stats ? <div className="lt-skeleton h-40" /> : <>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{tiles.map(([k, v]) => <div key={k} className="lt-card p-4"><div className="lt-ink-2 text-xs uppercase tracking-wide">{k}</div><div className="text-2xl font-semibold mt-1 tabular-nums">{v}</div></div>)}</div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="lt-card p-5"><h3 className="font-semibold text-sm mb-3">{L(lang, "Appels par jour", "Calls per day")}</h3>{stats.byDay.length ? <Bars items={stats.byDay} label="day" value="total" /> : <p className="lt-ink-2 text-sm">—</p>}</div>
        <div className="lt-card p-5"><h3 className="font-semibold text-sm mb-3">{L(lang, "Appels par heure", "Calls per hour")}</h3>{stats.byHour.length ? <Bars items={stats.byHour.map((h) => ({ ...h, hour: `${String(h.hour).padStart(2, "0")} h` }))} label="hour" value="total" /> : <p className="lt-ink-2 text-sm">—</p>}</div>
        <div className="lt-card p-5"><h3 className="font-semibold text-sm mb-3">{L(lang, "Numéros les plus actifs", "Most active numbers")}</h3>{stats.topNumbers.length ? <Bars items={stats.topNumbers} label="number" value="total" /> : <p className="lt-ink-2 text-sm">—</p>}</div>
        <div className="lt-card p-5"><h3 className="font-semibold text-sm mb-3">{L(lang, "Causes de fin d’appel", "Hangup causes")}</h3>{stats.byCause.length ? <Bars items={stats.byCause} label="cause" value="total" /> : <p className="lt-ink-2 text-sm">—</p>}</div>
      </div>
    </>}
  </section>;
}
