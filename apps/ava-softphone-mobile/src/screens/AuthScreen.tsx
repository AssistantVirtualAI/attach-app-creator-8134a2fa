import { BACKEND_URL, BACKEND_ANON_KEY } from '../lib/backendOrigin';
import React, { useEffect, useState } from 'react';
import type { Creds } from '../lib/creds';
import { txStatic as tx } from '../lib/i18n';
import { bootstrapLemtelMobileSession, LemtelSessionBootstrapError, type LemtelSessionBootstrap } from '../lib/lemtelSessionBootstrap';

type Screen = 'login' | 'forgot' | 'first-password';
type ForgotStep = 'form' | 'confirm' | 'sent';
type Accent = 'gold-cyan' | 'cyan-gold';
type PendingFirstPassword = {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  email: string;
  organizationId?: string;
};

const ACCENT_KEY = 'lemtel-auth-accent';
const loadAccent = (): Accent => {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v === 'cyan-gold' ? 'cyan-gold' : 'gold-cyan';
  } catch { return 'gold-cyan'; }
};
const saveAccent = (a: Accent) => { try { localStorage.setItem(ACCENT_KEY, a); } catch {} };
const accentGradient = (a: Accent) =>
  a === 'cyan-gold'
    ? 'linear-gradient(135deg, #0BB5D6 0%, #FFD700 100%)'
    : 'linear-gradient(135deg, #FFD700 0%, #0BB5D6 100%)';

// Desktop-parity palette
const C = {
  bg: '#0A1429',
  bgCard: 'rgba(16,26,48,0.78)',
  border: 'rgba(255,255,255,0.08)',
  text: '#E8EEFB',
  textIce: '#F4F8FF',
  textSub: 'rgba(232,238,251,0.62)',
  textDim: 'rgba(232,238,251,0.42)',
  gold: '#FFD700',
  cyan: '#0BB5D6',
  green: '#22C55E',
  red: '#EF4444',
};

const SUPABASE_URL = BACKEND_URL;
const SUPABASE_ANON = BACKEND_ANON_KEY;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

type AuthStep = 'network' | 'edge-function' | 'supabase-auth' | 'token' | 'validation';
type AuthFailure = { step: AuthStep; code: string; message: string; detail?: string };

class AuthError extends Error {
  step: AuthStep; code: string; detail?: string;
  constructor(f: AuthFailure) { super(f.message); this.step = f.step; this.code = f.code; this.detail = f.detail; }
}

type CompletedSession = Pick<PendingFirstPassword, 'accessToken' | 'refreshToken'> & { bootstrap: LemtelSessionBootstrap };

async function loadAuthoritativeSession(accessToken: string, userId: string): Promise<LemtelSessionBootstrap> {
  try {
    return await bootstrapLemtelMobileSession(accessToken, userId);
  } catch (cause) {
    if (cause instanceof LemtelSessionBootstrapError) {
      throw new AuthError({ step: 'edge-function', code: cause.code, message: cause.code, detail: `bootstrap_http_${cause.status}` });
    }
    throw new AuthError({ step: 'edge-function', code: 'bootstrap_failed', message: 'bootstrap_failed' });
  }
}

function authenticatedCreds(pending: PendingFirstPassword, session: Pick<PendingFirstPassword, 'accessToken' | 'refreshToken'>, bootstrap: LemtelSessionBootstrap): Creds {
  return {
    portalUrl: BACKEND_URL,
    backendOrigin: BACKEND_URL,
    email: bootstrap.email,
    extension: '',
    userId: bootstrap.userId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    organizationId: bootstrap.organizationId,
    organizationName: bootstrap.organizationName,
    displayName: bootstrap.displayName,
  };
}

const mapAuthError = (raw: string): string => {
  const m = (raw || '').toLowerCase();
  if (m.includes('invalid_credentials') || m.includes('invalid login')) return tx('Adresse e-mail ou mot de passe incorrect.', 'Incorrect email or password.');
  if (m.includes('first_password_change_required')) return tx('Choisissez votre mot de passe personnel pour continuer.', 'Choose your personal password to continue.');
  if (m.includes('lemtel_account_not_active')) return tx('Ce compte Lemtel n’est pas encore activé. Communiquez avec votre administrateur.', 'This Lemtel account is not active yet. Contact your administrator.');
  if (m.includes('bootstrap_invalid_response')) return tx('Les informations sécurisées du compte sont incomplètes. Réessayez dans un instant.', 'The secure account information is incomplete. Please try again shortly.');
  if (m.includes('bootstrap_service_unavailable') || m.includes('password_update_failed') || m.includes('server_not_configured')) return tx('Le service sécurisé de mot de passe est temporairement indisponible. Réessayez dans un instant.', 'The secure password service is temporarily unavailable. Please try again shortly.');
  if (m.includes('bootstrap_network_error')) return tx('Erreur réseau — vérifiez votre connexion puis réessayez.', 'Network error — check your connection and try again.');
  if (m.includes('new_session_failed')) return tx('Votre mot de passe a été mis à jour. Reconnectez-vous avec votre nouveau mot de passe.', 'Your password was updated. Sign in again with your new password.');
  if (m.includes('rate') && m.includes('limit')) return tx('Trop de tentatives. Veuillez patienter avant de réessayer.', 'Too many attempts. Please wait before trying again.');
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('load failed')) return tx('Erreur réseau — vérifiez votre connexion.', 'Network error — check your connection.');
  if (m.includes('session') || m.includes('jwt')) return tx('Votre session a expiré. Veuillez vous reconnecter.', 'Your session has expired. Please sign in again.');
  return raw || tx("Une erreur est survenue. Veuillez réessayer.", 'An error occurred. Please try again.');
};

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (c: Creds) => void }) {
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingFirstPassword, setPendingFirstPassword] = useState<PendingFirstPassword | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [accent, setAccent] = useState<Accent>(loadAccent);

  // Persist + cascade accent gradient as a CSS variable.
  useEffect(() => {
    saveAccent(accent);
    document.documentElement.style.setProperty('--auth-accent', accentGradient(accent));
  }, [accent]);

  if (screen === 'forgot') {
    return <ForgotPasswordScreen initialEmail={email} accent={accent} onBack={() => setScreen('login')} />;
  }
  if (screen === 'first-password' && pendingFirstPassword) {
    return <FirstPasswordChangeScreen
      accent={accent}
      pending={pendingFirstPassword}
      onCompleted={(renewed) => {
        onAuthenticated(authenticatedCreds(pendingFirstPassword, renewed, renewed.bootstrap));
      }}
    />;
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.email = 'Email is required.';
    else if (!isEmail(email)) errs.email = 'Enter a valid email address.';
    if (!password) errs.password = 'Password is required.';
    else if (password.length < 6) errs.password = 'Password must be at least 6 characters.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitEmail = async () => {
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch (e: any) {
      throw new AuthError({ step: 'network', code: 'fetch_failed', message: 'Cannot reach Supabase Auth', detail: e?.message || String(e) });
    }
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      throw new AuthError({
        step: 'supabase-auth',
        code: data?.error_code || data?.error || `http_${res.status}`,
        message: data?.error_description || data?.msg || 'Sign-in rejected by Supabase Auth',
        detail: JSON.stringify(data).slice(0, 300),
      });
    }
    if (!data?.access_token) {
      throw new AuthError({ step: 'token', code: 'no_token', message: 'Auth succeeded but no access_token returned' });
    }
    const pending: PendingFirstPassword = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user.id,
      email: data?.user?.email || email.trim(),
    };
    if (data?.user?.app_metadata?.lemtel_onboarding_required === true) {
      setPendingFirstPassword(pending);
      setScreen('first-password');
      return;
    }
    const bootstrap = await loadAuthoritativeSession(pending.accessToken, pending.userId);
    onAuthenticated(authenticatedCreds(pending, pending, bootstrap));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setFailure(null);
    if (!validate()) { setFailure({ step: 'validation', code: 'invalid_input', message: tx('Veuillez corriger les champs en évidence.', 'Please correct the highlighted fields.') }); return; }
    setBusy(true);
    try {
      await submitEmail();
    } catch (e: any) {
      if (e instanceof AuthError) {
        setFailure({ step: e.step, code: e.code, message: e.message, detail: e.detail });
        setError(mapAuthError(e.code + ' ' + e.message));
      } else {
        setFailure({ step: 'network', code: 'unknown', message: e?.message || tx('Erreur inconnue', 'Unknown error') });
        setError(mapAuthError(e?.message));
      }
      // eslint-disable-next-line no-console
      console.error('[AuthScreen] sign-in failed', { step: (e as any)?.step, code: (e as any)?.code, message: e?.message, detail: (e as any)?.detail });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !!email && !!password;

  return (
    <div style={wrap}>
      <AccentSwitch accent={accent} onChange={setAccent} />
      <GoldGlow />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', position: 'relative', zIndex: 1 }}>
        <Brand />

        <div style={cardStyle}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label={tx('Adresse e-mail', 'Email address')} value={email} onChange={(v) => { setEmail(v); setFieldErrors((f) => ({ ...f, email: '' })); }} type="email" placeholder={tx('vous@entreprise.com', 'you@company.com')} autoFocus error={fieldErrors.email} />
            <Field label={tx('Mot de passe', 'Password')} value={password} onChange={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: '' })); }} type="password" placeholder="••••••••" error={fieldErrors.password} />

            {error && <ErrorBanner failure={failure}>{error}</ErrorBanner>}

            <button
              type="submit"
              disabled={busy || !canSubmit}
              className="lemtel-btn-primary"
              style={{ marginTop: 6, height: 50, borderRadius: 14, fontSize: 14, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {busy && <Spinner />}
              {busy ? tx('Connexion…', 'Signing in…') : tx('Se connecter', 'Sign in')}
            </button>

            <button
              type="button"
              onClick={() => setScreen('forgot')}
              style={ghostLink}
            >
              {tx('Mot de passe oublié ?', 'Forgot password?')}
            </button>

            <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, textAlign: 'center', marginTop: 2 }}>
              {tx("Connectez-vous seulement avec l’adresse e-mail et le mot de passe Lemtel reçus. Vos paramètres de téléphonie sont chargés de façon sécurisée après connexion.", 'Sign in only with the Lemtel email address and password you received. Your telephony settings load securely after sign-in.')}
            </div>
          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
}

/* ====== Mandatory first-password screen ====== */
function FirstPasswordChangeScreen({ accent, pending, onCompleted }: { accent: Accent; pending: PendingFirstPassword; onCompleted: (session: CompletedSession) => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const valid = newPassword.length >= 12 && /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /\d/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword) && newPassword === confirmPassword;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null); setFailure(null);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/lemtel-complete-first-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${pending.accessToken}` },
        body: JSON.stringify({ newPassword }),
      });
      const body = await response.json().catch(() => ({}));
      // A previous tap can complete the server-side update before the client
      // receives a response. Recover the specific post-completion state rather
      // than showing a generic Edge Function error.
      const alreadyCompleted = response.status === 409 && body?.error === 'first_password_change_not_required';
      if (!alreadyCompleted && (!response.ok || body?.ok !== true)) {
        const code = response.status === 401 ? 'session_expired'
          : response.status === 403 ? 'lemtel_account_not_active'
            : response.status >= 500 ? 'bootstrap_service_unavailable'
              : typeof body?.error === 'string' ? body.error : 'password_change_failed';
        throw new AuthError({ step: 'edge-function', code, message: code, detail: `password_change_http_${response.status}` });
      }
      // The server-side password update can revoke a temporary refresh token.
      // Obtain a fresh post-onboarding session using the password just chosen.
      const renewal = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: JSON.stringify({ email: pending.email, password: newPassword }),
      });
      const renewed = await renewal.json().catch(() => ({}));
      if (!renewal.ok || !renewed?.access_token) throw new AuthError({ step: 'token', code: 'new_session_failed', message: 'new_session_failed' });
      const bootstrap = await loadAuthoritativeSession(renewed.access_token, pending.userId);
      onCompleted({ accessToken: renewed.access_token, refreshToken: renewed.refresh_token, bootstrap });
    } catch (cause: any) {
      const nextFailure = cause instanceof AuthError
        ? { step: cause.step, code: cause.code, message: cause.message, detail: cause.detail }
        : { step: 'edge-function' as const, code: 'password_change_failed', message: 'password_change_failed' };
      setFailure(nextFailure);
      setError(mapAuthError(nextFailure.code));
    } finally { setBusy(false); }
  };
  return (
    <div style={wrap}>
      <AccentSwitch accent={accent} readOnly />
      <GoldGlow />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', position: 'relative', zIndex: 1 }}>
        <Brand />
        <div style={cardStyle}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h2 style={headingStyle}>{tx('Choisissez votre mot de passe', 'Choose your password')}</h2>
              <p style={subheadingStyle}>{tx('Votre mot de passe temporaire a été vérifié. Créez maintenant un mot de passe personnel pour votre compte Lemtel.', 'Your temporary password was verified. Create a personal password for your Lemtel account now.')}</p>
            </div>
            <Field label={tx('Nouveau mot de passe', 'New password')} type="password" value={newPassword} onChange={setNewPassword} placeholder="••••••••••••" autoFocus />
            <Field label={tx('Confirmer le mot de passe', 'Confirm password')} type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••••••" />
            <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.45 }}>{tx('Au moins 12 caractères avec une majuscule, une minuscule, un chiffre et un symbole.', 'At least 12 characters with uppercase, lowercase, number, and symbol.')}</div>
            {error && <ErrorBanner failure={failure}>{error}</ErrorBanner>}
            <button type="submit" disabled={!valid || busy} className="lemtel-btn-primary" style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? tx('Mise à jour…', 'Updating…') : tx('Continuer vers Lemtel', 'Continue to Lemtel')}
            </button>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  );
}

/* ====== Forgot password screen ====== */
// The server independently enforces the authoritative recovery throttle. The
// local timer only prevents accidental repeated taps while a delivery is pending.
const RESEND_COOLDOWN_SECONDS = 900;

function ForgotPasswordScreen({ initialEmail, accent, onBack }: { initialEmail: string; accent: Accent; onBack: () => void }) {
  const [step, setStep] = useState<ForgotStep>('form');
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string>('');
  const [cooldown, setCooldown] = useState(0);
  const [resentInfo, setResentInfo] = useState<string | null>(null);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const goConfirm = () => {
    setError(null);
    if (!email.trim()) { setFieldErr(tx("L'adresse e-mail est requise.", 'Email address is required.')); return; }
    if (!isEmail(email)) { setFieldErr(tx('Saisissez une adresse e-mail valide.', 'Enter a valid email address.')); return; }
    setFieldErr('');
    setStep('confirm');
  };

  const sendReset = async (opts?: { resend?: boolean }) => {
    if (busy || cooldown > 0) return; // multi-click guard
    setBusy(true); setError(null); setResentInfo(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/lemtel-password-reset-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON,
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        let detail: any = null; try { detail = await res.json(); } catch {}
        throw new Error(detail?.msg || detail?.error || `HTTP ${res.status}`);
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (opts?.resend) setResentInfo(tx('E-mail de mot de passe temporaire renvoyé.', 'Temporary-password email resent.'));
      setStep('sent');
    } catch (e: any) {
      setError(mapAuthError(e?.message));
      if (!opts?.resend) setStep('form');
    } finally { setBusy(false); }
  };

  return (
    <div style={wrap}>
      <AccentSwitch accent={accent} readOnly />
      <GoldGlow />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', position: 'relative', zIndex: 1 }}>
        <Brand />
        <div style={cardStyle}>
          {step === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <h2 style={headingStyle}>{tx('Réinitialiser le mot de passe', 'Reset password')}</h2>
                <p style={subheadingStyle}>{tx("Saisissez l'adresse e-mail de votre compte. Nous vous enverrons un mot de passe temporaire pour vous reconnecter, puis vous devrez créer votre mot de passe personnel.", 'Enter your account email. We will send a temporary password so you can sign in, then you will create your personal password.')}</p>
              </div>
              <Field
                label={tx('Adresse e-mail', 'Email address')}
                value={email}
                onChange={(v) => { setEmail(v); setFieldErr(''); }}
                type="email"
                placeholder={tx('vous@entreprise.com', 'you@company.com')}
                autoFocus
                error={fieldErr}
              />
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <button
                type="button"
                onClick={goConfirm}
                disabled={!email}
                className="lemtel-btn-primary"
                style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}
              >
                {tx('Continuer', 'Continue')}
              </button>
              <button type="button" onClick={onBack} style={ghostBtn}>{tx('Retour à la connexion', 'Back to sign in')}</button>
            </div>
          )}

          {step === 'confirm' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <h2 style={headingStyle}>{tx('Envoyer un mot de passe temporaire ?', 'Send a temporary password?')}</h2>
                <p style={subheadingStyle}>{tx('Nous enverrons un mot de passe temporaire à :', 'We\u2019ll send a temporary password to:')}</p>
                <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: C.textIce, fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{email}</div>
              </div>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <button
                type="button"
                onClick={() => sendReset()}
                disabled={busy}
                className="lemtel-btn-primary"
                style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {busy && <Spinner />}
                {busy ? tx('Envoi…', 'Sending…') : tx('Envoyer le mot de passe', 'Send temporary password')}
              </button>
              <button type="button" onClick={() => setStep('form')} style={ghostBtn} disabled={busy}>{tx('Annuler', 'Cancel')}</button>
            </div>
          )}

          {step === 'sent' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', margin: '4px auto 0',
                background: 'rgba(34,197,94,0.14)', border: `1px solid rgba(34,197,94,0.35)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: C.green, fontSize: 26, fontWeight: 800,
              }}>✓</div>
              <h2 style={{ ...headingStyle, textAlign: 'center' }}>{tx('Vérifiez votre boîte de réception', 'Check your inbox')}</h2>
              <p style={{ ...subheadingStyle, textAlign: 'center' }}>
                {tx('Si un compte Lemtel actif existe pour', 'If an active Lemtel account exists for')} <strong style={{ color: C.textIce }}>{email}</strong>{tx(', vous recevrez sous peu un mot de passe temporaire. Utilisez-le seulement dans l’application Lemtel, puis choisissez immédiatement votre mot de passe personnel.', ', you will receive a temporary password shortly. Use it only in the Lemtel app, then choose your personal password immediately.')}
              </p>
              {resentInfo && (
                <div style={{
                  fontSize: 12, color: C.green,
                  padding: '8px 12px', borderRadius: 10,
                  background: 'rgba(34,197,94,0.10)',
                  border: '1px solid rgba(34,197,94,0.25)',
                }}>{resentInfo}</div>
              )}
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <button
                type="button"
                onClick={() => sendReset({ resend: true })}
                disabled={busy || cooldown > 0}
                style={{
                  height: 44, borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,0.04)',
                  color: cooldown > 0 ? C.textDim : C.textIce,
                  fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
                  cursor: (busy || cooldown > 0) ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: (busy || cooldown > 0) ? 0.7 : 1,
                  transition: 'opacity .15s ease',
                }}
              >
                {busy && <Spinner />}
                {busy
                  ? tx('Envoi…', 'Sending…')
                  : cooldown > 0
                    ? tx(`Renvoyer dans ${Math.ceil(cooldown / 60)} min`, `Resend in ${Math.ceil(cooldown / 60)} min`)
                    : tx("Renvoyer le mot de passe temporaire", 'Resend temporary password')}
              </button>
              <button type="button" onClick={onBack} className="lemtel-btn-primary" style={{ height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>
                {tx('Retour à la connexion', 'Back to sign in')}
              </button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}

/* ====== Reusable parts ====== */
function GoldGlow() {
  return (
    <div style={{
      position: 'absolute', top: '10%', left: '50%',
      width: 420, height: 420, borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(255,215,0,0.22) 0%, rgba(255,215,0,0.05) 40%, transparent 70%)',
      filter: 'blur(36px)', animation: 'authGlow 6s ease-in-out infinite',
      pointerEvents: 'none', transform: 'translateX(-50%)',
    }} />
  );
}

function Brand() {
  const [tapCount, setTapCount] = useState(0);
  const [debugLogs, setDebugLogs] = useState<string>('');

  const handleLogoTap = async () => {
    const newCount = tapCount + 1;
    if (newCount >= 5) {
      setTapCount(0);
      try {
        const { getPermissionLogs } = await import('../lib/requestPermissionsAfterLogin');
        const logs = await getPermissionLogs();
        setDebugLogs(logs || 'No logs found');
      } catch (e) {
        setDebugLogs('Error loading logs: ' + String(e));
      }
    } else {
      setTapCount(newCount);
      window.setTimeout(() => setTapCount((c) => (c === newCount ? 0 : c)), 1500);
    }
  };

  const clearLogs = async () => {
    try {
      const { clearPermissionLogs } = await import('../lib/requestPermissionsAfterLogin');
      await clearPermissionLogs();
      setDebugLogs('Cleared.');
    } catch {}
  };

  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={logoStyle} onClick={handleLogoTap}>
        <img src="/lemtel-icon.png" alt="Lemtel" width={72} height={72} style={{ display: 'block', borderRadius: 16 }} />
      </div>
      <div style={{ marginTop: 14, fontSize: 22, fontWeight: 800, color: C.textIce, letterSpacing: 0.2 }}>Lemtel</div>
      <div style={{ marginTop: 4, fontSize: 11, color: C.textSub, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 600 }}>{tx("Téléphonie d'entreprise IA", 'AI business telephony')}</div>
      {debugLogs ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setDebugLogs('')} style={{ padding: '8px 14px', borderRadius: 8, background: '#FFD700', color: '#0b1530', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Close</button>
            <button type="button" onClick={clearLogs} style={{ padding: '8px 14px', borderRadius: 8, background: '#EF4444', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Clear</button>
            <div style={{ color: '#FFD700', fontSize: 13, alignSelf: 'center', fontWeight: 700 }}>Permission Logs</div>
          </div>
          <pre style={{ flex: 1, overflow: 'auto', background: '#0A1429', color: '#E8EEFB', padding: 12, borderRadius: 8, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, textAlign: 'left' }}>{debugLogs}</pre>
        </div>
      ) : null}
    </div>
  );
}

function Footer() {
  return (
    <div style={{
      padding: '14px 16px calc(20px + var(--safe-bottom))', textAlign: 'center',
      fontSize: 11, color: C.textDim, letterSpacing: 0.4,
      position: 'relative', zIndex: 1,
    }}>
      <span style={{ color: C.gold, fontWeight: 600 }}>{tx('Lemtel Communications', 'Lemtel Communications')}</span>
    </div>
  );
}

/* Accent (theme) switch — persisted in localStorage and applied via CSS var. */
function AccentSwitch({ accent, onChange, readOnly }: { accent: Accent; onChange?: (a: Accent) => void; readOnly?: boolean }) {
  const opts: { id: Accent; label: string }[] = [
    { id: 'gold-cyan', label: 'Gold → Cyan' },
    { id: 'cyan-gold', label: 'Cyan → Gold' },
  ];
  return (
    <div style={{
      position: 'absolute', top: 'calc(8px + var(--safe-top))', right: 10, zIndex: 2,
      display: 'flex', gap: 4, padding: 3, borderRadius: 999,
      background: 'rgba(16,26,48,0.65)', border: `1px solid ${C.border}`,
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    }}>
      {opts.map((o) => {
        const active = accent === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(o.id)}
            aria-pressed={active}
            title={tx('Thème : ', 'Theme: ') + o.label}
            style={{
              border: 'none', cursor: readOnly ? 'default' : 'pointer',
              padding: '5px 10px', borderRadius: 999,
              fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
              background: active ? accentGradient(o.id) : 'transparent',
              color: active ? '#0b1530' : C.textSub,
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {o.id === 'gold-cyan' ? 'G→C' : 'C→G'}
          </button>
        );
      })}
    </div>
  );
}

function ErrorBanner({ children, failure }: { children: React.ReactNode; failure?: AuthFailure | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" style={{
      fontSize: 12, color: C.red,
      padding: '10px 14px', borderRadius: 10,
      background: 'rgba(239,68,68,0.10)',
      border: '1px solid rgba(239,68,68,0.22)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div>{children}</div>
      {failure && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={chipStyle('step')}>{tx('étape', 'step')} : {failure.step}</span>
          <span style={chipStyle('code')}>{tx('code', 'code')} : {failure.code}</span>
          {failure.detail && (
            <button type="button" onClick={() => setOpen((o) => !o)}
              style={{ ...chipStyle('toggle'), cursor: 'pointer' }}>
              {open ? tx('masquer les détails', 'hide details') : tx('détails', 'details')}
            </button>
          )}
        </div>
      )}
      {open && failure?.detail && (
        <pre style={{
          margin: 0, padding: 8, borderRadius: 8,
          background: 'rgba(0,0,0,0.35)', color: '#FCA5A5',
          fontSize: 10.5, lineHeight: 1.4, maxHeight: 140, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{failure.detail}</pre>
      )}
    </div>
  );
}

function chipStyle(_kind: 'step' | 'code' | 'toggle'): React.CSSProperties {
  return {
    fontSize: 10, fontFamily: 'Fira Code, monospace',
    padding: '2px 8px', borderRadius: 999,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: C.textIce,
  };
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid rgba(11,21,48,0.25)', borderTopColor: '#0b1530',
        animation: 'spin 0.7s linear infinite', display: 'inline-block',
      }}
    />
  );
}

function Field({ label, value, onChange, type = 'text', autoFocus, placeholder, error }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; autoFocus?: boolean; placeholder?: string; error?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10, color: C.textSub, textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 700 }}>{label}</span>
      <input
        className="lemtel-input"
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={error ? { borderColor: 'rgba(239,68,68,0.55)' } : undefined}
      />
      {error && <span style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{error}</span>}
    </label>
  );
}

const wrap: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', minHeight: '100vh',
  background: `radial-gradient(900px 600px at 50% -10%, rgba(11,181,214,0.10), transparent 60%), ${C.bg}`,
  color: C.text,
  paddingTop: 'var(--safe-top)',
  position: 'relative', overflow: 'hidden',
};

const logoStyle: React.CSSProperties = {
  width: 84, height: 84, borderRadius: 20, margin: '0 auto',
  background: 'linear-gradient(135deg, rgba(255,215,0,0.18), rgba(11,181,214,0.18))',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 24px 60px -18px rgba(255,215,0,0.40), inset 0 1px 0 rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,215,0,0.20)',
  padding: 6,
};

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 360,
  background: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: 22, padding: 22,
  boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  animation: 'fadeIn .4s ease-out',
};

const ghostBtn: React.CSSProperties = {
  marginTop: 2, height: 38, borderRadius: 12,
  border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textSub,
  fontSize: 12, fontWeight: 600, letterSpacing: 0.4, cursor: 'pointer',
};

const ghostLink: React.CSSProperties = {
  height: 30, border: 'none', background: 'transparent',
  color: C.cyan, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  textDecoration: 'underline', textUnderlineOffset: 3,
};

const headingStyle: React.CSSProperties = {
  margin: 0, fontSize: 18, fontWeight: 800, color: C.textIce, letterSpacing: 0.2,
};

const subheadingStyle: React.CSSProperties = {
  margin: '6px 0 0', fontSize: 12.5, color: C.textSub, lineHeight: 1.5,
};
