import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import SetupWizard from './components/SetupWizard';
import UpdateBanner from './components/UpdateBanner';
import SoftphonePane from './components/SoftphonePane';
import SettingsPage from './components/SettingsPage';
import BrightnessOverlay from './components/BrightnessOverlay';
import ResponsiveLab from './components/ResponsiveLab';
import DialerBaselineCheck from './components/DialerBaselineCheck';
import { useTheme } from './lib/theme';
import { useContrast } from './hooks/useContrast';
import { supabase } from './lib/supabaseClient';
import { setAuthToken } from './lib/avaApi';
import { audit } from './lib/audit';
import { sipProvider } from './lib/sip/jssipProvider';
import { useSoftphone } from './hooks/useSoftphone';
import { useTenant } from './hooks/useTenant';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { useExtensionDataSync } from './hooks/useExtensionDataSync';

const LEMTEL_ORG_ID = '71755d33-ed64-4ad5-a828-61c9d2029eb7';

async function resolveCurrentOrganizationId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return LEMTEL_ORG_ID;
  const { data: softphoneUser } = await supabase
    .from('pbx_softphone_users')
    .select('organization_id')
    .eq('portal_user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (softphoneUser?.organization_id) return softphoneUser.organization_id;
  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  return member?.organization_id || LEMTEL_ORG_ID;
}

async function triggerCdrSync() {
  try {
    const organizationId = await resolveCurrentOrganizationId();
    const { data } = await supabase.functions.invoke('fusionpbx-proxy', {
      body: { action: 'sync-cdrs', organization_id: organizationId, limit: 500, page_size: 500, max_pages: 2, from_beginning: true },
    });
    console.log('CDR sync triggered:', data);
  } catch (err) {
    console.warn('CDR sync failed:', err);
  }
}

const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const IS_LAB = qs?.get('lab') === 'responsive';
const IS_DIALER_CHECK = qs?.get('check') === 'dialer';
const IS_EMBED = qs?.get('embed') === '1';

async function clearDesktopAuthState() {
  try { await supabase.auth.signOut(); } catch { /* noop */ }
  try {
    window.localStorage.removeItem('lemtel-desktop-auth');
    window.sessionStorage.removeItem('lemtel-desktop-auth');
  } catch { /* noop */ }
  try { await window.electronAPI?.saveCredentials?.(null); } catch { /* noop */ }
  setAuthToken(null);
}

type Creds = {
  portalUrl: string;
  email: string;
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
} | null;

type ActiveCreds = Exclude<Creds, null>;

function SipKeepAlive({ creds }: { creds: ActiveCreds }) {
  const sp = useSoftphone({
    extension: creds.extension,
    displayName: creds.displayName,
    sipDomain: creds.sipDomain,
    wssUrl: creds.wssUrl,
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  });

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lemtel:sip-status', { detail: sp.snap.status }));
  }, [sp.snap.status]);

  return null;
}

function DesktopBackgroundSync({ fallbackExtension }: { fallbackExtension?: string | null }) {
  const { orgId, extension } = useTenant();
  useRealtimeSync(orgId);
  useExtensionDataSync(orgId, extension || fallbackExtension, { intervalMs: 60_000, firstRunDeepLimit: 2000 });
  return null;
}


export default function App() {
  // Responsive testing utility — visit ?lab=responsive to open it.
  if (IS_LAB) return <ResponsiveLab />;
  // Dialer baseline check — visit ?check=dialer to open it.
  if (IS_DIALER_CHECK) return <DialerBaselineCheck />;

  return <DesktopApp />;
}

// ── CDR sync au démarrage ──────────────────────────────────
function DesktopApp() {
  const { t } = useTheme();
  useContrast(); // applies low/med/high contrast preset on mount

  const [creds, setCreds] = useState<Creds>(null);
  const [loading, setLoading] = useState(true);
  const [mobileSettings, setMobileSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const saved = await window.electronAPI?.getCredentials?.().catch(() => null);

      // Restore session from saved tokens BEFORE checking session
      if (saved?.accessToken && saved?.refreshToken) {
        await supabase.auth.setSession({
          access_token: saved.accessToken,
          refresh_token: saved.refreshToken,
        }).catch(() => { /* token expired — fall through */ });
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

      if (!session || mismatchedSavedSession) {
        // No valid session, or Electron credentials belong to a different Supabase user → force login wizard.
        await clearDesktopAuthState();
        setCreds(null);
      } else if (saved) {
        // Refresh stored tokens in case they rotated
        setAuthToken(session.access_token);
        // Re-fetch the latest pbx_softphone_users row so extension/display name reflect current DB state
        // (saved Electron credentials may be stale, e.g. extension stored as 'N/A' from a prior login).
        let refreshed = { ...saved };
        try {
          const { data: row } = await supabase
            .from('pbx_softphone_users')
            .select('extension, display_name, sip_domain, wss_url')
            .eq('portal_user_id', session.user.id)
            .maybeSingle();
          if (row?.extension) {
            refreshed = {
              ...refreshed,
              extension: String(row.extension),
              displayName: row.display_name || refreshed.displayName,
              sipDomain: row.sip_domain || refreshed.sipDomain,
              wssUrl: row.wss_url || refreshed.wssUrl,
            };
            try { await window.electronAPI?.saveCredentials?.(refreshed); } catch { /* noop */ }
          }
        } catch { /* noop */ }
        setCreds({
          ...refreshed,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        });
        triggerCdrSync();

      } else {
        // A browser-local Supabase session without Electron credentials is stale for the packaged app.
        await clearDesktopAuthState();
        setCreds(null);
      }
      setLoading(false);
    };

    init();
    const syncTimer = setInterval(triggerCdrSync, 5 * 60 * 1000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        try { audit('softphone.signed_out'); } catch { /* noop */ }
        try { await sipProvider.stop?.(); } catch { /* noop */ }
        await window.electronAPI?.saveCredentials?.(null).catch(() => {});
        setAuthToken(null);
        setCreds(null);
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        setAuthToken(session.access_token);
        if (event === 'SIGNED_IN') {
          triggerCdrSync();
          audit('softphone.signed_in', session.user?.id, { email: session.user?.email });
        }
        setCreds((prev) => prev ? {
          ...prev,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        } : prev);
      }
    });

    window.electronAPI?.onSetStatus?.((s: any) => {
      window.dispatchEvent(new CustomEvent('lemtel:set-status', { detail: s }));
    });
    const isCallBusy = () => {
      const s = sipProvider.getSnapshot?.().callState;
      return s === 'ringing-in' || s === 'ringing-out' || s === 'active' || s === 'held';
    };
    const unsubscribeSip = sipProvider.subscribe?.((snap) => { void snap; });

    import('./lib/mediaPermissions').then(({ requestMediaPermissions }) => {
      requestMediaPermissions().catch(() => { /* noop */ });
    });

    return () => {
      cancelled = true;
      clearInterval(syncTimer);
      subscription.unsubscribe();
      try { unsubscribeSip?.(); } catch { /* noop */ }
    };
  }, []);

  const openSettingsMobile = () => {
    // Navigate to the settings view via the global nav bus so SoftphonePane
    // and the standalone SoftphonePane gear button reach the SettingsPage.
    setMobileSettings(true);
    window.dispatchEvent(new CustomEvent('lemtel:nav', { detail: 'settings' }));
  };

  const signOutDesktop = async () => {
    try { setAuthToken(null); } catch { /* noop */ }
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    try {
      window.localStorage.removeItem('lemtel-desktop-auth');
      window.sessionStorage.removeItem('lemtel-desktop-auth');
    } catch { /* noop */ }
    await window.electronAPI?.clearCredentials?.();
    window.location.reload();
  };


  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: t.bgGradient, color: t.textMuted, fontSize: 13,
      }}>
        Loading…
      </div>
    );
  }

  if (!creds) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg, position: 'relative' }}>
        <BrightnessOverlay />
        <TitleBar />
        <div style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 1 }}>
          <SetupWizard onComplete={(c: any) => { setCreds(c); triggerCdrSync(); }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg, position: 'relative' }}>
      <SipKeepAlive creds={creds} />
      <DesktopBackgroundSync fallbackExtension={creds.extension} />
      <BrightnessOverlay />
      {!IS_EMBED && <TitleBar />}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {mobileSettings ? (
          <SettingsPage creds={creds} onSignOut={signOutDesktop} onBack={() => setMobileSettings(false)} />
        ) : (
          <SoftphonePane creds={creds} onOpenSettings={openSettingsMobile} />
        )}
      </div>
      {!IS_EMBED && <UpdateBanner />}
    </div>
  );
}

