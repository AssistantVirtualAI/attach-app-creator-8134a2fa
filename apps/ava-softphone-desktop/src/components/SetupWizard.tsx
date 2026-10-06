import React, { useState } from 'react';
import { theme } from '../lib/theme';
import { setAuthToken } from '../lib/avaApi';
import { supabase } from '../lib/supabaseClient';
import { BACKEND_URL } from '../lib/backendOrigin';
import LemtelLogo from './LemtelLogo';
import BrandTagline from './BrandTagline';

type Creds = {
  portalUrl: string;
  backendOrigin?: string;
  email: string;
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  organizationId?: string;
};

type PendingSession = { userId: string; email: string; accessToken?: string; refreshToken?: string };

const passwordIsStrong = (value: string) => value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);

/**
 * The only credential entrypoint for a Lemtel build is email + password.
 * Extension, SIP domain and telephony parameters are server-authoritative and
 * intentionally unavailable at sign-in.
 */
export default function SetupWizard({ onComplete }: { onComplete: (creds: Creds) => void }) {
  const { colors } = theme;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<PendingSession | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const finalize = async (session: PendingSession) => {
    const { data: bootstrap, error: bootstrapError } = await supabase.functions.invoke('lemtel-session-bootstrap');
    const first = (bootstrap as any)?.organizations?.[0];
    if (bootstrapError || (bootstrap as any)?.error || !first?.organizationId) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error((bootstrap as any)?.error || bootstrapError?.message || 'Lemtel account bootstrap failed');
    }
    const credentials: Creds = {
      portalUrl: BACKEND_URL,
      backendOrigin: BACKEND_URL,
      email: session.email,
      extension: '',
      displayName: (bootstrap as any)?.user?.displayName || session.email.split('@')[0],
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      organizationId: first.organizationId,
    };
    if (session.accessToken) setAuthToken(session.accessToken);
    await window.electronAPI?.saveCredentials?.(credentials);
    onComplete(credentials);
  };

  const handleEmailConnect = async () => {
    setLoading(true); setError('');
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !authData.user || !authData.session) throw new Error(authError?.message || 'Login failed');
      const session: PendingSession = {
        userId: authData.user.id,
        email: authData.user.email || email.trim(),
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
      };
      if (authData.user.app_metadata?.lemtel_onboarding_required === true) {
        setPending(session);
        return;
      }
      await finalize(session);
    } catch (cause: any) {
      setError(cause?.message || 'Connection error');
    } finally { setLoading(false); }
  };

  const completeFirstPassword = async () => {
    if (!pending || !passwordIsStrong(newPassword) || newPassword !== confirmPassword) return;
    setLoading(true); setError('');
    try {
      const { data, error: completionError } = await supabase.functions.invoke('lemtel-complete-first-password', { body: { newPassword } });
      if (completionError || (data as any)?.ok !== true) throw new Error((data as any)?.error || completionError?.message || 'Password update failed');
      await finalize(pending);
    } catch (cause: any) {
      setError(cause?.message || 'Password update failed');
    } finally { setLoading(false); }
  };

  const firstPasswordScreen = Boolean(pending);
  const valid = !!email && !!password;
  const validFirstPassword = passwordIsStrong(newPassword) && newPassword === confirmPassword;

  return (
    <div style={{ minHeight: '100%', background: colors.bg, display: 'flex', flexDirection: 'column', color: colors.text, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '14%', left: '50%', transform: 'translateX(-50%)', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,215,0,0.18) 0%, rgba(255,215,0,0.04) 40%, transparent 70%)', filter: 'blur(40px)', animation: 'authGlow 6s ease-in-out infinite', pointerEvents: 'none' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <LemtelLogo size="lg" glow shape="square" />
          <div style={{ marginTop: 14, fontSize: 22, fontWeight: 800, color: colors.textIce, letterSpacing: 0.2 }}>Lemtel</div>
          <BrandTagline size="sm" />
        </div>
        <div style={{ width: '100%', maxWidth: 440, background: colors.bgCard, border: `1px solid ${colors.borderStrong}`, borderRadius: 28, padding: 34, boxShadow: '0 26px 64px rgba(10,20,52,0.22)', animation: 'fadeIn .4s ease-out' }}>
          {firstPasswordScreen ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 21, color: colors.textIce }}>Choose your password</h2>
                <p style={{ color: colors.textSub, fontSize: 13, lineHeight: 1.55 }}>Your temporary password is verified. Create a personal password to continue to Lemtel.</p>
              </div>
              <Field label="New password" value={newPassword} onChange={setNewPassword} type="password" placeholder="••••••••••••" autoFocus />
              <Field label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} type="password" placeholder="••••••••••••" onEnter={completeFirstPassword} />
              <div style={{ color: colors.textDim, fontSize: 11, lineHeight: 1.45 }}>At least 12 characters with uppercase, lowercase, number, and symbol.</div>
              {error && <ErrorBox message={error} />}
              <button className="lemtel-btn-primary" onClick={completeFirstPassword} disabled={loading || !validFirstPassword} style={{ marginTop: 8, height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>{loading ? 'Updating…' : 'Continue to Lemtel'}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 21, color: colors.textIce }}>Sign in to Lemtel</h2>
                <p style={{ color: colors.textSub, fontSize: 13, lineHeight: 1.55 }}>Use the email address and password from your Lemtel welcome email. Telephony settings are loaded securely after sign-in.</p>
              </div>
              <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@company.com" autoFocus />
              <Field label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" onEnter={handleEmailConnect} />
              {error && <ErrorBox message={error} />}
              <button className="lemtel-btn-primary" onClick={handleEmailConnect} disabled={loading || !valid} style={{ marginTop: 8, height: 50, borderRadius: 14, fontSize: 14, cursor: 'pointer' }}>{loading ? 'Connecting…' : 'Sign in'}</button>
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '18px 16px 22px', textAlign: 'center', fontSize: 11, color: colors.textDim, letterSpacing: 0.45, position: 'relative', zIndex: 1 }}>
        <span style={{ color: colors.gold, fontWeight: 700 }}>L</span> Lemtel Telecom · Secure business communications
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ fontSize: 12, color: theme.colors.red, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{message}</div>;
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, onEnter }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 10, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 700 }}>{label}</span><input className="lemtel-input" type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} autoCapitalize="none" autoCorrect="off" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && onEnter) onEnter(); }} /></label>;
}
