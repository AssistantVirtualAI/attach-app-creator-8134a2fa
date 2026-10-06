import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Activity, Bell, Building2, ChevronRight, Download, HelpCircle, LayoutDashboard, LogOut, Mail, Plus, Search, Shield, Smartphone, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import "./lemtel-portal.css";
import { lemtelClient, onboarding, LemtelError, LEMTEL_ONBOARDING_ENABLED, LEMTEL_BACKEND_CONFIGURED } from "./lemtelHostedApi";
import { useLemtelLang, type LemtelDict } from "./lemtelI18n";
import { ConfirmDialog, EmptyState, LemtelMonogram } from "./LemtelUi";
import { LemtelSignIn, needsPersonalPassword } from "./LemtelAuthScreens";
import { BulkInvite, InviteDrawer, NewOrgDialog } from "./LemtelOnboardingDialogs";
import type { DownloadLinks } from "./LemtelEmailPreview";

interface Org { id: string; name: string; slug: string; admin_name?: string; admin_email?: string; member_count?: number; pending_invitations?: number; status?: "healthy" | "in_progress" | "attention" }
interface Person { id: string; full_name: string; email: string; role: string; department?: string; title?: string; status?: string }
interface Invitation { id: string; email: string; full_name?: string; status: string; sent_at?: string; organization_id?: string }
interface ActivityItem { id: string; at: string; message: string }
interface Config { downloads?: DownloadLinks; support_contact?: string }

const BASE = "/lemtel-portal";

export default function LemtelPortalApp() {
  const { lang, setLang, t } = useLemtelLang();
  const [authed, setAuthed] = useState<boolean | null>(LEMTEL_BACKEND_CONFIGURED ? null : false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const c = lemtelClient(); if (!c) return;
    c.auth.getUser().then(({ data }) => setAuthed(!!data.user && !needsPersonalPassword(data.user))).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="lemtel-portal-scope min-h-screen p-10"><div className="lt-skeleton h-8 w-48" /></div>;
  if (!authed && !preview) {
    return (
      <>
        <LemtelSignIn t={t} lang={lang} setLang={setLang} onSignedIn={() => setAuthed(true)} />
        {!LEMTEL_BACKEND_CONFIGURED && (
          <button onClick={() => setPreview(true)} className="fixed bottom-4 left-4 z-40 lemtel-portal-scope lt-btn lt-btn-gold">{lang === "fr" ? "Voir le portail en lecture seule" : "View read-only portal"}</button>
        )}
      </>
    );
  }
  return <Shell t={t} lang={lang} setLang={setLang} readonly={!authed} onSignOut={async () => { await lemtelClient()?.auth.signOut(); setAuthed(false); setPreview(false); }} />;
}

function Shell({ t, lang, setLang, readonly, onSignOut }: { t: LemtelDict; lang: "fr" | "en"; setLang: (l: "fr" | "en") => void; readonly: boolean; onSignOut: () => void }) {
  const loc = useLocation();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [query, setQuery] = useState("");
  const [me, setMe] = useState<string>("");

  const loadOrgs = useCallback(async () => {
    if (readonly) { setOrgs([]); return; }
    try { const r = await onboarding<{ organizations?: Org[] }>("list_organizations"); setOrgs(r.organizations ?? []); }
    catch (e) { setOrgs([]); toast.error(t.errors[e instanceof LemtelError ? e.key : "generic"]); }
  }, [readonly, t]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  useEffect(() => {
    if (readonly) return;
    onboarding<Config>("get_config").then(setConfig).catch(() => null);
    lemtelClient()?.auth.getUser().then(({ data }) => setMe(data.user?.email ?? ""));
  }, [readonly]);

  const nav = [
    { to: "overview", icon: LayoutDashboard, label: t.nav.overview },
    { to: "organizations", icon: Building2, label: t.nav.organizations },
    { to: "people", icon: Users, label: t.nav.people },
    { to: "invitations", icon: Mail, label: t.nav.invitations },
    { to: "devices", icon: Smartphone, label: t.nav.devices },
    { to: "security", icon: Shield, label: t.nav.security },
    { to: "activity", icon: Activity, label: t.nav.activity },
  ];
  const current = nav.find((n) => loc.pathname.includes(`/${n.to}`)) ?? nav[0];
  const pending = (orgs ?? []).reduce((s, o) => s + (o.pending_invitations ?? 0), 0);
  const ctx = { t, orgs, orgId, setOrgId, reload: loadOrgs, config, query, readonly };

  return (
    <div className="lemtel-portal-scope min-h-screen flex">
      <aside className="lt-chrome hidden md:flex w-64 shrink-0 flex-col p-4 gap-1" aria-label="Lemtel">
        <div className="flex items-center gap-3 px-2 py-3 mb-4"><LemtelMonogram /><div><div className="font-semibold">{t.brand}</div><div className="lt-muted-on-navy text-xs">{t.tagline}</div></div></div>
        <nav className="flex flex-col gap-1">
          {nav.map(({ to, icon: I, label }) => (
            <NavLink key={to} to={`${BASE}/${to}`} className="lt-nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium"><I className="w-4 h-4" />{label}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lt-chrome flex items-center gap-3 px-4 md:px-6 h-16">
          <label className="sr-only" htmlFor="lt-org">{t.nav.organizations}</label>
          <select id="lt-org" className="lt-input !w-auto !py-2 max-w-[220px]" value={orgId ?? ""} onChange={(e) => setOrgId(e.target.value || null)}>
            <option value="">{t.allOrgs}</option>
            {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 lt-ink-2" aria-hidden />
            <input aria-label={t.search} placeholder={t.search} className="lt-input !py-2 pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button className="lt-chip" onClick={() => setLang(lang === "fr" ? "en" : "fr")} aria-label="Language">{lang === "fr" ? "EN" : "FR"}</button>
            <a className="p-2 rounded-lg lt-nav-item" href="mailto:support@lemtel.com" aria-label={t.help}><HelpCircle className="w-5 h-5" /></a>
            <NavLink to={`${BASE}/invitations`} className="relative p-2 rounded-lg lt-nav-item" aria-label={`${t.notifications}: ${pending}`}>
              <Bell className="w-5 h-5" />{pending > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center lt-btn-gold">{pending}</span>}
            </NavLink>
            <span className="hidden lg:inline text-sm lt-muted-on-navy px-2">{me}</span>
            <button className="p-2 rounded-lg lt-nav-item" onClick={onSignOut} aria-label={t.signOut}><LogOut className="w-5 h-5" /></button>
          </div>
        </header>
        <nav className="md:hidden lt-chrome flex overflow-x-auto gap-1 px-2 pb-2" aria-label="Lemtel mobile">
          {nav.map(({ to, label }) => <NavLink key={to} to={`${BASE}/${to}`} className="lt-nav-item px-3 py-1.5 rounded-lg text-xs whitespace-nowrap">{label}</NavLink>)}
        </nav>
        <main className="flex-1 p-4 md:p-8 max-w-[1180px] w-full mx-auto">
          <ol className="flex items-center gap-1 text-xs lt-ink-2 mb-2" aria-label="Breadcrumb">
            <li>{t.brand}</li><ChevronRight className="w-3 h-3" /><li aria-current="page" className="font-medium" style={{ color: "hsl(var(--lt-ink))" }}>{current.label}</li>
          </ol>
          {readonly || !LEMTEL_ONBOARDING_ENABLED ? (
            <div className="lt-notice p-4 mb-6" role="note"><p className="font-semibold">{t.readonlyTitle}</p><p className="text-sm">{t.readonlyBody}</p></div>
          ) : null}
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<Overview {...ctx} />} />
            <Route path="organizations" element={<Organizations {...ctx} />} />
            <Route path="people" element={<People {...ctx} />} />
            <Route path="invitations" element={<Invitations {...ctx} />} />
            <Route path="devices" element={<Devices {...ctx} />} />
            <Route path="security" element={<SecurityPage {...ctx} />} />
            <Route path="activity" element={<ActivityPage {...ctx} />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

type Ctx = { t: LemtelDict; orgs: Org[] | null; orgId: string | null; setOrgId: (id: string | null) => void; reload: () => void; config: Config; query: string; readonly: boolean };

function H({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 mb-6"><h1 className="text-2xl font-semibold">{title}</h1><div className="flex gap-2">{actions}</div></div>;
}
const Skeletons = () => <div className="grid md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="lt-skeleton h-32" />)}</div>;

function Overview({ t, orgs }: Ctx) {
  if (!orgs) return <Skeletons />;
  const people = orgs.reduce((s, o) => s + (o.member_count ?? 0), 0);
  const pending = orgs.reduce((s, o) => s + (o.pending_invitations ?? 0), 0);
  return (
    <>
      <H title={t.nav.overview} />
      <div className="grid sm:grid-cols-3 gap-4">
        {[{ k: t.overviewStats.orgs, v: orgs.length }, { k: t.overviewStats.people, v: people }, { k: t.overviewStats.pending, v: pending }].map((s) => (
          <div key={s.k} className="lt-card p-5"><div className="lt-ink-2 text-sm">{s.k}</div><div className="text-3xl font-semibold tabular-nums mt-1">{s.v}</div></div>
        ))}
      </div>
    </>
  );
}

function Organizations({ t, orgs, reload, config, query, setOrgId }: Ctx) {
  const [open, setOpen] = useState(false);
  const list = useMemo(() => (orgs ?? []).filter((o) => !query || `${o.name} ${o.slug}`.toLowerCase().includes(query.toLowerCase())), [orgs, query]);
  const health = (s?: Org["status"]) => s === "healthy" ? <span className="lt-chip lt-chip-ok">{t.healthy}</span> : s === "attention" ? <span className="lt-chip lt-chip-warn">{t.attention}</span> : <span className="lt-chip lt-chip-cyan">{t.inProgress}</span>;
  return (
    <>
      <H title={t.nav.organizations} actions={<button className="lt-btn lt-btn-gold" onClick={() => setOpen(true)}><Plus className="w-4 h-4" />{t.newOrg}</button>} />
      {!orgs ? <Skeletons /> : list.length === 0 ? <EmptyState icon={<Building2 className="w-6 h-6" />} text={t.empty.orgs} action={<button className="lt-btn lt-btn-gold" onClick={() => setOpen(true)}><Plus className="w-4 h-4" />{t.newOrg}</button>} /> : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((o) => (
            <button key={o.id} onClick={() => setOrgId(o.id)} className="lt-card p-5 text-left hover:-translate-y-0.5 transition">
              <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{o.name}</div><div className="lt-ink-2 text-xs font-mono">{o.slug}</div></div>{health(o.status)}</div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="lt-ink-2 text-xs">{t.administrator}</dt><dd className="truncate">{o.admin_name ?? "—"}</dd></div>
                <div><dt className="lt-ink-2 text-xs">{t.health}</dt><dd>{o.member_count ?? 0} {t.members} · {o.pending_invitations ?? 0} {t.pending}</dd></div>
              </dl>
            </button>
          ))}
        </div>
      )}
      <NewOrgDialog open={open} onClose={() => setOpen(false)} t={t} links={config.downloads ?? {}} support={config.support_contact} existingSlugs={(orgs ?? []).map((o) => o.slug)} onCreated={reload} />
    </>
  );
}

function useList<T>(action: string, key: string, orgId: string | null, readonly: boolean, t: LemtelDict, needsOrg = false) {
  const [items, setItems] = useState<T[] | null>(null);
  const load = useCallback(async () => {
    if (readonly || (needsOrg && !orgId)) { setItems([]); return; }
    setItems(null);
    try { const r: any = await onboarding(action, orgId ? { organization_id: orgId } : {}); setItems(r[key] ?? []); }
    catch (e) { setItems([]); toast.error(t.errors[e instanceof LemtelError ? e.key : "generic"]); }
  }, [action, key, orgId, readonly, t, needsOrg]);
  useEffect(() => { load(); }, [load]);
  return { items, load };
}

function People({ t, orgId, readonly, query, reload }: Ctx) {
  const { items, load } = useList<Person>("list_people", "people", orgId, readonly, t, true);
  const [invite, setInvite] = useState(false); const [bulk, setBulk] = useState(false);
  const list = (items ?? []).filter((p) => !query || `${p.full_name} ${p.email}`.toLowerCase().includes(query.toLowerCase()));
  const done = () => { load(); reload(); };
  return (
    <>
      <H title={t.nav.people} actions={<>
        <button className="lt-btn lt-btn-ghost" disabled={!orgId} onClick={() => setBulk(true)}><Upload className="w-4 h-4" />{t.bulk}</button>
        <button className="lt-btn lt-btn-gold" disabled={!orgId} onClick={() => setInvite(true)}><Plus className="w-4 h-4" />{t.invitePerson}</button>
      </>} />
      {!orgId ? <EmptyState icon={<Building2 className="w-6 h-6" />} text={t.allOrgs + " → " + t.nav.organizations} />
        : !items ? <Skeletons /> : list.length === 0 ? <EmptyState icon={<Users className="w-6 h-6" />} text={t.empty.people} /> : (
          <div className="lt-card overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-3">{t.lastName}</th><th className="p-3">Email</th><th className="p-3">{t.role}</th><th className="p-3">{t.department}</th></tr></thead>
            <tbody>{list.map((p) => <tr key={p.id} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}><td className="p-3 font-medium">{p.full_name}</td><td className="p-3">{p.email}</td><td className="p-3">{t.roles[p.role as keyof typeof t.roles] ?? p.role}</td><td className="p-3 lt-ink-2">{p.department ?? "—"}</td></tr>)}</tbody>
          </table></div>
        )}
      <InviteDrawer open={invite} onClose={() => setInvite(false)} t={t} orgId={orgId} onDone={done} />
      <BulkInvite open={bulk} onClose={() => setBulk(false)} t={t} orgId={orgId} onDone={done} />
    </>
  );
}

function Invitations({ t, orgId, readonly, query }: Ctx) {
  const { items, load } = useList<Invitation>("list_invitations", "invitations", orgId, readonly, t);
  const [pending, setPending] = useState<{ action: "resend_invitation" | "replace_temporary_password" | "revoke_invitation"; inv: Invitation } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = (items ?? []).filter((i) => !query || `${i.email} ${i.full_name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const chip = (s: string) => ["active", "delivered", "opened"].includes(s) ? "lt-chip-ok" : ["expired", "revoked"].includes(s) ? "lt-chip-bad" : s === "temp_pending" ? "lt-chip-warn" : "lt-chip-cyan";
  const run = async () => {
    if (!pending) return; setBusy(true);
    try { await onboarding(pending.action, { invitation_id: pending.inv.id }); toast.success(t.done); setPending(null); load(); }
    catch (e) { toast.error(t.errors[e instanceof LemtelError ? e.key : "generic"]); } finally { setBusy(false); }
  };
  const msg = pending?.action === "resend_invitation" ? t.confirmResend : pending?.action === "replace_temporary_password" ? t.confirmReplace : t.confirmRevoke;
  const label = pending?.action === "resend_invitation" ? t.resend : pending?.action === "replace_temporary_password" ? t.replace : t.revoke;
  return (
    <>
      <H title={t.nav.invitations} />
      {!items ? <Skeletons /> : list.length === 0 ? <EmptyState icon={<Mail className="w-6 h-6" />} text={t.empty.invites} /> : (
        <div className="lt-card overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left lt-ink-2 text-xs uppercase"><th className="p-3">Email</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
          <tbody>{list.map((i) => (
            <tr key={i.id} className="border-t" style={{ borderColor: "hsl(var(--lt-border))" }}>
              <td className="p-3"><div className="font-medium">{i.full_name ?? i.email}</div><div className="lt-ink-2 text-xs">{i.email}</div></td>
              <td className="p-3"><span className={`lt-chip ${chip(i.status)}`}>{t.inv[i.status] ?? i.status}</span></td>
              <td className="p-3"><div className="flex gap-2 justify-end flex-wrap">
                {i.status !== "active" && i.status !== "revoked" && <>
                  <button className="lt-btn lt-btn-ghost !py-1.5" disabled={!LEMTEL_ONBOARDING_ENABLED} onClick={() => setPending({ action: "resend_invitation", inv: i })}>{t.resend}</button>
                  <button className="lt-btn lt-btn-ghost !py-1.5" disabled={!LEMTEL_ONBOARDING_ENABLED} onClick={() => setPending({ action: "replace_temporary_password", inv: i })}>{t.replace}</button>
                  <button className="lt-btn lt-btn-ghost !py-1.5" style={{ color: "hsl(var(--lt-danger))" }} disabled={!LEMTEL_ONBOARDING_ENABLED} onClick={() => setPending({ action: "revoke_invitation", inv: i })}>{t.revoke}</button>
                </>}
              </div></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <ConfirmDialog open={!!pending} message={msg} confirmLabel={label} cancelLabel={t.cancel} danger={pending?.action !== "resend_invitation"} busy={busy} onConfirm={run} onCancel={() => setPending(null)} />
    </>
  );
}

function Devices({ t, config }: Ctx) {
  const d = config.downloads ?? {};
  return (
    <>
      <H title={t.nav.devices} />
      <div className="grid md:grid-cols-3 gap-4">
        {(["desktop", "ios", "android"] as const).map((k) => (
          <div key={k} className="lt-card p-5 flex flex-col gap-3">
            <div className="font-semibold">{t[k]}</div>
            {d[k] ? <a className="lt-btn lt-btn-gold self-start" href={d[k]} target="_blank" rel="noreferrer"><Download className="w-4 h-4" />{t.downloads}</a> : <span className="lt-chip">{t.notConfigured}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function SecurityPage({ t, config }: Ctx) {
  return (
    <>
      <H title={t.nav.security} />
      <div className="lt-card p-6 space-y-3">
        {t.securityPage.map((s) => <p key={s} className="flex gap-2 text-sm"><Shield className="w-4 h-4 mt-0.5" style={{ color: "hsl(var(--lt-cyan))" }} />{s}</p>)}
        <p className="text-sm lt-ink-2 pt-2">{t.support} : {config.support_contact || "—"}</p>
      </div>
    </>
  );
}

function ActivityPage({ t, orgId, readonly }: Ctx) {
  const { items } = useList<ActivityItem>("list_activity", "events", orgId, readonly, t);
  return (
    <>
      <H title={t.nav.activity} />
      {!items ? <Skeletons /> : items.length === 0 ? <EmptyState icon={<Activity className="w-6 h-6" />} text={t.empty.activity} /> : (
        <ol className="lt-card p-6 space-y-4">
          {items.map((a) => (
            <li key={a.id} className="flex gap-3"><span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: "hsl(var(--lt-cyan))" }} />
              <div><p className="text-sm">{a.message}</p><time className="lt-ink-2 text-xs" dateTime={a.at}>{new Date(a.at).toLocaleString()}</time></div></li>
          ))}
        </ol>
      )}
    </>
  );
}
