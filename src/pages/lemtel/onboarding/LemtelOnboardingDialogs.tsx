import { useMemo, useState } from "react";
import { Download, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { onboarding, LemtelError, LEMTEL_ONBOARDING_ENABLED } from "./lemtelHostedApi";
import type { LemtelDict, Lang } from "./lemtelI18n";
import { Field, Panel } from "./LemtelUi";
import { LemtelEmailPreview, type DownloadLinks } from "./LemtelEmailPreview";
import { csvTemplate, parseLemtelCsv, resultsCsv, LEMTEL_ROLES, type ParsedRow } from "./lemtelCsv";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const errText = (t: LemtelDict, e: unknown) => t.errors[e instanceof LemtelError ? e.key : "generic"];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function NewOrgDialog({ open, onClose, t, links, support, existingSlugs, onCreated }: {
  open: boolean; onClose: () => void; t: LemtelDict; links: DownloadLinks; support?: string; existingSlugs: string[]; onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState({ name: "", slug: "", lang: "fr" as Lang, adminName: "", adminEmail: "", color: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v, ...(k === "name" && !slugTouched ? { slug: slugify(v) } : {}) }));
  const errors = {
    name: !f.name.trim() ? t.errors.invalid_input : "",
    slug: !SLUG_RE.test(f.slug) ? t.slugHint : existingSlugs.includes(f.slug) ? t.errors.conflict : "",
    adminName: !f.adminName.trim() ? t.errors.invalid_input : "",
    adminEmail: !EMAIL_RE.test(f.adminEmail.trim()) ? t.errors.invalid_input : "",
  };
  const valid = Object.values(errors).every((x) => !x);
  const [touched, setTouched] = useState(false);
  const close = () => { setStep(1); setErr(null); setTouched(false); onClose(); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await onboarding("create_organization", {
        name: f.name.trim(), slug: f.slug, default_language: f.lang,
        admin_full_name: f.adminName.trim(), admin_email: f.adminEmail.trim().toLowerCase(), brand_color: f.color || null,
      });
      toast.success(t.orgCreated);
      setF({ name: "", slug: "", lang: "fr", adminName: "", adminEmail: "", color: "" }); setSlugTouched(false);
      onCreated(); close();
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };
  return (
    <Panel open={open} onClose={close} title={t.newOrg} wide
      footer={step === 1 ? <>
        <button className="lt-btn lt-btn-ghost" onClick={close}>{t.cancel}</button>
        <button className="lt-btn lt-btn-gold" onClick={() => { setTouched(true); if (valid) setStep(2); }}>{t.next}</button>
      </> : <>
        <button className="lt-btn lt-btn-ghost" onClick={() => setStep(1)}>{t.back}</button>
        <button className="lt-btn lt-btn-gold" disabled={busy || !LEMTEL_ONBOARDING_ENABLED} onClick={submit}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.create}</button>
      </>}>
      {step === 1 ? (
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={t.orgName} error={touched ? errors.name : undefined}>{(id) => <input id={id} className="lt-input" value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label={t.slug} error={touched || slugTouched ? errors.slug || undefined : undefined} hint={t.slugHint}>{(id, d) => <input id={id} aria-describedby={d} className="lt-input font-mono" value={f.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }} />}</Field>
          <Field label={t.defaultLang}>{(id) => <select id={id} className="lt-input" value={f.lang} onChange={(e) => set("lang", e.target.value)}><option value="fr">{t.french}</option><option value="en">{t.english}</option></select>}</Field>
          <Field label={t.orgColor}>{(id) => <input id={id} type="color" className="lt-input !p-1 h-[46px]" value={f.color || "#0ea5c6"} onChange={(e) => set("color", e.target.value)} />}</Field>
          <Field label={t.adminName} error={touched ? errors.adminName : undefined}>{(id) => <input id={id} className="lt-input" value={f.adminName} onChange={(e) => set("adminName", e.target.value)} />}</Field>
          <Field label={t.adminEmail} error={touched ? errors.adminEmail : undefined}>{(id) => <input id={id} type="email" className="lt-input" value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} />}</Field>
        </div>
      ) : (
        <div className="grid md:grid-cols-[1fr_1.1fr] gap-6">
          <section aria-labelledby="lt-sec" className="space-y-3">
            <h3 id="lt-sec" className="font-semibold">{t.securityTitle}</h3>
            <ul className="space-y-2">{t.securityItems.map((s) => <li key={s} className="flex gap-2 text-sm"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--lt-green))" }} />{s}</li>)}</ul>
            {err && <p className="lt-error" role="alert">{err}</p>}
            {!LEMTEL_ONBOARDING_ENABLED && <p className="lt-notice px-3 py-2 text-xs">{t.readonlyBody}</p>}
          </section>
          <section aria-label={t.previewEmail}>
            <h3 className="font-semibold mb-2">{t.previewEmail} · {f.lang.toUpperCase()}</h3>
            <LemtelEmailPreview lang={f.lang} name={f.adminName} email={f.adminEmail} org={f.name} links={links} support={support} />
          </section>
        </div>
      )}
    </Panel>
  );
}

export function InviteDrawer({ open, onClose, t, orgId, onDone }: { open: boolean; onClose: () => void; t: LemtelDict; orgId: string | null; onDone: () => void }) {
  const blank = { first: "", last: "", email: "", lang: "inherit", role: "user", dept: "", title: "", sendNow: true };
  const [f, setF] = useState(blank); const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const bad = { first: !f.first.trim(), last: !f.last.trim(), email: !EMAIL_RE.test(f.email.trim()) };
  const submit = async () => {
    setTouched(true); if (Object.values(bad).some(Boolean) || !orgId) return;
    setBusy(true); setErr(null);
    try {
      await onboarding("invite_user", {
        organization_id: orgId, first_name: f.first.trim(), last_name: f.last.trim(), email: f.email.trim().toLowerCase(),
        language: f.lang === "inherit" ? null : f.lang, role: f.role, department: f.dept || null, title: f.title || null, send_now: f.sendNow,
      });
      toast.success(f.sendNow ? t.inviteSent : t.inviteSaved);
      setF(blank); setTouched(false); onDone(); onClose();
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };
  return (
    <Panel open={open} onClose={onClose} title={t.invitePerson} side
      footer={<><button className="lt-btn lt-btn-ghost" onClick={onClose}>{t.cancel}</button>
        <button className="lt-btn lt-btn-gold" disabled={busy || !LEMTEL_ONBOARDING_ENABLED || !orgId} onClick={submit}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.invite}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.firstName} error={touched && bad.first ? t.errors.invalid_input : undefined}>{(id) => <input id={id} className="lt-input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />}</Field>
          <Field label={t.lastName} error={touched && bad.last ? t.errors.invalid_input : undefined}>{(id) => <input id={id} className="lt-input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />}</Field>
        </div>
        <Field label={t.email} error={touched && bad.email ? t.errors.invalid_input : undefined}>{(id) => <input id={id} type="email" className="lt-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.language}>{(id) => <select id={id} className="lt-input" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}><option value="inherit">{t.inherit}</option><option value="fr">{t.french}</option><option value="en">{t.english}</option></select>}</Field>
          <Field label={t.role}>{(id) => <select id={id} className="lt-input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{LEMTEL_ROLES.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}</select>}</Field>
        </div>
        <Field label={t.department}>{(id) => <input id={id} className="lt-input" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })} />}</Field>
        <Field label={t.title}>{(id) => <input id={id} className="lt-input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sendNow} onChange={(e) => setF({ ...f, sendNow: e.target.checked })} />{t.sendNow}</label>
        {err && <p className="lt-error" role="alert">{err}</p>}
        {!LEMTEL_ONBOARDING_ENABLED && <p className="lt-notice px-3 py-2 text-xs">{t.readonlyBody}</p>}
      </div>
    </Panel>
  );
}

type Result = { email: string; status: "created" | "invited" | "skipped" | "failed" };

export function BulkInvite({ open, onClose, t, orgId, onDone }: { open: boolean; onClose: () => void; t: LemtelDict; orgId: string | null; onDone: () => void }) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null); const [headerError, setHeaderError] = useState(false);
  const [drag, setDrag] = useState(false); const [step, setStep] = useState<"upload" | "preview" | "confirm" | "results">("upload");
  const [sendNow, setSendNow] = useState(true); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [results, setResults] = useState<Result[]>([]);
  const good = useMemo(() => (rows ?? []).filter((r) => !r.errors.length), [rows]);
  const counts = useMemo(() => ({
    valid: good.filter((r) => !r.warnings.length).length, warn: good.filter((r) => r.warnings.length).length, invalid: (rows ?? []).length - good.length,
    fr: good.filter((r) => r.data.language === "fr").length, en: good.filter((r) => r.data.language === "en").length, inh: good.filter((r) => !r.data.language).length,
  }), [rows, good]);
  const reset = () => { setRows(null); setStep("upload"); setResults([]); setErr(null); setHeaderError(false); };
  const close = () => { reset(); onClose(); };
  const read = async (file?: File) => {
    if (!file) return;
    const { rows: r, headerError: h } = parseLemtelCsv(await file.text());
    setHeaderError(h); setRows(r); if (!h) setStep("preview");
  };
  const run = async () => {
    if (!orgId) return; setBusy(true); setErr(null);
    try {
      const res = await onboarding<{ results?: Result[] }>("bulk_invite", {
        organization_id: orgId, send_now: sendNow,
        users: good.map((r) => ({ ...r.data, language: r.data.language || null, department: r.data.department || null, title: r.data.title || null })),
      });
      const out = (res.results ?? []).map((x) => ({ email: String(x.email), status: x.status }));
      setResults(out); setStep("results"); onDone();
    } catch (e) { setErr(errText(t, e)); } finally { setBusy(false); }
  };
  const tally = (s: Result["status"]) => results.filter((r) => r.status === s).length;
  return (
    <Panel open={open} onClose={close} title={t.bulk} wide
      footer={step === "preview" ? <><button className="lt-btn lt-btn-ghost" onClick={reset}>{t.back}</button><button className="lt-btn lt-btn-gold" disabled={!good.length} onClick={() => setStep("confirm")}>{t.next}</button></>
        : step === "confirm" ? <><button className="lt-btn lt-btn-ghost" onClick={() => setStep("preview")}>{t.back}</button><button className="lt-btn lt-btn-gold" disabled={busy || !LEMTEL_ONBOARDING_ENABLED || !orgId} onClick={run}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t.confirmBulk(good.length)}</button></>
        : step === "results" ? <><button className="lt-btn lt-btn-ghost" onClick={() => download("lemtel-invitations-results.csv", resultsCsv(results))}><Download className="w-4 h-4" />{t.exportResults}</button><button className="lt-btn lt-btn-gold" onClick={close}>{t.done}</button></>
        : <button className="lt-btn lt-btn-ghost" onClick={() => download("lemtel-invitations-template.csv", csvTemplate())}><Download className="w-4 h-4" />{t.template}</button>}>
      {step === "upload" && (
        <label data-active={drag} className="lt-dropzone flex flex-col items-center justify-center gap-3 p-12 cursor-pointer text-center"
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}>
          <Upload className="w-8 h-8" style={{ color: "hsl(var(--lt-cyan))" }} />
          <span className="font-medium">{t.drop}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
          {headerError && <span className="lt-error" role="alert">{t.headerError}</span>}
        </label>
      )}
      {step === "preview" && rows && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap"><span className="lt-chip lt-chip-ok">{counts.valid} {t.valid}</span><span className="lt-chip lt-chip-warn">{counts.warn} {t.warnings}</span><span className="lt-chip lt-chip-bad">{counts.invalid} {t.invalid}</span></div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-2">{t.line}</th><th className="p-2">{t.firstName}</th><th className="p-2">{t.lastName}</th><th className="p-2">Email</th><th className="p-2">{t.language}</th><th className="p-2">{t.role}</th><th className="p-2"></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.line} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
                <td className="p-2 tabular-nums">{r.line}</td><td className="p-2">{r.data.first_name}</td><td className="p-2">{r.data.last_name}</td>
                <td className="p-2 break-all">{r.data.email}</td><td className="p-2">{r.data.language || "—"}</td><td className="p-2">{r.data.role}</td>
                <td className="p-2">{[...r.errors.map((x) => <span key={x} className="lt-chip lt-chip-bad mr-1">{t.issues[x]}</span>), ...r.warnings.map((x) => <span key={x} className="lt-chip lt-chip-warn mr-1">{t.issues[x]}</span>)]}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}
      {step === "confirm" && (
        <div className="space-y-4">
          <p className="text-lg font-semibold">{t.confirmBulk(good.length)}</p>
          <p className="text-sm">{t.langDist} : FR {counts.fr} · EN {counts.en} · {t.inherit} {counts.inh}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />{t.sendNow}</label>
          {err && <p className="lt-error" role="alert">{err}</p>}
          {!LEMTEL_ONBOARDING_ENABLED && <p className="lt-notice px-3 py-2 text-xs">{t.readonlyBody}</p>}
        </div>
      )}
      {step === "results" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["created", "invited", "skipped", "failed"] as const).map((s) => (
            <div key={s} className="lt-card p-4"><div className="lt-ink-2 text-xs">{t[s]}</div><div className="text-2xl font-semibold tabular-nums">{tally(s)}</div></div>
          ))}
        </div>
      )}
    </Panel>
  );
}
