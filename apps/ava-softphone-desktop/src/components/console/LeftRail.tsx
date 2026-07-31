import React, { useEffect, useState } from 'react';
import { theme, useTheme } from '../../lib/theme';
import LemtelLogo from '../LemtelLogo';
import { useTranslation, type I18nKey } from '../../lib/i18n';
import LanguageSwitcher from '../ui/LanguageSwitcher';
import { useSyncStatus, formatAge } from '../../hooks/useSyncStatus';
import { useTenant } from '../../hooks/useTenant';
import { supabase } from '../../lib/supabaseClient';
import avaStatisticLogo from '../../assets/ava-statistic-logo.png';

function useOrgChatUnread(currentView: string) {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const { data } = await supabase.functions.invoke('org-chat', { body: { action: 'unread_counts' } });
        if (!alive) return;
        const rows = (data as any)?.counts || (data as any)?.data || [];
        const sum = Array.isArray(rows)
          ? rows.reduce((acc: number, r: any) => acc + Number(r?.unread_count || 0), 0)
          : 0;
        setTotal(sum);
      } catch { /* ignore */ }
    };
    load();
    timer = setInterval(load, 30000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);
  // Clear locally when user is viewing chat
  useEffect(() => { if (currentView === 'orgchat') setTotal(0); }, [currentView]);
  return total;
}



const { colors: c } = theme;

const NAV_KEY: Record<string, I18nKey> = {
  home: 'nav.home', dialer: 'nav.dialer', calls: 'nav.calls', messages: 'nav.messages',
  voicemail: 'nav.voicemail', recordings: 'nav.recordings', ai: 'nav.ai',
  contacts: 'nav.contacts', admin: 'nav.admin', settings: 'nav.settings',
  telecom: 'nav.telecom', orgchat: 'nav.orgchat', aiadmin: 'nav.aiadmin', reports: 'nav.reports',
  customers: 'nav.admin', voiceagents: 'nav.ai', pbxlive: 'nav.pbxlive',
  audit: 'nav.admin', queues: 'nav.calls',
};

export type ConsoleView =
  | 'home' | 'dialer' | 'calls' | 'messages' | 'voicemail'
  | 'recordings' | 'ai' | 'contacts' | 'admin' | 'settings'
  | 'telecom' | 'orgchat' | 'aiadmin' | 'reports' | 'pbxlive'
  | 'customers' | 'voiceagents' | 'audit' | 'queues' | 'sync';

const ICON: Record<ConsoleView, string> = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V11z',
  dialer: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0 1 22 16.92z',
  calls: 'M3 5h4l2 5-2.5 1.5a11 11 0 0 0 6 6L14 15l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 7a2 2 0 0 1 2-2',
  messages: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  voicemail: 'M5.5 17a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm13 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zM5.5 17h13',
  recordings: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  ai: 'M12 2l1.8 4.5L18 8l-4.2 1.5L12 14l-1.8-4.5L6 8l4.2-1.5L12 2zm6 10l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z',
  contacts: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm-8 2a6 6 0 0 0-6 6v2h20v-2a6 6 0 0 0-6-6H8z',
  admin: 'M12 1l9 4v6c0 5-4 9-9 11-5-2-9-6-9-11V5l9-4zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  telecom: 'M4 4h16v6H4zM4 14h16v6H4z',
  orgchat: 'M7 8h10M7 12h7M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  aiadmin: 'M12 2l1.8 4.5L18 8l-4.2 1.5L12 14l-1.8-4.5L6 8l4.2-1.5L12 2zM5 18h14',
  reports: 'M3 3v18h18M7 14l3-3 3 3 5-5',
  pbxlive: 'M4 7h16M4 12h6m4 0h6M4 17h16M6 5v14m12-14v14',
  customers: 'M3 7h18M3 12h18M3 17h18M7 3v18',
  voiceagents: 'M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4zM5 11a7 7 0 0 0 14 0M12 18v4',
  audit: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  queues: 'M3 6h18M3 12h12M3 18h18M19 10l3 2-3 2v-4z',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 4v6h-6l2.6-2.6A6 6 0 1 0 18 12h2a8 8 0 1 1-16 0z',
  settings: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};

const LABEL: Record<ConsoleView, string> = {
  home: 'Home', dialer: 'Phone', calls: 'Call History', messages: 'SMS',
  voicemail: 'Voicemail', recordings: 'Recordings', ai: 'AVA AI',
  contacts: 'Contacts', admin: 'Admin', settings: 'Settings',
  telecom: 'Telecom', orgchat: 'Org Chat', aiadmin: 'AI Admin', reports: 'Reports',
  customers: 'Customers', voiceagents: 'Voice Agents', pbxlive: 'PBX Live', audit: 'Audit',
  queues: 'Call Queues', sync: 'Sync & Diag',
};

const USER_ITEMS: ConsoleView[] = ['home', 'dialer', 'calls', 'messages', 'voicemail', 'recordings', 'orgchat', 'ai', 'contacts', 'sync'];
const ADMIN_ITEMS: ConsoleView[] = ['pbxlive', 'customers', 'voiceagents', 'reports', 'admin', 'aiadmin', 'audit'];

interface Props {
  view: ConsoleView;
  onChange: (v: ConsoleView) => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  compact?: boolean;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  onStartTour?: () => void;
}

const SUPER_ADMIN_EXTRAS: ConsoleView[] = ['pbxlive', 'customers', 'voiceagents', 'reports', 'admin', 'aiadmin', 'audit'];

export default function LeftRail({ view, onChange, onOpenSettings, onOpenSearch, compact, isAdmin, isSuperAdmin, onStartTour }: Props) {
  const { t } = useTranslation();
  const { mode } = useTheme();
  const isDark = mode === 'dark' || mode === 'midnight';
  const { pbx, syncConnected, lastEvent, ageMs, healthy } = useSyncStatus();
  const { extension: myExtension, loading: tenantLoading } = useTenant();
  const chatUnread = useOrgChatUnread(view);

  // Super admins see admin items in the Platform group below, not duplicated above
  const ITEMS: ConsoleView[] = isSuperAdmin ? USER_ITEMS : isAdmin ? [...USER_ITEMS, ...ADMIN_ITEMS] : USER_ITEMS;
  if (compact) return <CompactRail view={view} onChange={onChange} onOpenSettings={onOpenSettings} items={isSuperAdmin ? [...USER_ITEMS, ...ADMIN_ITEMS] : ITEMS} />;

  const glowColor = pbx === 'error'
    ? '#ff5577'
    : healthy
      ? '#23d6ff'
      : pbx === 'registered'
        ? c.signalGold
        : c.borderAI;
  const railSurface = 'var(--ava-glass, rgba(20,28,56,0.72))';
  const railElev = 'var(--ava-surface-elev, rgba(255,255,255,0.08))';
  const railHover = 'var(--ava-surface-hover, rgba(255,255,255,0.12))';

  const darkTextSub = 'rgba(230,240,255,0.82)';
  const darkTextIce = '#f1f7ff';
  const darkRailHover = 'rgba(255,255,255,0.14)';

  return (
    <aside
      className="ava-glass lemtel-rail"
      style={{
        width: 244, flexShrink: 0, height: '100%',
        background: railSurface,
        borderRight: `1px solid ${c.border}`,
        borderRadius: 0,
        display: 'flex', flexDirection: 'column',
        padding: '18px 14px 16px',
        WebkitAppRegion: 'drag' as any,
        position: 'relative',
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
      }}>
      {/* aurora hairline accent on the right edge */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, bottom: 0, right: 0, width: 1,
        background: 'linear-gradient(180deg, transparent, rgba(0,35,230,0.45), rgba(33,212,253,0.35), transparent)',
        pointerEvents: 'none',
      }} />


      {/* Brand block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 8px 12px',
        WebkitAppRegion: 'no-drag' as any,
      }}>
        <LemtelLogo size="sm" glow />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: c.textIce, letterSpacing: 0.3 }}>Lemtel</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: c.signalGold, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 3 }}>
            Telecom · AI Phone
          </span>
        </div>
      </div>

      {/* Status + extension chip */}
      <div style={{ margin: '0 4px 12px', display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as any }}>
        <div className="lemtel-rail-chip" style={{
          flex: '0 0 auto', padding: '7px 10px',
          borderRadius: 10,
          background: railElev,
          border: `1px solid ${c.border}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: pbx === 'registered' ? '#22c55e' : pbx === 'error' ? '#ef4444' : c.mutedSilver,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: c.textIce, letterSpacing: 0.3 }}>
            {pbx === 'registered' ? 'Online' : pbx === 'error' ? 'Offline' : 'Connecting…'}
          </span>
        </div>
        <div className="lemtel-rail-chip" title={myExtension ? `My extension: ${myExtension}` : 'No extension assigned'} style={{
          flex: 1, minWidth: 0, padding: '7px 10px',
          borderRadius: 10,
          background: myExtension ? 'linear-gradient(135deg, rgba(0,35,230,0.18), rgba(33,212,253,0.10))' : railElev,
          border: `1px solid ${myExtension ? 'rgba(33,212,253,0.45)' : c.border}`,
          display: 'flex', alignItems: 'center', gap: 6,
          overflow: 'hidden',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={myExtension ? c.avaCyan : c.mutedSilver} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 5h4l2 5-2.5 1.5a11 11 0 0 0 6 6L14 15l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 7a2 2 0 0 1 2-2"/>
          </svg>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: c.avaCyan, letterSpacing: 1.2, textTransform: 'uppercase' }}>Ext</span>
          {tenantLoading ? (
            <span aria-label="Loading extension" className="ava-skeleton" style={{
              display: 'inline-block', width: 36, height: 12, borderRadius: 4,
              background: 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.18), rgba(255,255,255,0.08))',
              backgroundSize: '200% 100%', animation: 'avaShimmer 1.2s linear infinite',
            }} />
          ) : (
            <span style={{ fontSize: 12, fontWeight: 800, color: c.textIce, letterSpacing: 0.4, fontFamily: "'Space Grotesk', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {myExtension || 'N/A'}
            </span>
          )}
        </div>
      </div>


      <button
        className="lemtel-rail-search"
        onClick={onOpenSearch}
        style={{
          margin: '4px 4px 12px', padding: '9px 11px',
          background: railElev,
          border: `1px solid ${c.border}`,
          borderRadius: 10, color: isDark ? darkTextSub : c.textSub,
          fontSize: 11.5, textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          WebkitAppRegion: 'no-drag' as any,
          transition: 'border-color .18s ease, background .18s ease, color .18s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.borderGold; e.currentTarget.style.color = isDark ? darkTextIce : c.textIce; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.background = railElev; e.currentTarget.style.color = isDark ? darkTextSub : c.textSub; }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          {t('nav.search')}
        </span>
          <kbd style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.10)' : railHover, color: isDark ? darkTextIce : c.text, fontFamily: 'inherit' }}>⌘K</kbd>
      </button>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, WebkitAppRegion: 'no-drag' as any, overflowY: 'auto' }}>
        {ITEMS.map((v) => <RailItem key={v} v={v} active={view === v} onClick={() => onChange(v)} label={t(NAV_KEY[v])} badge={v === 'orgchat' ? chatUnread : 0} />)}

        {isSuperAdmin && (
          <>
            <div style={{
              marginTop: 14, marginBottom: 4, padding: '4px 10px',
              fontSize: 9, fontWeight: 800, letterSpacing: 1.8,
              color: c.signalGold, textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>👑 Platform</span>
              <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${c.borderGold || c.border}, transparent)` }} />
            </div>
            {SUPER_ADMIN_EXTRAS.map((v) => (
              <RailItem key={`sa-${v}`} v={v} active={view === v} onClick={() => onChange(v)} label={t(NAV_KEY[v])} />
            ))}
          </>
        )}
      </nav>

      {onStartTour && (
        <button
          onClick={onStartTour}
          style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '7px 11px', borderRadius: 9,
            background: 'transparent', border: 'none',
            color: isDark ? darkTextSub : c.textSub, fontSize: 11.5, fontWeight: 600,
            cursor: 'pointer', textAlign: 'left',
            WebkitAppRegion: 'no-drag' as any,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = c.signalGold; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = isDark ? darkTextSub : c.textSub; }}
        >
          <span style={{ fontSize: 14 }}>💡</span>
          Restart tour
        </button>
      )}

      <button
        onClick={onOpenSettings}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '9px 11px', borderRadius: 9,
          background: 'transparent', border: 'none',
          color: isDark ? darkTextSub : c.textSub, fontSize: 12.5, fontWeight: 600,
          cursor: 'pointer', textAlign: 'left',
          WebkitAppRegion: 'no-drag' as any,
          transition: 'color .15s ease, background .15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? darkRailHover : railHover; e.currentTarget.style.color = isDark ? darkTextIce : c.textIce; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isDark ? darkTextSub : c.textSub; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={ICON.settings}/></svg>
        {t('nav.settings')}
      </button>

      {/* AVA footer chip */}
      <div style={{
        marginTop: 10, padding: '10px 12px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(122,76,255,0.18), rgba(35,214,255,0.08))',
        border: `1px solid ${c.borderAI}`,
        display: 'flex', alignItems: 'center', gap: 10,
        WebkitAppRegion: 'no-drag' as any,
      }}>
        <img
          src={avaStatisticLogo}
          alt="AVA Statistic"
          width={28}
          height={28}
          style={{ borderRadius: 8, flexShrink: 0, objectFit: 'contain', boxShadow: `0 4px 14px -6px ${c.avaViolet}` }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: c.avaCyan, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Powered by
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: c.textIce, letterSpacing: 0.3 }}>
            AVA Statistic · AVA AI
          </span>
        </div>
        <LanguageSwitcher />
      </div>
    </aside>
  );
}

function RailItem({ v, active, onClick, label, badge }: { v: ConsoleView; active: boolean; onClick: () => void; label?: string; badge?: number }) {
  const { mode } = useTheme();
  const isDark = mode === 'dark' || mode === 'midnight';
  const isAI = v === 'ai';
  const accent = isAI ? c.avaViolet : c.signalGold;
  const hoverSurface = 'var(--ava-surface-hover, rgba(255,255,255,0.12))';
  const darkTextSub = 'rgba(230,240,255,0.82)';
  const darkTextIce = '#f1f7ff';
  return (
    <button
      className="lemtel-rail-item ava-press"
      data-active={String(active)}
      onClick={onClick}
      aria-label={label ?? LABEL[v]}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '10px 12px', borderRadius: 12,
        background: active
          ? (isAI
              ? 'linear-gradient(135deg, rgba(122,76,255,0.30), rgba(33,212,253,0.12))'
              : 'linear-gradient(135deg, rgba(0,35,230,0.30), rgba(122,76,255,0.18))')
          : 'transparent',

        border: '1px solid ' + (active ? (isDark ? 'rgba(0,35,230,0.35)' : 'rgba(0,35,230,0.18)') : 'transparent'),
        color: active ? (isDark ? darkTextIce : c.textIce) : (isDark ? darkTextSub : c.textSub),
        fontSize: 13, fontWeight: active ? 700 : 600,
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
        position: 'relative',
        outline: 'none',
        boxShadow: active ? (isDark ? '0 6px 18px -10px rgba(77,109,255,0.55)' : '0 6px 18px -10px rgba(0,35,230,0.45)') : 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : hoverSurface;
          e.currentTarget.style.color = isDark ? darkTextIce : c.textIce;
          e.currentTarget.style.transform = 'translateX(2px)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = isDark ? darkTextSub : c.textSub;
          e.currentTarget.style.transform = 'translateX(0)';
        }
      }}
    >
      {active && (
        <span aria-hidden style={{
          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
          borderRadius: 3,
          background: isAI ? 'linear-gradient(180deg,#7a4cff,#21d4fd)' : 'linear-gradient(180deg,#0023e6,#21d4fd)',
          boxShadow: isDark ? '0 0 14px rgba(77,109,255,0.70)' : '0 0 12px rgba(0,35,230,0.55)',
        }} />
      )}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? (isAI ? '#7a4cff' : '#0023e6') : 'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON[v]} />
      </svg>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label ?? LABEL[v]}</span>
      {!!badge && badge > 0 && (
        <span className="ava-pulse-badge" style={{
          background: c.signalGold, color: '#0b1530',
          fontSize: 10, fontWeight: 800, lineHeight: 1,
          padding: '3px 6px', borderRadius: 999, minWidth: 18,
          textAlign: 'center', boxShadow: `0 0 0 2px ${c.signalGold}33`,
        }}>{badge > 99 ? '99+' : badge}</span>
      )}

    </button>
  );
}


/* ─── Compact bottom rail for narrow / minimized windows ─── */
function CompactRail({ view, onChange, onOpenSettings, items }: { view: ConsoleView; onChange: (v: ConsoleView) => void; onOpenSettings: () => void; items: ConsoleView[] }) {
  const { t } = useTranslation();
  const all: ConsoleView[] = [...items, 'settings'];
  return (
    <aside
      className="ava-glass"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
        background: 'var(--ava-glass, rgba(20,28,56,0.72))',
        borderTop: `1px solid ${c.border}`,
        borderRadius: 0,
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
        boxShadow: '0 -10px 30px -16px rgba(11,21,48,0.18)',
      }}>

      <div className="lemtel-rail-h" style={{ display: 'flex', gap: 4, overflowX: 'auto', overflowY: 'hidden', padding: '6px 8px', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' }}>

        {all.map((v) => {
          const active = view === v;
          const isAI = v === 'ai';
          const accent = isAI ? c.avaViolet : c.signalGold;
          return (
            <button
              key={v}
              onClick={() => v === 'settings' ? onOpenSettings() : onChange(v)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                minWidth: 64, padding: '8px 10px', borderRadius: 12,
                background: active ? `linear-gradient(180deg, ${accent}22, transparent)` : 'transparent',
                border: active ? `1px solid ${accent}55` : '1px solid transparent',
                color: active ? c.textIce : c.textSub,
                fontSize: 10, fontWeight: active ? 700 : 500,
                cursor: 'pointer', transition: 'all .18s ease',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? accent : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICON[v]} />
              </svg>
              <span style={{ letterSpacing: 0.3 }}>{t(NAV_KEY[v])}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
