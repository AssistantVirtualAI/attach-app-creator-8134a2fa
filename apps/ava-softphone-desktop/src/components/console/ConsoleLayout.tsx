import React, { useEffect, useState } from 'react';
import LeftRail, { ConsoleView } from './LeftRail';
import HomeDashboard from './HomeDashboard';
import AIPanel from './AIPanel';
import CommandPalette from './CommandPalette';
import CallsView from './CallsView';
import MessagesView from './MessagesView';
import VoicemailView from './VoicemailView';
import RecordingsView from './RecordingsView';
import ContactsView from './ContactsView';
import AIWorkspace from './AIWorkspace';
import AdminView from './AdminView';
import TelecomSettingsView from './TelecomSettingsView';
import OrgChatView from './OrgChatView';
import AdminAIChatView from './AdminAIChatView';
import ReportsView from './ReportsView';
import CustomersView from './CustomersView';
import VoiceAgentsView from './VoiceAgentsView';
import PBXLiveView from './PBXLiveView';
import QueuesView from './QueuesView';
import AuditView from './AuditView';
import SyncStatusView from './SyncStatusView';
import SoftphonePane from '../SoftphonePane';
import CallControlGrid from '../CallControlGrid';
import RecentsList from '../RecentsList';
import SettingsPage from '../SettingsPage';
import { AppErrorBoundary } from '../AppErrorBoundary';
import IncomingCallToast from './IncomingCallToast';
import ActiveCallDock from './ActiveCallDock';
import DesktopTour from './DesktopTour';
import ResponsiveAuditOverlay from './ResponsiveAuditOverlay';
import { useCallShortcuts } from '../../hooks/useShortcuts';
import { callBus } from '../../hooks/useCallBus';
import { useDesktopRole } from '../../hooks/useDesktopRole';
import { useTenant } from '../../hooks/useTenant';
import { theme } from '../../lib/theme';
import { ava, setAuthToken } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';

const { colors: c } = theme;

interface Creds {
  extension: string;
  email: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{
      padding: 48, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', height: '100%',
      color: c.mutedSilver, textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: c.signalGold, textTransform: 'uppercase' }}>
        Coming in Phase 2
      </div>
      <h2 style={{ fontSize: 22, color: c.textIce, margin: '10px 0 6px' }}>{title}</h2>
      <p style={{ fontSize: 13, maxWidth: 420, margin: 0 }}>{hint}</p>
    </div>
  );
}

export default function ConsoleLayout({
  creds, onOpenSettings,
}: { creds: Creds; onOpenSettings: () => void }) {
  const [view, setView] = useState<ConsoleView>('home');
  const [aiOpen, setAiOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 520);
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100);
  const [tourOpen, setTourOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const isAuditChild = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('audit') === 'child';
  const { orgId, orgName, domainName, domainUuid } = useTenant();
  const { isAdmin, isSuperAdmin, isSupervisor } = useDesktopRole(orgId);
  const domainLabel = domainName || (domainUuid ? domainUuid.slice(0, 8) : null);

  // Redirect non-admins away from admin-only views, and away from removed views.
  useEffect(() => {
    const adminOnly: ConsoleView[] = ['admin', 'aiadmin', 'reports', 'customers', 'voiceagents', 'pbxlive', 'audit'];
    const removed: ConsoleView[] = ['queues', 'telecom'];
    if (removed.includes(view)) { console.info('[nav] removed view state', view, '→ home'); setView('home'); return; }
    if (!isAdmin && adminOnly.includes(view)) setView('home');
  }, [isAdmin, view]);

  useCallShortcuts();

  const runFullSync = async () => {
    setSyncing(true); setSyncNote(null);
    try {
      const res = await ava.syncPhoneSystemFull();
      const stats = res?.stats || {};
      const count = Object.entries(stats).filter(([k]) => k !== 'duration_ms').map(([k, v]) => `${k}:${v}`).join(' · ');
      setSyncNote(res.ok ? `Synced ${count || 'phone system'} · ${new Date(res.syncedAt).toLocaleTimeString()}` : (res.errors?.[0] || 'Phone-system sync failed'));
      window.dispatchEvent(new Event('lemtel:phone-sync-complete'));
      (window as any).__lemtelRefreshCalls?.();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const onResize = () => {
      setCompact(window.innerWidth < 520);
      setIsWide(window.innerWidth >= 1100);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    const REMOVED: ConsoleView[] = ['queues', 'telecom'];
    const onNav = (e: Event) => {
      const raw = (e as CustomEvent).detail as ConsoleView;
      if (!raw) return;
      if (REMOVED.includes(raw)) {
        console.info('[nav] redirect removed route', raw, '→ home');
        setView('home');
        return;
      }
      setView(raw);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('lemtel:nav', onNav as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lemtel:nav', onNav as EventListener);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        callBus.simulateIncoming('+1 514 555 0123', 'Marie Tremblay');
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAiOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!isAuditChild) setAuditOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuditChild]);

  return (
    <div className="ava-aurora-bg" style={{
      display: 'flex', height: '100%',
      background: c.bgGradient,
      color: c.textIce, position: 'relative', overflow: 'hidden',
    }}>

      {!compact && (
        <LeftRail
          view={view}
          onChange={setView}
          onOpenSettings={() => setView('settings')}
          onOpenSearch={() => setPaletteOpen(true)}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
          onStartTour={() => setTourOpen(true)}
        />
      )}

      <main style={{
        flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative',
        paddingBottom: compact ? 78 : 0, paddingTop: compact ? 54 : 0, display: 'flex', flexDirection: 'column',
      }}>
        {!compact && (orgName || domainLabel) && (
          <div style={{
            position: 'absolute', top: 10, right: 16, zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 999,
            background: 'rgba(255,255,255,0.7)', border: `1px solid ${c.border}`,
            backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            fontSize: 11, fontWeight: 600, color: c.textSub, letterSpacing: 0.2,
            boxShadow: '0 4px 14px -4px rgba(0,35,230,0.18)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: c.success }} />
            {orgName && <span style={{ color: c.textIce }}>{orgName}</span>}
            {domainLabel && <span style={{ opacity: 0.7 }}>· {domainLabel}</span>}
          </div>
        )}
        {compact && (
          <div
            className="ava-glass"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 8,
              height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '8px 12px', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.78)',
              borderRadius: 0,
              borderBottom: `1px solid ${c.border}`,
              backdropFilter: 'blur(18px) saturate(160%)',
              WebkitBackdropFilter: 'blur(18px) saturate(160%)',
              WebkitAppRegion: 'drag' as any,
            }}>
            {/* aurora hairline */}
            <div aria-hidden style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(0,35,230,0.45), rgba(33,212,253,0.4), transparent)',
              pointerEvents: 'none',
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.15 }}>
              <span style={{ fontSize: 12, color: c.textIce, fontWeight: 700, letterSpacing: 0.2, fontFamily: "'Space Grotesk', sans-serif" }}>AVA Statistic</span>
              <span style={{ fontSize: 10, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                Ext {creds.extension}{orgName ? ` · ${orgName}` : ''}{domainLabel ? ` · ${domainLabel}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' as any }}>
              <button onClick={() => setPaletteOpen(true)} style={{ height: 34, padding: '0 10px', borderRadius: 10, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.6)', color: c.textIce, cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }} aria-label="Search">⌘K</button>
              <button onClick={() => setView('settings')} style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.6)', color: c.textIce, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Settings">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1z"/></svg>
              </button>
            </div>
          </div>
        )}

        <AppErrorBoundary key={view} compact onBack={() => setView('dialer')}>
        <div className="lemtel-page-enter" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view === 'home' && <HomeDashboard displayName={creds.displayName || creds.email} extension={creds.extension} onQuickDial={() => setView('dialer')} />}
          {view === 'dialer' && (
            isWide ? (
              <WideDialerPanel creds={creds} orgId={orgId || ''} onOpenSettings={() => setView('settings')} />
            ) : (
              <div style={{ maxWidth: 460, margin: '0 auto', height: '100%' }}>
                <SoftphonePane creds={creds} onOpenSettings={() => setView('settings')} hideTabs />
              </div>
            )
          )}
          {view === 'calls' && <CallsView />}
          {view === 'messages' && <MessagesView />}
          {view === 'voicemail' && <VoicemailView />}
          {view === 'recordings' && <RecordingsView />}
          {view === 'ai' && <AIWorkspace />}
          {view === 'contacts' && <ContactsView />}
          {view === 'admin' && <AdminView />}
          {view === 'telecom' && <TelecomSettingsView />}
          {view === 'orgchat' && <OrgChatView />}
          {view === 'aiadmin' && <AdminAIChatView />}
          {view === 'reports' && <ReportsView />}
          {view === 'customers' && <CustomersView />}
          {view === 'voiceagents' && <VoiceAgentsView />}
          {view === 'pbxlive' && <PBXLiveView />}
          {view === 'queues' && <QueuesView isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} isSupervisor={isSupervisor} />}
          {view === 'audit' && <AuditView />}
          {view === 'sync' && <SyncStatusView />}
          {view === 'settings' && (
            <SettingsPage
              creds={creds}
              onSignOut={async () => {
                try { setAuthToken(null); } catch { /* noop */ }
                try { await supabase.auth.signOut(); } catch { /* noop */ }
                try {
                  window.localStorage.removeItem('lemtel-desktop-auth');
                  window.sessionStorage.removeItem('lemtel-desktop-auth');
                } catch { /* noop */ }
                await window.electronAPI?.clearCredentials?.();
                window.location.reload();
              }}
              onBack={() => setView('home')}
            />
          )}
        </div>
        </AppErrorBoundary>
      </main>

      <AIPanel open={aiOpen} onToggle={() => setAiOpen((v) => !v)} />



      {compact && (
        <LeftRail
          compact
          view={view}
          onChange={setView}
          onOpenSettings={() => setView('settings')}
          onOpenSearch={() => setPaletteOpen(true)}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
          onStartTour={() => setTourOpen(true)}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={setView} />

      <IncomingCallToast />
      <ActiveCallDock />
      <DesktopTour
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        forceOpen={tourOpen}
        onClose={() => setTourOpen(false)}
      />
      {!isAuditChild && (
        <ResponsiveAuditOverlay open={auditOpen} onClose={() => setAuditOpen(false)} />
      )}
    </div>
  );
}

// Memoized wide dialer panel. Isolates dialer keystrokes from the parent
// ConsoleLayout so typing digits never triggers a re-render of the rest of
// the console (presence, timers, sync banners, etc.). Fixes the wide-mode
// dialer freeze on phone-number entry.
const dispatchDial = (n: string) =>
  window.dispatchEvent(new CustomEvent('lemtel:dial-number', { detail: { number: n } }));

const WideDialerPanel = React.memo(function WideDialerPanel({
  creds, orgId, onOpenSettings,
}: { creds: Creds; orgId: string; onOpenSettings: () => void }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(420px, 480px) 1fr',
      gap: 24,
      width: '100%', maxWidth: 1440, margin: '0 auto',
      padding: '8px 24px 16px',
      height: '100%', minHeight: 0,
      alignItems: 'stretch',
      willChange: 'transform',
      contain: 'layout paint',
    }}>
      <div style={{
        background: c.bgCard, border: `1px solid ${c.border}`,
        borderRadius: 22, padding: 8,
        boxShadow: '0 18px 48px -28px rgba(0,35,230,0.28)',
        minHeight: 0, display: 'flex', flexDirection: 'column',
        contain: 'layout paint',
      }}>
        <SoftphonePane creds={creds} onOpenSettings={onOpenSettings} hideTabs />
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 16, minHeight: 0 }}>
        <div style={{
          background: c.bgCard, border: `1px solid ${c.border}`,
          borderRadius: 22, padding: 4, overflow: 'hidden',
          boxShadow: '0 18px 48px -28px rgba(0,35,230,0.20)',
          minHeight: 0,
        }}>
          <CallControlGrid organizationId={orgId} onDial={dispatchDial} />
        </div>
        <div style={{
          background: c.bgCard, border: `1px solid ${c.border}`,
          borderRadius: 22, padding: 14, overflow: 'auto',
          boxShadow: '0 18px 48px -28px rgba(0,35,230,0.20)',
          minHeight: 0,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: c.textSub, marginBottom: 10 }}>
            Recent calls
          </div>
          <RecentsList extension={creds.extension} onCall={dispatchDial} />
        </div>
      </div>
    </div>
  );
});
