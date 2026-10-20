import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, ListTree, Loader2, Pencil, Play, Plus, RefreshCw, Search, Square, Trash2, Voicemail } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, Panel } from "./LemtelUi";
import { pbxApi, type PbxMember } from "./lemtelPbxApi";
import { pbxGateway, PbxGatewayError, type CatalogEntry, type FieldSpec, type Item, type VoicemailMessage } from "./lemtelPbxGatewayApi";
import { CHILD_OF, errorMessage, fieldLabel, formatSeconds, L, resourceLabel, type Lang } from "./lemtelPbxLabels";

type Props = { lang: Lang; organizationId: string; entry: CatalogEntry; catalog: CatalogEntry[]; writesEnabled: boolean; readonly: boolean; isPlatform: boolean; parentUuid?: string };
const err = (lang: Lang, e: unknown) => errorMessage(lang, e instanceof PbxGatewayError ? e.code : "server_error");
const asBool = (v: unknown) => v === true || v === "true";
const display = (lang: Lang, v: unknown) => v === null || v === undefined || v === "" ? "—" : v === "true" || v === true ? L(lang, "Oui", "Yes") : v === "false" || v === false ? L(lang, "Non", "No") : String(v);

/** Columns: the label field first, then up to five other short readable fields (never uuids). */
function columnsFor(entry: CatalogEntry): string[] {
  const rest = entry.read.filter((f) => f !== entry.label && !f.endsWith("_uuid") && !/description|greet|template|record_template|moh/.test(f)).slice(0, 5);
  return [entry.label, ...rest];
}

export default function LemtelPbxResourceManager({ lang, organizationId, entry, catalog, writesEnabled, readonly, isPlatform, parentUuid }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ item: Item | null } | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [child, setChild] = useState<Item | null>(null);
  const [voicemail, setVoicemail] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [gwStatus, setGwStatus] = useState<Record<string, string>>({});
  const canWrite = writesEnabled && !readonly;
  const columns = useMemo(() => columnsFor(entry), [entry]);
  const childKey = CHILD_OF[entry.key];
  const childEntry = childKey ? catalog.find((c) => c.key === childKey) : undefined;

  const load = useCallback(async (q = search) => {
    setError(null);
    try {
      setItems((await pbxGateway.list(organizationId, entry.key, { parentUuid, search: q || undefined, limit: 500 })).items);
      if (entry.key === "gateways" && isPlatform) setGwStatus((await pbxGateway.gatewaysStatus(organizationId).catch(() => ({ status: {} }))).status);
    } catch (e) { setItems([]); setError(err(lang, e)); }
  }, [entry.key, isPlatform, lang, organizationId, parentUuid, search]);
  useEffect(() => { setItems(null); void load(""); setSearch(""); }, [entry.key, organizationId, parentUuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try { await pbxGateway.remove(organizationId, entry.key, String(deleting[entry.uuid])); toast.success(L(lang, "Supprimé.", "Deleted.")); setDeleting(null); await load(); }
    catch (e) { toast.error(err(lang, e)); } finally { setBusy(false); }
  };
  const gateway = async (item: Item, op: "start" | "stop") => {
    try { await pbxGateway.gatewayControl(organizationId, String(item[entry.uuid]), op); toast.success(op === "start" ? L(lang, "Passerelle démarrée.", "Gateway started.") : L(lang, "Passerelle arrêtée.", "Gateway stopped.")); await load(); }
    catch (e) { toast.error(err(lang, e)); }
  };

  return <section className={parentUuid ? "" : "lt-card p-5"} aria-label={resourceLabel(lang, entry.key)}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      {!parentUuid && <h3 className="font-semibold">{resourceLabel(lang, entry.key)}{items ? <span className="lt-chip ml-2">{items.length}</span> : null}</h3>}
      <div className="flex flex-wrap gap-2 ml-auto">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(search); }}>
          <input className="lt-input !py-1.5 min-w-[160px]" aria-label={L(lang, "Rechercher", "Search")} placeholder={L(lang, "Rechercher…", "Search…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="lt-btn lt-btn-ghost !py-1.5" aria-label={L(lang, "Rechercher", "Search")}><Search className="w-4 h-4" /></button>
        </form>
        <button className="lt-btn lt-btn-ghost !py-1.5" onClick={() => void load()} aria-label={L(lang, "Actualiser", "Refresh")}><RefreshCw className="w-4 h-4" /></button>
        {entry.ops.includes("create") && <button className="lt-btn lt-btn-gold !py-1.5" disabled={!canWrite} title={!writesEnabled ? errorMessage(lang, "management_writes_disabled") : undefined} onClick={() => setEditing({ item: null })}><Plus className="w-4 h-4" />{L(lang, "Ajouter", "Add")}</button>}
      </div>
    </div>
    {error && <p className="lt-error text-sm mb-2" role="alert">{error}</p>}
    {items === null ? <div className="lt-skeleton h-24" /> : items.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun élément dans ce domaine.", "No item in this domain.")}</p> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left lt-ink-2 text-xs uppercase">{columns.map((c) => <th key={c} className="p-2">{fieldLabel(lang, c)}</th>)}{entry.key === "gateways" && <th className="p-2">{L(lang, "État", "State")}</th>}<th className="p-2" /></tr></thead>
        <tbody>{items.map((item) => <tr key={String(item[entry.uuid])} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
          {columns.map((c) => <td key={c} className={`p-2 ${c === entry.label ? "font-medium" : ""}`}>{display(lang, item[c])}</td>)}
          {entry.key === "gateways" && <td className="p-2"><span className={`lt-chip ${/REGED|UP/i.test(gwStatus[String(item[entry.uuid])] ?? "") ? "lt-chip-ok" : "lt-chip-warn"}`}>{gwStatus[String(item[entry.uuid])] ?? "—"}</span></td>}
          <td className="p-2"><div className="flex gap-1 justify-end flex-wrap">
            {childEntry && <button className="lt-btn lt-btn-ghost !py-1 text-xs" onClick={() => setChild(item)}><ListTree className="w-3.5 h-3.5" />{resourceLabel(lang, childEntry.key)}</button>}
            {entry.key === "voicemails" && <button className="lt-btn lt-btn-ghost !py-1 text-xs" onClick={() => setVoicemail(item)}><Voicemail className="w-3.5 h-3.5" />{L(lang, "Messages / NIP", "Messages / PIN")}</button>}
            {entry.key === "gateways" && isPlatform && <><button className="lt-btn lt-btn-ghost !py-1 text-xs" aria-label={L(lang, "Démarrer", "Start")} onClick={() => void gateway(item, "start")}><Play className="w-3.5 h-3.5" /></button><button className="lt-btn lt-btn-ghost !py-1 text-xs" aria-label={L(lang, "Arrêter", "Stop")} onClick={() => void gateway(item, "stop")}><Square className="w-3.5 h-3.5" /></button></>}
            {entry.ops.includes("update") && <button className="lt-btn lt-btn-ghost !py-1 text-xs" aria-label={L(lang, "Modifier", "Edit")} onClick={() => setEditing({ item })}><Pencil className="w-3.5 h-3.5" /></button>}
            {entry.ops.includes("delete") && <button className="lt-btn lt-btn-ghost !py-1 text-xs" style={{ color: "hsl(var(--lt-danger))" }} aria-label={L(lang, "Supprimer", "Delete")} disabled={!canWrite} onClick={() => setDeleting(item)}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div></td></tr>)}</tbody></table></div>}
    {editing && <ResourceEditor lang={lang} organizationId={organizationId} entry={entry} item={editing.item} parentUuid={parentUuid} canWrite={canWrite} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    <ConfirmDialog open={Boolean(deleting)} danger busy={busy} message={`${L(lang, "Supprimer définitivement de FusionPBX", "Permanently delete from FusionPBX")} : ${display(lang, deleting?.[entry.label])} ?`} confirmLabel={L(lang, "Supprimer", "Delete")} cancelLabel={L(lang, "Annuler", "Cancel")} onConfirm={() => void remove()} onCancel={() => setDeleting(null)} />
    {child && childEntry && <Panel open wide side title={`${resourceLabel(lang, childEntry.key)} — ${display(lang, child[entry.label])}`} onClose={() => setChild(null)}>
      <LemtelPbxResourceManager lang={lang} organizationId={organizationId} entry={childEntry} catalog={catalog} writesEnabled={writesEnabled} readonly={readonly} isPlatform={isPlatform} parentUuid={String(child[entry.uuid])} />
    </Panel>}
    {voicemail && <VoicemailPanel lang={lang} organizationId={organizationId} item={voicemail} canWrite={canWrite} onClose={() => setVoicemail(null)} />}
  </section>;
}

function inputFor(lang: Lang, name: string, spec: FieldSpec, value: unknown, onChange: (v: unknown) => void, disabled: boolean, isNew: boolean) {
  const id = `pbx-${name}`;
  const label = <label htmlFor={id} className="lt-ink-2 text-xs block">{fieldLabel(lang, name)}</label>;
  if (spec.t === "bool") return <label key={name} className="flex items-center gap-2 text-sm py-1"><input id={id} type="checkbox" checked={asBool(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{fieldLabel(lang, name)}</label>;
  if (spec.t === "enum") return <div key={name}>{label}<select id={id} className="lt-input mt-1" value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{spec.values.map((v) => <option key={v} value={v}>{v === "" ? "—" : v}</option>)}</select></div>;
  if (spec.t === "int") return <div key={name}>{label}<input id={id} className="lt-input mt-1" type="number" min={spec.min} max={spec.max} value={value === null || value === undefined ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} /></div>;
  if (spec.t === "secret") return <div key={name}>{label}<input id={id} className="lt-input mt-1" type="password" autoComplete="new-password" value={String(value ?? "")} placeholder={isNew ? "" : L(lang, "laisser vide pour conserver", "leave empty to keep")} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></div>;
  return <div key={name}>{label}<input id={id} className="lt-input mt-1" maxLength={spec.t === "str" ? spec.max : 36} value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></div>;
}

function ResourceEditor({ lang, organizationId, entry, item, parentUuid, canWrite, onClose, onSaved }: { lang: Lang; organizationId: string; entry: CatalogEntry; item: Item | null; parentUuid?: string; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = item === null;
  const fields = Object.entries(entry.write).filter(([name]) => !(entry.parent && name === entry.parent.field));
  const initial = useMemo(() => Object.fromEntries(fields.map(([name, spec]) => [name, spec.t === "secret" ? "" : spec.t === "bool" ? (isNew ? true : asBool(item?.[name])) : spec.t === "int" ? (item?.[name] === undefined || item?.[name] === null || item?.[name] === "" ? null : Number(item[name])) : (item?.[name] ?? "")])), [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<PbxMember[]>([]);
  const [boundUser, setBoundUser] = useState<string>("");
  const [assignTo, setAssignTo] = useState<string>("");
  useEffect(() => {
    if (entry.key !== "extensions") return;
    pbxApi.get(organizationId).then((s) => {
      setMembers(s.members);
      const current = item ? s.assignments.find((a) => a.extension === String(item.extension)) : undefined;
      setBoundUser(current?.userId ?? ""); setAssignTo(current?.userId ?? "");
    }).catch(() => undefined);
  }, [entry.key, item, organizationId]);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const changed: Record<string, unknown> = {};
    for (const [name, spec] of fields) {
      const v = values[name];
      if (spec.t === "secret") { if (typeof v === "string" && v) changed[name] = v; continue; }
      if (spec.t === "int" && (v === null || v === undefined)) continue;
      if (isNew ? (v !== "" && v !== null) : v !== initial[name]) changed[name] = typeof v === "string" ? v.trim() : v;
    }
    if (isNew && entry.parent && parentUuid) changed[entry.parent.field] = parentUuid;
    const assign = entry.key === "extensions" && assignTo && assignTo !== boundUser ? assignTo : undefined;
    if (!Object.keys(changed).length && !assign) { onClose(); return; }
    if (!Object.keys(changed).length && assign) changed.enabled = asBool(item?.enabled ?? true);
    setBusy(true); setError(null);
    try {
      if (isNew) await pbxGateway.create(organizationId, entry.key, changed, assign); else await pbxGateway.update(organizationId, entry.key, String(item![entry.uuid]), changed, assign);
      toast.success(isNew ? L(lang, "Créé dans FusionPBX.", "Created in FusionPBX.") : L(lang, "Enregistré dans FusionPBX.", "Saved in FusionPBX."));
      onSaved();
    } catch (e) { setError(err(lang, e)); } finally { setBusy(false); }
  };
  return <Panel open side title={`${isNew ? L(lang, "Ajouter", "Add") : L(lang, "Modifier", "Edit")} — ${resourceLabel(lang, entry.key)}`} onClose={onClose}
    footer={<><button className="lt-btn lt-btn-ghost" onClick={onClose}>{L(lang, "Annuler", "Cancel")}</button><button className="lt-btn lt-btn-gold" disabled={!canWrite || busy} onClick={() => void save()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{L(lang, "Enregistrer", "Save")}</button></>}>
    <div className="space-y-3">
      {!canWrite && <p className="lt-notice p-3 text-sm">{errorMessage(lang, "management_writes_disabled")}</p>}
      {fields.map(([name, spec]) => inputFor(lang, name, spec, values[name], (v) => setValues((cur) => ({ ...cur, [name]: v })), !canWrite || busy, isNew))}
      {entry.key === "extensions" && <div><label htmlFor="pbx-assign" className="lt-ink-2 text-xs block">{L(lang, "Utilisateur Lemtel (applications Mobile / Desktop)", "Lemtel user (Mobile / Desktop apps)")}</label>
        <select id="pbx-assign" className="lt-input mt-1" value={assignTo} disabled={!canWrite || busy} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">{L(lang, "— aucun —", "— none —")}</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name} · {m.email}</option>)}</select>
        <p className="lt-ink-2 text-xs mt-1">{L(lang, "Le mot de passe SIP saisi ici est aussi remis (chiffré) aux applications de cet utilisateur.", "The SIP password entered here is also delivered (encrypted) to this user’s apps.")}</p></div>}
      {error && <p className="lt-error text-sm" role="alert">{error}</p>}
    </div>
  </Panel>;
}

function VoicemailPanel({ lang, organizationId, item, canWrite, onClose }: { lang: Lang; organizationId: string; item: Item; canWrite: boolean; onClose: () => void }) {
  const uuid = String(item.voicemail_uuid);
  const [messages, setMessages] = useState<VoicemailMessage[] | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const play = async (m: VoicemailMessage) => { try { const b = await pbxGateway.voicemailAudio(organizationId, m.uuid, uuid); setAudio(URL.createObjectURL(b)); } catch (e) { toast.error(err(lang, e)); } };
  const load = useCallback(async () => { try { setMessages((await pbxGateway.voicemailMessages(organizationId, uuid)).messages); } catch (e) { setMessages([]); toast.error(err(lang, e)); } }, [lang, organizationId, uuid]);
  useEffect(() => { void load(); }, [load]);
  const reset = async () => {
    if (!window.confirm(purge ? L(lang, "Générer un nouveau NIP ET supprimer tous les messages ?", "Generate a new PIN AND delete every message?") : L(lang, "Générer un nouveau NIP pour cette boîte ?", "Generate a new PIN for this mailbox?"))) return;
    setBusy(true);
    try { const r = await pbxGateway.resetVoicemail(organizationId, uuid, purge); setPin(r.pin); toast.success(L(lang, "Boîte vocale réinitialisée.", "Mailbox reset.")); await load(); }
    catch (e) { toast.error(err(lang, e)); } finally { setBusy(false); }
  };
  const del = async (m: VoicemailMessage) => {
    try { await pbxGateway.deleteVoicemailMessage(organizationId, uuid, m.uuid); await load(); } catch (e) { toast.error(err(lang, e)); }
  };
  return <Panel open side title={`${L(lang, "Boîte vocale", "Voicemail")} ${String(item.voicemail_id ?? "")}`} onClose={onClose}>
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="font-semibold text-sm"><KeyRound className="w-4 h-4 inline" /> {L(lang, "Réinitialiser", "Reset")}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />{L(lang, "Supprimer aussi tous les messages", "Also delete every message")}</label>
        <button className="lt-btn lt-btn-gold" disabled={!canWrite || busy} onClick={() => void reset()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{L(lang, "Générer un nouveau NIP", "Generate a new PIN")}</button>
        {pin && <div className="lt-notice p-3 text-sm" role="status">{L(lang, "Nouveau NIP (affiché une seule fois, à transmettre à l’utilisateur)", "New PIN (shown once, give it to the user)")} : <code className="font-bold text-base">{pin}</code></div>}
      </section>
      <section>
        <h3 className="font-semibold text-sm mb-2">{L(lang, "Messages", "Messages")} {messages ? <span className="lt-chip">{messages.length}</span> : null}</h3>
        {messages === null ? <div className="lt-skeleton h-16" /> : messages.length === 0 ? <p className="lt-ink-2 text-sm">{L(lang, "Aucun message.", "No message.")}</p> :
          <ul className="space-y-2">{messages.map((m) => <li key={m.uuid} className="lt-card p-3 text-sm flex justify-between gap-3"><div><div className="font-medium">{m.callerName || m.callerNumber || "—"} <span className="lt-ink-2">{m.callerNumber}</span></div><div className="lt-ink-2 text-xs">{m.createdAt ? new Date(m.createdAt).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA") : "—"} · {formatSeconds(m.seconds)}</div>{m.transcription && <p className="text-xs mt-1">{m.transcription}</p>}</div>
            <div className="flex gap-1"><button className="lt-btn lt-btn-ghost !py-1" aria-label={L(lang, "Écouter", "Play")} onClick={() => void play(m)}><Play className="w-4 h-4" /></button><button className="lt-btn lt-btn-ghost !py-1" aria-label={L(lang, "Supprimer", "Delete")} disabled={!canWrite} onClick={() => void del(m)}><Trash2 className="w-4 h-4" /></button></div></li>)}</ul>}
        {audio && <audio className="w-full mt-3" controls autoPlay src={audio} aria-label={L(lang, "Lecture du message", "Message playback")} />}
      </section>
    </div>
  </Panel>;
}
