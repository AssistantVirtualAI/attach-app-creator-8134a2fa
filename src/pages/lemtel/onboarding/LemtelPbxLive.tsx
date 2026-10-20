import { useCallback, useEffect, useRef, useState } from "react";
import { Ear, Loader2, PhoneForwarded, PhoneOff, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { pbxGateway, PbxGatewayError, type Capabilities, type LiveCall, type Registration } from "./lemtelPbxGatewayApi";
import { errorMessage, L, type Lang } from "./lemtelPbxLabels";

const err = (lang: Lang, e: unknown) => errorMessage(lang, e instanceof PbxGatewayError ? e.code : "server_error");
const since = (iso: string | null, now: number) => { if (!iso) return "—"; const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Live calls of this domain (refresh every 5 s while visible) with hang up, transfer and listen / whisper / barge. */
export function LemtelPbxLiveCalls({ lang, organizationId, canAct }: { lang: Lang; organizationId: string; canAct: boolean }) {
  const [calls, setCalls] = useState<LiveCall[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const failures = useRef(0);
  const load = useCallback(async () => {
    try { setCalls((await pbxGateway.liveCalls(organizationId)).calls); failures.current = 0; }
    catch (e) { failures.current++; if (failures.current === 1) toast.error(err(lang, e)); if (failures.current >= 3) setPaused(true); setCalls((c) => c ?? []); }
  }, [lang, organizationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); setNow(Date.now()); }, 5000);
    return () => clearInterval(t);
  }, [load, paused]);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); } };
  return <section className="lt-card p-5" aria-label={L(lang, "Appels en cours", "Live calls")}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h3 className="font-semibold">{L(lang, "Appels en cours", "Live calls")} {calls ? <span className="lt-chip lt-chip-cyan">{calls.length}</span> : null}</h3>
      <div className="flex gap-2"><button className="lt-btn lt-btn-ghost !py-1.5" onClick={() => setPaused((p) => !p)}>{paused ? <ToggleLeft className="w-4 h-4" /> : <ToggleRight className="w-4 h-4" />}{paused ? L(lang, "Rafraîchissement en pause", "Auto-refresh paused") : L(lang, "Rafraîchi toutes les 5 s", "Refreshing every 5 s")}</button>
        <button className="lt-btn lt-btn-ghost !py-1.5" aria-label={L(lang, "Actualiser", "Refresh")} onClick={() => void load()}><RefreshCw className="w-4 h-4" /></button></div>
    </div>
    {calls === null ? <div className="lt-skeleton h-20" /> : calls.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun appel en cours dans ce domaine.", "No live call in this domain.")}</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-2">{L(lang, "Appelant", "Caller")}</th><th className="p-2">{L(lang, "Destination", "Destination")}</th><th className="p-2">{L(lang, "État", "State")}</th><th className="p-2">{L(lang, "Durée", "Duration")}</th><th className="p-2" /></tr></thead>
        <tbody>{calls.map((c) => <tr key={c.uuid} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
          <td className="p-2"><div className="font-medium">{c.callerNumber || "—"}</div><div className="lt-ink-2 text-xs">{c.callerName}</div></td>
          <td className="p-2">{c.destination || "—"}</td><td className="p-2"><span className="lt-chip">{c.state || c.direction}</span>{c.secure && <ShieldCheck className="w-3.5 h-3.5 inline ml-1" aria-label="SRTP" />}</td>
          <td className="p-2 tabular-nums">{since(c.createdAt, now)}</td>
          <td className="p-2"><div className="flex gap-1 justify-end flex-wrap">
            {(["listen", "whisper", "barge"] as const).map((mode) => <button key={mode} className="lt-btn lt-btn-ghost !py-1 text-xs" disabled={!canAct || busy !== null} onClick={() => void act(`${c.uuid}:${mode}`, () => pbxGateway.eavesdrop(organizationId, c.uuid, mode), L(lang, "Votre poste sonne.", "Your extension is ringing."))}><Ear className="w-3.5 h-3.5" />{mode === "listen" ? L(lang, "Écouter", "Listen") : mode === "whisper" ? L(lang, "Chuchoter", "Whisper") : L(lang, "Intervenir", "Barge")}</button>)}
            <button className="lt-btn lt-btn-ghost !py-1 text-xs" disabled={!canAct || busy !== null} onClick={() => { const dest = window.prompt(L(lang, "Transférer vers (poste ou numéro) :", "Transfer to (extension or number):"))?.trim(); if (dest) void act(`${c.uuid}:t`, () => pbxGateway.transfer(organizationId, c.uuid, dest), L(lang, "Appel transféré.", "Call transferred.")); }}><PhoneForwarded className="w-3.5 h-3.5" />{L(lang, "Transférer", "Transfer")}</button>
            <button className="lt-btn lt-btn-ghost !py-1 text-xs" style={{ color: "hsl(var(--lt-danger))" }} disabled={!canAct || busy !== null} onClick={() => { if (window.confirm(L(lang, "Raccrocher cet appel ?", "Hang up this call?"))) void act(`${c.uuid}:h`, () => pbxGateway.hangup(organizationId, c.uuid), L(lang, "Appel raccroché.", "Call hung up.")); }}>{busy === `${c.uuid}:h` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneOff className="w-3.5 h-3.5" />}{L(lang, "Raccrocher", "Hang up")}</button>
          </div></td></tr>)}</tbody></table></div>}
    {!canAct && <p className="lt-ink-2 text-xs mt-3">{errorMessage(lang, "management_writes_disabled")}</p>}
  </section>;
}

export function LemtelPbxRegistrations({ lang, organizationId }: { lang: Lang; organizationId: string }) {
  const [rows, setRows] = useState<Registration[] | null>(null);
  const load = useCallback(async () => { try { setRows((await pbxGateway.registrations(organizationId)).registrations); } catch (e) { setRows([]); toast.error(err(lang, e)); } }, [lang, organizationId]);
  useEffect(() => { void load(); }, [load]);
  return <section className="lt-card p-5" aria-label={L(lang, "Appareils enregistrés", "Registered devices")}>
    <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{L(lang, "Appareils enregistrés (SIP)", "Registered devices (SIP)")} {rows ? <span className="lt-chip">{rows.length}</span> : null}</h3><button className="lt-btn lt-btn-ghost !py-1.5" aria-label={L(lang, "Actualiser", "Refresh")} onClick={() => void load()}><RefreshCw className="w-4 h-4" /></button></div>
    {rows === null ? <div className="lt-skeleton h-16" /> : rows.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun appareil enregistré.", "No registered device.")}</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-2">{L(lang, "Poste", "Extension")}</th><th className="p-2">{L(lang, "Appareil", "Device")}</th><th className="p-2">IP</th><th className="p-2">{L(lang, "Expire", "Expires")}</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={`${r.user}-${i}`} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}><td className="p-2 font-medium">{r.user}</td><td className="p-2 text-xs">{r.agent || "—"}</td><td className="p-2 text-xs tabular-nums">{r.networkIp || "—"}</td><td className="p-2 text-xs">{r.expiresAt ? new Date(r.expiresAt).toLocaleTimeString(lang === "fr" ? "fr-CA" : "en-CA") : "—"}</td></tr>)}</tbody></table></div>}
  </section>;
}

/** Management status: test, owners' agreement switch (platform), CDR sync state. */
export function LemtelPbxManagementStatus({ lang, organizationId, caps, onChanged, readonly }: { lang: Lang; organizationId: string; caps: Capabilities; onChanged: () => void; readonly: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); onChanged(); } catch (e) { toast.error(err(lang, e)); } finally { setBusy(null); } };
  const isPlatform = caps.role === "platform";
  return <section className="lt-card p-5" aria-label={L(lang, "Gestion FusionPBX", "FusionPBX management")}>
    <h3 className="font-semibold">{L(lang, "Gestion FusionPBX du domaine", "Domain FusionPBX management")}</h3>
    <div className="flex flex-wrap gap-2 mt-3 text-sm">
      <span className={`lt-chip ${caps.verifiedAt ? "lt-chip-ok" : "lt-chip-warn"}`}>{caps.verifiedAt ? `${L(lang, "Testée", "Tested")} · ${caps.domainName}` : L(lang, "Non testée", "Not tested")}</span>
      <span className={`lt-chip ${caps.writesEnabled ? "lt-chip-ok" : "lt-chip-warn"}`}>{caps.writesEnabled ? L(lang, "Modifications autorisées", "Changes allowed") : L(lang, "Lecture seule", "Read-only")}</span>
      <span className="lt-chip">{L(lang, "CDR synchronisés", "CDR synced")} : {caps.cdrSync?.last_run_at ? new Date(caps.cdrSync.last_run_at).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA") : "—"}</span>
    </div>
    <div className="flex flex-wrap gap-2 mt-4">
      <button className="lt-btn lt-btn-ghost" disabled={readonly || busy !== null} onClick={() => void run("test", () => pbxGateway.testManagement(organizationId), L(lang, "Connexion de gestion vérifiée.", "Management connection verified."))}>{busy === "test" && <Loader2 className="w-4 h-4 animate-spin" />}{L(lang, "Tester la connexion de gestion", "Test management connection")}</button>
      {isPlatform && (caps.writesEnabled
        ? <button className="lt-btn lt-btn-ghost" disabled={readonly || busy !== null} onClick={() => void run("off", () => pbxGateway.setWrites(organizationId, false), L(lang, "Modifications désactivées.", "Changes disabled."))}>{L(lang, "Repasser en lecture seule", "Back to read-only")}</button>
        : <button className="lt-btn lt-btn-gold" disabled={readonly || busy !== null || !caps.verifiedAt} onClick={() => { if (window.confirm(L(lang, "Confirmer que les responsables du PBX (Kenny et Phil) ont donné leur accord pour que Lemtel modifie ce domaine ?", "Confirm the PBX owners (Kenny and Phil) agreed that Lemtel may change this domain?"))) void run("on", () => pbxGateway.setWrites(organizationId, true), L(lang, "Modifications autorisées.", "Changes allowed.")); }}>{L(lang, "Autoriser les modifications (accord des responsables du PBX)", "Allow changes (PBX owners’ agreement)")}</button>)}
    </div>
    <p className="lt-ink-2 text-xs mt-3">{L(lang, "Chaque opération est limitée au domaine FusionPBX de cette organisation et inscrite au journal (sans aucune valeur secrète).", "Every operation is confined to this organization’s FusionPBX domain and logged (without any secret value).")}</p>
  </section>;
}
