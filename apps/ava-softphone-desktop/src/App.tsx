import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import SetupWizard from './components/SetupWizard';
import ResponsiveLab from './components/ResponsiveLab';
import DialerBaselineCheck from './components/DialerBaselineCheck';
import WorkspacePreview from './test-harness/WorkspacePreview';
import { useTheme } from './lib/theme';
import { useTranslation } from './lib/i18n';
import { useContrast } from './hooks/useContrast';
import { supabase } from './lib/supabaseClient';
import { BACKEND_STORAGE_SUFFIX, BACKEND_URL, LEGACY_BACKEND_URL } from './lib/backendOrigin';
import { setAuthToken } from './lib/avaApi';
import { audit } from './lib/audit';
import { sipProvider } from './lib/sip/jssipProvider';
import { useLemtelDesktopSessionBootstrap } from './hooks/useLemtelDesktopSessionBootstrap';

const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const IS_LAB = qs?.get('lab') === 'responsive';
const IS_DIALER_CHECK = qs?.get('check') === 'dialer';
const IS_WORKSPACE_PREVIEW = qs?.get('preview') === 'workspace';

async function clearDesktopAuthState() {
  try { await sipProvider.stop?.(); } catch { /* no active call path is expected before provisioning */ }
  try { await supabase.auth.signOut(); } catch { /* noop */ }
  try {
    window.localStorage.removeItem('lemtel-desktop-auth');
    window.sessionStorage.removeItem('lemtel-desktop-auth');
    window.localStorage.removeItem(`lemtel-desktop-auth${BACKEND_STORAGE_SUFFIX}`);
    window.sessionStorage.removeItem(`lemtel-desktop-auth${BACKEND_STORAGE_SUFFIX}`);
    // A previous Desktop build could have kept a local SIP password fallback.
    // The Lemtel bootstrap-only path never reads it and clears it on sign-out.
    window.localStorage.removeItem('lemtel.sip_password');
  } catch { /* noop */ }
  try { await window.electronAPI?.saveCredentials?.(null); } catch { /* noop */ }
  setAuthToken(null);
}

type Creds = {
  portalUrl: string;
  backendOrigin?: string;
  email: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  organizationId?: string;
} | null;

type ActiveCreds = Exclude<Creds, null>;

export default function App() {
  if (IS_LAB) return <ResponsiveLab />;
  if (IS_DIALER_CHECK) return <DialerBaselineCheck />;
  // Development-only visual review; it has no customer session or telephony.
  if (IS_WORKSPACE_PREVIEW && import.meta.env.DEV) return <WorkspacePreview />;
  return <DesktopApp />;
}

/**
 * The currently deployed Hostinger contract authenticates a Lemtel member but
 * explicitly reports telephony as not_provisioned. This component deliberately
 * does not mount any SIP, CDR, realtime, or credential-loading code until an
 * independently-authorized provisioning contract exists.
 */
function DesktopApp() {
  const { t: themeTokens } = useTheme();
  const { t } = useTranslation();
  useContrast();

  const [creds, setCreds] = useState<Creds>(null);
  const [loading, setLoading] = useState(true);
  const bootstrap = useLemtelDesktopSessionBootstrap(creds?.accessToken || null);

  const returnToSignIn = async () => {
    await clearDesktopAuthState();
    setCreds(null);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const saved = await window.electronAPI?.getCredentials?.().catch(() => null) as ActiveCreds | null;

      // Untagged Electron credentials were issued by the historical backend.
      // Never send them to a new Auth issuer, even if the user UUID is unchanged.
      if (saved && (saved.backendOrigin || LEGACY_BACKEND_URL) !== BACKEND_URL) {
        await clearDesktopAuthState();
        if (!cancelled) { setCreds(null); setLoading(false); }
        return;
      }

      if (saved?.accessToken && saved?.refreshToken) {
        await supabase.auth.setSession({
          access_token: saved.accessToken,
          refresh_token: saved.refreshToken,
        }).catch(() => { /* expired token falls through to sign-in */ });
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      const sessionEmail = session?.user?.email?.toLowerCase() || '';
      const savedEmail = saved?.email?.toLowerCase?.() || '';
      const savedUserId = saved?.userId || '';
      const sessionUserId = session?.user?.id || '';
      const mismatchedSavedSession = !!saved && !!session && (
        (!!savedUserId && savedUserId !== sessionUserId) ||
        (!!savedEmail && !!sessionEmail && savedEmail !== sessionEmail)
      );

      if (!session || mismatchedSavedSession || !saved) {
        await clearDesktopAuthState();
        setCreds(null);
      } else {
        // Preserve only the authenticated identity needed by the bootstrap gate.
        // Historic extension/WSS values are intentionally discarded.
        const restored: ActiveCreds = {
          portalUrl: BACKEND_URL,
          backendOrigin: BACKEND_URL,
          email: session.user.email || saved.email,
          displayName: saved.displayName || session.user.email?.split('@')[0],
          userId: session.user.id,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        };
        setAuthToken(session.access_token);
        try { await window.electronAPI?.saveCredentials?.(restored); } catch { /* noop */ }
        setCreds(restored);
      }
      setLoading(false);
    };

    void init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        try { audit('softphone.signed_out'); } catch { /* noop */ }
        try { await sipProvider.stop?.(); } catch { /* noop */ }
        try { await window.electronAPI?.saveCredentials?.(null); } catch { /* noop */ }
        setAuthToken(null);
        setCreds(null);
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        setAuthToken(session.access_token);
        if (event === 'SIGNED_IN') {
          try { audit('softphone.signed_in', session.user?.id, { email: session.user?.email }); } catch { /* noop */ }
        }
        setCreds((previous) => previous ? {
          ...previous,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        } : previous);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const stateScreen = (title: string, actions?: React.ReactNode, testId?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: themeTokens.bg, position: 'relative' }} data-testid={testId}>
      <TitleBar />
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
        <section style={{ width: 'min(100%, 540px)', padding: 30, borderRadius: 22, border: `1px solid ${themeTokens.border}`, background: themeTokens.surface, boxShadow: '0 24px 70px rgba(0,0,0,.22)', textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, margin: '0 auto 16px', display: 'grid', placeItems: 'center', borderRadius: 14, background: 'linear-gradient(135deg,#5d8dff,#315fcf)', color: '#fff', fontWeight: 900, fontSize: 22 }}>L</div>
          <p style={{ margin: '0 0 8px', color: themeTokens.textMuted, fontSize: 12, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>{t('workspace.desktopReadyEyebrow')}</p>
          <h1 style={{ margin: '0 0 12px', color: themeTokens.text, fontSize: 24, lineHeight: 1.18 }}>{title}</h1>
          {actions && <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>{actions}</div>}
        </section>
      </div>
    </div>
  );

  const secondaryAction = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} style={{ minHeight: 40, padding: '0 15px', borderRadius: 10, border: `1px solid ${themeTokens.border}`, background: themeTokens.surface, color: themeTokens.text, cursor: 'pointer', fontWeight: 750 }}>{label}</button>
  );

  const primaryAction = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} style={{ minHeight: 40, padding: '0 15px', border: 0, borderRadius: 10, background: 'linear-gradient(135deg,#5d8dff,#315fcf)', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>{label}</button>
  );

  if (loading) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: themeTokens.bgGradient, color: themeTokens.textMuted, fontSize: 13 }}>{t('workspace.loading')}</div>;
  }

  if (!creds) {
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#08111f', position: 'relative' }}><div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}><SetupWizard onComplete={setCreds} /></div></div>;
  }

  if (bootstrap.status === 'idle' || bootstrap.status === 'checking') {
    return stateScreen(t('workspace.checkingAccess'), undefined, 'lemtel-desktop-checking-access');
  }

  if (bootstrap.status === 'denied') {
    return stateScreen(t('workspace.sessionAccessDenied'), secondaryAction(t('workspace.returnToSignIn'), () => { void returnToSignIn(); }), 'lemtel-desktop-session-denied');
  }

  if (bootstrap.status === 'retryable_error') {
    return stateScreen(
      t('workspace.verifySessionFailed'),
      <>
        {primaryAction(t('workspace.retrySessionCheck'), () => { void bootstrap.refresh(); })}
        {secondaryAction(t('workspace.returnToSignIn'), () => { void returnToSignIn(); })}
      </>,
      'lemtel-desktop-bootstrap-retry',
    );
  }

  // This is the expected and safe response from the current server contract.
  if (bootstrap.status === 'not_provisioned') {
    return <DesktopProvisioningWorkspace email={creds.email} organizationId={bootstrap.organizationId} onRetry={() => { void bootstrap.refresh(); }} onSignOut={() => { void returnToSignIn(); }} />;
  }

  return null;
}

function DesktopProvisioningWorkspace({ email, organizationId, onRetry, onSignOut }: { email: string; organizationId: string | null; onRetry: () => void; onSignOut: () => void }) {
  const { t } = useTranslation();
  const { t: themeTokens } = useTheme();
  return (
    <div data-testid="lemtel-desktop-not-provisioned" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: themeTokens.bg, position: 'relative' }}>
      <TitleBar />
      <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, background: `radial-gradient(620px 420px at 50% 38%, rgba(74,123,241,.18), transparent 70%), ${themeTokens.bg}` }}>
        <section style={{ width: 'min(100%, 620px)', padding: 'clamp(26px,5vw,46px)', borderRadius: 24, border: `1px solid ${themeTokens.border}`, background: themeTokens.surface, boxShadow: '0 26px 80px rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
            <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 15, background: 'linear-gradient(135deg,#5d8dff,#315fcf)', color: '#fff', fontSize: 23, fontWeight: 900 }}>L</div>
            <div><p style={{ margin: 0, color: themeTokens.textMuted, fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>{t('workspace.desktopReadyEyebrow')}</p><strong style={{ color: themeTokens.text, fontSize: 15 }}>Lemtel Desktop</strong></div>
          </div>
          <h1 style={{ margin: 0, color: themeTokens.text, fontSize: 'clamp(25px,4vw,34px)', lineHeight: 1.12 }}>{t('workspace.desktopReadyTitle')}</h1>
          <p style={{ margin: '16px 0 0', color: themeTokens.textMuted, fontSize: 15, lineHeight: 1.65 }}>{t('workspace.telephonyNotProvisioned')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, padding: '14px 16px', borderRadius: 14, background: 'rgba(98,149,255,.10)', border: '1px solid rgba(98,149,255,.24)', color: themeTokens.text }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, flex: '0 0 auto', borderRadius: '50%', background: '#71e6bd', boxShadow: '0 0 0 5px rgba(113,230,189,.10)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t('workspace.callingDisabled')}</span>
          </div>
          <dl style={{ margin: '22px 0 0', padding: 0, display: 'grid', gap: 8, color: themeTokens.textMuted, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}><dt>{t('workspace.member')}</dt><dd style={{ margin: 0, color: themeTokens.text }}>{email}</dd></div>
            {organizationId && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18 }}><dt>{t('workspace.organization')}</dt><dd style={{ margin: 0, color: themeTokens.text }}>{t('workspace.verified')}</dd></div>}
          </dl>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 28 }}>
            <button type="button" onClick={onRetry} style={{ minHeight: 42, padding: '0 16px', border: 0, borderRadius: 10, background: 'linear-gradient(135deg,#5d8dff,#315fcf)', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>{t('workspace.retrySessionCheck')}</button>
            <button type="button" onClick={onSignOut} style={{ minHeight: 42, padding: '0 16px', borderRadius: 10, border: `1px solid ${themeTokens.border}`, background: 'transparent', color: themeTokens.text, cursor: 'pointer', fontWeight: 750 }}>{t('workspace.returnToSignIn')}</button>
          </div>
        </section>
      </main>
    </div>
  );
}
