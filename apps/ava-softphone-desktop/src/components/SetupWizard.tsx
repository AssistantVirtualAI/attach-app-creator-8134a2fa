import React, { useState } from 'react';
import { theme } from '../lib/theme';
import { setAuthToken } from '../lib/avaApi';
import { supabase } from '../lib/supabaseClient';
import LemtelLogo from './LemtelLogo';

type Creds = {
  portalUrl: string;
  email: string;
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
};

type View = 'signin' | 'forgot' | 'first';
const PORTAL_URL = 'https://avastatistic.ca';

type ErrKey = 'invalid' | 'expired' | 'personalized' | 'network' | 'unavailable' | 'denied' | 'throttled' | 'mismatch' | 'generic';
const MSG: Record<ErrKey, string> = {
  invalid: 'Incorrect email or password.',
  expired: 'Request a new temporary password.',
  personalized: 'Sign in with your personal password.',
  network: 'Check your connection and try again.',
  unavailable: 'Lemtel is temporarily unavailable. Please try again shortly.',
  denied: 'App access has not been granted by Lemtel. Please contact your administrator.',
  throttled: 'Too many attempts. Please wait a moment before trying again.',
  mismatch: 'Passwords do not match.',
  generic: 'Something went wrong. Please try again.',
};
function errKey(raw: unknown, status?: number): ErrKey {
  const m = String((raw as any)?.message ?? raw ?? '').toLowerCase();
  if (m.includes('expired')) return 'expired';
  if (m.includes('already') && (m.includes('personal') || m.includes('changed'))) return 'personalized';
  if (m.includes('invalid login') || m.includes('invalid_credentials') || m.includes('invalid credentials')) return 'invalid';
  if (m.includes('rate') || m.includes('throttl') || status === 429) return 'throttled';
  if (m.includes('fetch') || m.includes('network')) return 'network';
  if ((status ?? 0) >= 500) return 'unavailable';
  return 'generic';
}
const needsPersonal = (u: any) => {
  const m = { ...(u?.app_metadata ?? {}), ...(u?.user_metadata ?? {}) };
  return m.must_change_password === true || m.temporary_password === true;
};
function strength(p: string) {
  if (p.length < 8) return 0;
  return [p.length >= 12, /[A-Z]/.test(p) && /[a-z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
}

export default function SetupWizard({ onComplete }: { onComplete: (creds: Creds) => void }) {
  const { colors } = theme;
  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pwdA, setPwdA] = useState('');
  const [pwdB, setPwdB] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cool, setCool] = useState(0);
  React.useEffect(() => { if (cool <= 0) return; const id = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(id); }, [cool]);

  const finalize = async (
    authUserId: string,
    accessToken: string | undefined,
    refreshToken: string | undefined,
    fallbackEmail: string,
    softphone: { extension?: string; display_name?: string; sip_domain?: string; wss_url?: string; organization_id?: string } | null,
  ) => {
    const credentials: Creds = {
      portalUrl: PORTAL_URL,
      email: fallbackEmail,
      extension: String(softphone?.extension ?? 'N/A'),
      displayName: softphone?.display_name || fallbackEmail.split('@')[0],
      sipDomain: softphone?.sip_domain || 'lemtel.lemtel.tel',
      wssUrl: softphone?.wss_url || 'wss://node.lemtelcloud.net:7443',
      userId: authUserId,
      accessToken,
      refreshToken,
    };
    if (accessToken) setAuthToken(accessToken);
    await window.electronAPI?.saveCredentials?.(credentials);
    onComplete(credentials);
  };

  /** Server-side bootstrap: access gate + telephony settings loaded only after sign-in. */
  const bootstrap = async (pwd: string) => {
    const { data: s } = await supabase.auth.getSession();
    const user = s.session?.user;
    if (!user) throw new Error('unavailable');
    // Existing softphone behaviour: SIP registration reuses the account password.
    try { localStorage.setItem('lemtel.sip_password', pwd); } catch { /* noop */ }
    const { data: allowed, error: gateErr } = await supabase.rpc('my_platform_access_allowed', { _platform: 'desktop' });
    if (gateErr || allowed !== true) { await supabase.auth.signOut(); setError(MSG.denied); return; }
    const { data: softphoneUser } = await supabase
      .from('pbx_softphone_users')
      .select('extension,display_name,sip_domain,wss_url,organization_id,status')
      .eq('portal_user_id', user.id)
      .maybeSingle();
    await finalize(user.id, s.session?.access_token, s.session?.refresh_token, user.email || email, softphoneUser);
  };

  const handleSignIn = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError || !data.user) { setError(MSG[errKey(authError, (authError as any)?.status)]); return; }
      if (needsPersonal(data.user)) { setView('first'); return; }
      await bootstrap(password);
    } catch (err) {
      setError(MSG[errKey(err)]);
    } finally { setLoading(false); }
  };

  const handleFirstPassword = async () => {
    if (pwdA !== pwdB) { setError(MSG.mismatch); return; }
    setLoading(true); setError('');
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password: pwdA, data: { must_change_password: false, temporary_password: false } });
      if (upErr) {
        const m = String(upErr.message ?? '').toLowerCase();
        // A previous click already applied this password → recover by signing in with it.
        if (!(m.includes('same') || m.includes('different from the old') || m.includes('already'))) { setError(MSG[errKey(upErr, (upErr as any).status)]); return; }
      }
      const { error: e2 } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pwdA });
      if (e2) { setError(MSG[errKey(e2, (e2 as any).status)]); return; }
      setPassword(''); setPwdB('');
      await bootstrap(pwdA);
      setPwdA('');
    } catch (err) {
      setError(MSG[errKey(err)]);
    } finally { setLoading(false); }
  };

  const handleForgot = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const { error: fnErr } = await supabase.functions.invoke('lemtel-password-reset-request', { body: { email: email.trim().toLowerCase() } });
      const status = (fnErr as any)?.context?.status;
      if (status === 429) { setError(MSG.throttled); setCool(60); return; }
      if (fnErr) { setError(MSG.unavailable); return; }
      setNotice('If an account exists for this email, a temporary password has just been sent.');
      setCool(60);
    } catch { setError(MSG.network); } finally { setLoading(false); }
  };

  const back = async () => { await supabase.auth.signOut().catch(() => null); setView('signin'); setError(''); setNotice(''); setPwdA(''); setPwdB(''); };
  const s = strength(pwdA);
  const tiles = [
    { h: 'One identity', p: 'One email and password on desktop, iOS and Android.' },
    { h: 'Connected', p: 'Your settings follow you after secure sign-in.' },
    { h: 'Private', p: 'Nothing technical to type. Ever.' },
  ];
  const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: colors.avaCyan, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' };

  return (
    <div className="lt-auth" style={{ minHeight: '100%', background: colors.bg, color: colors.text, display: 'flex', flexDirection: 'column' }}>
      <style>{`.lt-auth-grid{display:grid;grid-template-columns:1.1fr 1fr;flex:1}.lt-auth-story{display:flex}@media (max-width:860px){.lt-auth-grid{grid-template-columns:1fr}.lt-auth-story{display:none!important}}.lt-auth input:focus-visible,.lt-auth button:focus-visible{outline:2px solid ${colors.avaCyan};outline-offset:2px}`}</style>
      <div className="lt-auth-grid">
        <section className="lt-auth-story" style={{ flexDirection: 'column', justifyContent: 'center', gap: 28, padding: '48px 56px', background: `radial-gradient(900px 500px at 10% 10%, rgba(34,211,238,0.12), transparent 60%)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <LemtelLogo size="sm" shape="square" />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.textIce }}>Lemtel Telecom</div>
              <div style={{ fontSize: 12.5, color: colors.textSub }}>Private, intelligent communications</div>
            </div>
          </div>
          <h1 style={{ fontSize: 28, lineHeight: 1.25, fontWeight: 700, margin: 0, maxWidth: 440, color: colors.textIce }}>Your business communications, together and protected.</h1>
          <div style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
            {tiles.map((x) => (
              <div key={x.h} style={{ padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.border}` }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: colors.textIce }}>{x.h}</div>
                <div style={{ fontSize: 12.5, color: colors.textSub, marginTop: 2 }}>{x.p}</div>
              </div>
            ))}
          </div>
        </section>
        <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
          <div style={{ width: '100%', maxWidth: 400, background: colors.bgCard, border: `1px solid ${colors.border}`, borderRadius: 20, padding: 32, boxShadow: '0 25px 60px rgba(0,0,0,0.45)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {view === 'signin' && <>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.textIce }}>Sign in to Lemtel</h2>
                <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="username" placeholder="you@company.com" autoFocus />
                <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" placeholder="••••••••" onEnter={handleSignIn} />
                <button type="button" style={linkBtn} onClick={() => { setView('forgot'); setError(''); }}>Forgot password?</button>
              </>}
              {view === 'forgot' && <>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.textIce }}>Get a temporary password</h2>
                <p style={{ margin: 0, fontSize: 13, color: colors.textSub }}>Enter your email. If an account exists, we'll send you a new temporary password.</p>
                <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="username" autoFocus onEnter={handleForgot} />
              </>}
              {view === 'first' && <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.avaCyan }}>Make it yours</div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.textIce }}>Create your personal password</h2>
                <Field label="New password" value={pwdA} onChange={setPwdA} type="password" autoComplete="new-password" autoFocus />
                <div aria-live="polite">
                  <div style={{ display: 'flex', gap: 4 }}>{[0, 1, 2, 3].map((i) => <span key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i < s ? (s >= 3 ? colors.green : colors.gold) : colors.border }} />)}</div>
                  <div style={{ fontSize: 11.5, color: colors.textSub, marginTop: 4 }}>{['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'][s]} · at least 12 characters with uppercase, numbers and symbols.</div>
                </div>
                <Field label="Confirm password" value={pwdB} onChange={setPwdB} type="password" autoComplete="new-password" onEnter={handleFirstPassword} />
              </>}

              {notice && <div role="status" style={{ fontSize: 12.5, color: colors.green, padding: '10px 14px', borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>{notice}</div>}
              {error && <div role="alert" style={{ fontSize: 12.5, color: colors.red, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}

              {view === 'signin' && <button className="lemtel-btn-primary" onClick={handleSignIn} disabled={loading || !email || !password} style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>{loading ? 'Signing in…' : 'Sign in'}</button>}
              {view === 'forgot' && <>
                <button className="lemtel-btn-primary" onClick={handleForgot} disabled={loading || !email || cool > 0} style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>{cool > 0 ? `Try again in ${cool}s` : loading ? 'Sending…' : 'Send'}</button>
                <button type="button" style={{ ...linkBtn, alignSelf: 'center' }} onClick={back}>Back to sign in</button>
              </>}
              {view === 'first' && <>
                <button className="lemtel-btn-primary" onClick={handleFirstPassword} disabled={loading || s < 3 || pwdA !== pwdB} style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>{loading ? 'Saving…' : 'Continue to Lemtel'}</button>
                <button type="button" style={{ ...linkBtn, alignSelf: 'center' }} onClick={back}>Use another account</button>
              </>}
            </div>
          </div>
        </section>
      </div>
      <div style={{ padding: '14px 16px 18px', textAlign: 'center', fontSize: 11, color: colors.textDim }}>Lemtel Telecom · Private, intelligent communications</div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, autoFocus, onEnter, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoFocus?: boolean; onEnter?: () => void; autoComplete?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{
        fontSize: 10, color: theme.colors.textSub,
        textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 700,
      }}>{label}</span>
      <input
        className="lemtel-input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
      />
    </label>
  );
}
