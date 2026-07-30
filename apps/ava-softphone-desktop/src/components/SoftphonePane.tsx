import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSoftphone } from '@/hooks/useSoftphone';
import RecentsList from './RecentsList';
import ContactsList from './ContactsList';
import VoicemailList from './VoicemailList';
import SmsThreads from './SmsThreads';
import RecordingsList from './RecordingsList';
import CallForwarding from './CallForwarding';
import LemtelLogo from './LemtelLogo';
import BrandTagline from './BrandTagline';
// ProfileMenu is rendered globally in TitleBar — no longer duplicated here.
import { AppErrorBoundary } from './AppErrorBoundary';
import { theme } from '../lib/theme';
import DialerKeypad from './DialerKeypad';
import { ava } from '../lib/avaApi';
import {
  Phone, MessageCircle, LayoutGrid, Grid3x3, User,
} from 'lucide-react';
// TabIcons legacy — replaced by lucide-react in new bottom nav
import OutputDevicePicker from './OutputDevicePicker';
import { watchA11y } from '../lib/a11yAudit';
import pkg from '../../package.json';

const APP_VERSION: string =
  (typeof window !== 'undefined' && (window as any).electronAPI?.getVersion?.()) ||
  (pkg as { version?: string }).version ||
  '2.1.1';

interface Creds {
  extension: string;
  email: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

type Tab = 'keypad' | 'chats' | 'calls' | 'contacts' | 'speeddial';
type CallsSubTab = 'recents' | 'recordings' | 'voicemail';

const MAIN_TABS: Tab[] = ['contacts', 'chats', 'calls', 'keypad', 'speeddial'];

const TAB_META: Record<Tab, { LucideIcon: React.ComponentType<{ size?: number | string; color?: string; strokeWidth?: number | string }>; label: string }> = {
  contacts:  { LucideIcon: User,          label: 'Contacts' },
  chats:     { LucideIcon: MessageCircle, label: 'Chats' },
  calls:     { LucideIcon: Phone,         label: 'Calls' },
  keypad:    { LucideIcon: Grid3x3,       label: 'Keypad' },
  speeddial: { LucideIcon: LayoutGrid,    label: 'Speed Dial' },
};

const { colors: c, glow } = theme;


export default function SoftphonePane({
  creds,
  onOpenSettings,
  hideTabs = false,
}: {
  creds: Creds;
  onOpenSettings: () => void;
  hideTabs?: boolean;
}) {
  const sp = useSoftphone({
    extension: creds.extension,
    displayName: creds.displayName,
    sipDomain: creds.sipDomain,
    wssUrl: creds.wssUrl,
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const prevCallStateRef = useRef(false);
  const syncAfterCallRef = useRef(false);
  const [tab, setTab] = useState<Tab>('keypad');
  const [callsSubTab, setCallsSubTab] = useState<CallsSubTab>('recents');
  const [showAvaChat, setShowAvaChat] = useState(false);
  const [dial, setDial] = useState('');
  const [timer, setTimer] = useState(0);
  const [showXfer, setShowXfer] = useState(false);
  const [xferTarget, setXferTarget] = useState('');
  const [xferMode, setXferMode] = useState<'blind' | 'attended'>('blind');
  const [showDTMF, setShowDTMF] = useState(false);
  const [paneWidth, setPaneWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 480
  );
  const [activeOutputLabel, setActiveOutputLabel] = useState('System default');
  const [autoResetOutput, setAutoResetOutput] = useState<boolean>(() => {
    try { return localStorage.getItem('lemtel.autoResetOutput') === 'true'; } catch { return false; }
  });
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [syncingPhone, setSyncingPhone] = useState(false);

  useEffect(() => {
    const nav: any = navigator;
    if (!nav?.permissions?.query) return;
    let permRef: any = null;
    nav.permissions.query({ name: 'microphone' as PermissionName }).then((res: any) => {
      permRef = res;
      setMicPermission(res.state);
      res.onchange = () => setMicPermission(res.state);
    }).catch(() => setMicPermission('unknown'));
    return () => { if (permRef) permRef.onchange = null; };
  }, []);

  // Pre-request microphone on mount so the first call can't crash the renderer
  // by triggering an unhandled getUserMedia rejection inside JsSIP.
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setMicPermission('granted');
        console.log('[softphone] Microphone pre-authorized ✅');
      })
      .catch((err) => {
        console.warn('[softphone] Microphone pre-auth failed:', err?.message || err);
      });
  }, []);

  const requestMic = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
    } catch {
      setMicPermission('denied');
    }
  };

  useEffect(() => { sp.setAudioEl(audioRef.current); }, [sp]);

  // Track container width for responsive header/tabs/footer
  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setPaneWidth(w);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const compact = paneWidth < 440;
  const ultraCompact = paneWidth < 360;

  // Dev-only a11y audit on every DOM mutation inside the pane.
  useEffect(() => {
    if (!rootRef.current) return;
    return watchA11y(rootRef.current, 'SoftphonePane');
  }, []);

  // ---- In-call keyboard shortcuts ----------------------------------------
  // M = mute/unmute · H = hold/resume · K = toggle DTMF · T = blind transfer
  // Shift+T = attended transfer · E or Esc = end call · 0-9 * # = DTMF tone
  useEffect(() => {
    const inActiveCall = sp.snap.callState === 'active' || sp.snap.callState === 'held';
    if (!inActiveCall && sp.snap.callState !== 'ringing-in') return;

    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/selects/textareas/contenteditable.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Incoming ring → Enter answers, Esc declines (already wired globally,
      // but we keep a local fallback so the pane works in isolation).
      if (sp.snap.callState === 'ringing-in') {
        if (e.key === 'Enter') { e.preventDefault(); setTimeout(() => sp.answer(), 0); }
        else if (e.key === 'Escape') { e.preventDefault(); sp.hangup(); }
        return;
      }

      const k = e.key;
      if (k === 'm' || k === 'M') {
        e.preventDefault();
        sp.snap.muted ? sp.unmute() : sp.mute();
      } else if (k === 'h' || k === 'H') {
        e.preventDefault();
        sp.snap.onHold ? sp.unhold() : sp.hold();
      } else if (k === 'k' || k === 'K') {
        e.preventDefault();
        setShowDTMF((v) => !v);
      } else if (k === 'e' || k === 'E' || k === 'Escape') {
        e.preventDefault();
        sp.hangup();
      } else if (k === 't') {
        e.preventDefault();
        setXferMode('blind'); setShowXfer(true);
      } else if (k === 'T') {
        e.preventDefault();
        setXferMode('attended'); setShowXfer(true);
      } else if (/^[0-9*#]$/.test(k)) {
        e.preventDefault();
        sp.sendDTMF(k);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sp.snap.callState, sp.snap.muted, sp.snap.onHold, sp]);


  // Broadcast SIP status to TitleBar
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('lemtel:sip-status', { detail: sp.snap.status }));
  }, [sp.snap.status]);

  useEffect(() => {
    if (sp.snap.callState !== 'active' && sp.snap.callState !== 'held') { setTimer(0); return; }
    if (!sp.snap.startedAt) return;
    console.debug('[AVA] call-timer started', { callState: sp.snap.callState, startedAt: sp.snap.startedAt });
    // 1s cadence is enough for a mm:ss display and halves the in-call render
    // load — the wide-layout dialer was freezing because the 500ms tick was
    // cascading into every memo + audio visualizer paint on each frame.
    let lastTickAt = performance.now();
    let slowFrames = 0;
    const id = setInterval(() => {
      const nowPerf = performance.now();
      const drift = nowPerf - lastTickAt - 1000;
      lastTickAt = nowPerf;
      if (drift > 500) {
        slowFrames++;
        console.warn('[AVA] call-timer slow tick — main thread blocked', { driftMs: Math.round(drift), slowFrames });
      }
      setTimer(Math.floor((Date.now() - (sp.snap.startedAt || Date.now())) / 1000));
    }, 1000);
    return () => {
      clearInterval(id);
      console.debug('[AVA] call-timer stopped', { slowFrames });
    };
  }, [sp.snap.callState, sp.snap.startedAt]);

  // Reset audio output to default when call ends if auto-reset is enabled
  useEffect(() => {
    const isInCall = sp.snap.callState === 'active' || sp.snap.callState === 'held';
    if (prevCallStateRef.current && !isInCall && autoResetOutput) {
      const el = audioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> } | null;
      if (el && typeof el.setSinkId === 'function') {
        el.setSinkId('default').catch(() => {});
      }
      setActiveOutputLabel('System default');
    }
    prevCallStateRef.current = isInCall;
  }, [sp.snap.callState, autoResetOutput]);

  // When a call ends, pull fresh CDRs/voicemails/recording metadata in a short burst.
  useEffect(() => {
    const isInCall = sp.snap.callState === 'active' || sp.snap.callState === 'held' || sp.snap.callState === 'ringing-in' || sp.snap.callState === 'ringing-out';
    if (syncAfterCallRef.current && !isInCall) {
      const delays = [1200, 6000, 18000];
      const timers = delays.map((delay) => window.setTimeout(async () => {
        await ava.syncPhoneSystemRecent(250);
        window.dispatchEvent(new Event('lemtel:phone-sync-complete'));
      }, delay));
      syncAfterCallRef.current = false;
      return () => timers.forEach((id) => window.clearTimeout(id));
    }
    syncAfterCallRef.current = isInCall;
  }, [sp.snap.callState]);

  const dotColor =
    sp.snap.status === 'registered' ? c.green :
    sp.snap.status === 'error' ? c.red : c.yellow;

  const inCall = sp.snap.callState === 'active' || sp.snap.callState === 'held';
  const ringing = sp.snap.callState === 'ringing-in' || sp.snap.callState === 'ringing-out';

  const fmt = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const [callBusy, setCallBusy] = useState(false);
  const sipReady = sp.snap.status === 'registered';
  const callDisabledReason =
    !sipReady ? 'SIP not registered yet' :
    micPermission === 'denied' ? 'Microphone denied — click Allow' :
    callBusy ? 'Starting call…' : '';

  const handleCall = async () => {
    if (dial.length < 3 || callBusy) return;
    if (micPermission === 'denied') { await requestMic(); return; }
    if (!sipReady) return;
    setCallBusy(true);
    // Defer the (potentially expensive) JsSIP `call()` out of the click handler
    // so React can paint the busy-state first. Wide-layout side panels otherwise
    // re-render synchronously with the SIP session creation and freeze the UI.
    const target = dial;
    setTimeout(() => {
      try { sp.call(target); } catch (e) { console.warn('[softphone] call failed', e); }
      setTimeout(() => setCallBusy(false), 1500);
    }, 0);
  };

  const syncPhoneSystem = async () => {
    setSyncingPhone(true);
    try {
      await ava.syncPhoneSystemFull();
      window.dispatchEvent(new Event('lemtel:phone-sync-complete'));
    } finally {
      setSyncingPhone(false);
    }
  };

  // Global "dial now" shortcut (⌘/Ctrl + Enter) wires in from useShortcuts.
  useEffect(() => {
    const onDial = () => handleCall();
    window.addEventListener('lemtel:dial-now', onDial);
    return () => window.removeEventListener('lemtel:dial-now', onDial);
  }, [dial, sp.snap.status]);

  // Wide-mode side panels (CallControlGrid / RecentsList) dispatch this to
  // route a number into the dialer + immediately ring it.
  useEffect(() => {
    const onDialNumber = (e: Event) => {
      const detail = (e as CustomEvent<{ number?: string }>).detail;
      const number = detail?.number;
      if (!number) return;
      setDial(number);
      setTimeout(() => { if (sp.snap.status === 'registered') sp.call(number); }, 80);
    };
    window.addEventListener('lemtel:dial-number', onDialNumber as EventListener);
    return () => window.removeEventListener('lemtel:dial-number', onDialNumber as EventListener);
  }, [sp]);

  // Custom protocol (lemtel://call/<number>) from Chrome extension / OS
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onProtocolCall?: (cb: (d: { number: string }) => void) => void } }).electronAPI;
    api?.onProtocolCall?.(({ number }) => {
      if (!number) return;
      setDial(number);
      setTimeout(() => {
        if (sp.snap.status === 'registered') sp.call(number);
      }, 1000);
    });
  }, []);

  const handleXferSubmit = () => {
    if (!xferTarget) return;
    if (xferMode === 'blind') sp.blindTransfer(xferTarget);
    else sp.startAttendedConsult(xferTarget);
    setShowXfer(false);
    setXferTarget('');
  };

  const dialKeys: [string, string][] = [
    ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
    ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
    ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
    ['*', ''], ['0', '+'], ['#', ''],
  ];




  return (
    <div ref={rootRef} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f0f4ff', color: '#0d1426', position: 'relative', overflow: 'hidden',
    }}>

      <audio ref={audioRef} autoPlay />

      {/* HEADER */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: ultraCompact ? 4 : compact ? 6 : 10,
        padding: ultraCompact ? '6px 8px' : compact ? '7px 10px' : '10px 14px',
        height: ultraCompact ? 42 : compact ? 46 : 52, boxSizing: 'border-box',
        background: '#ffffff',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      }}>
        {/* Extension badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: compact ? '3px 8px' : '4px 10px', borderRadius: 999,
          background: 'rgba(0,35,230,0.08)', border: '1px solid rgba(0,35,230,0.20)',
          color: '#0023e6', fontSize: compact ? 10 : 11, fontWeight: 700, letterSpacing: 0.5,
        }}>
          Ext {creds.extension}
        </div>

        {!compact && (
          <div style={{
            fontSize: 12, fontWeight: 500, color: '#0d1426', opacity: 0.85,
            flex: 1, minWidth: 0, textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {creds.displayName || creds.email}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 5 : 8, flexShrink: 0, marginLeft: compact ? 'auto' : 0 }}>
          {/* Compact SIP indicator only — full status & profile live in TitleBar */}
          <span
            title={sp.snap.errorCause || `SIP: ${sp.snap.status}`}
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 8px ${dotColor}`,
              animation: sp.snap.status === 'registered' ? 'statusPulse 2s ease-in-out infinite' : 'none',
            }}
          />
          <button
            onClick={syncPhoneSystem}
            disabled={syncingPhone}
            title="Sync phone system"
            style={{
              background: 'rgba(0,35,230,0.06)', border: '1px solid rgba(0,35,230,0.20)',
              color: '#0023e6', cursor: syncingPhone ? 'wait' : 'pointer',
              width: compact ? 26 : 30, height: compact ? 24 : 28, borderRadius: 8, fontSize: 12,
            }}
            aria-label="Sync phone system"
          >{syncingPhone ? '…' : '↻'}</button>
          <button
            onClick={() => setShowAvaChat((v) => !v)}
            title="AVA AI Assistant"
            aria-label="AVA AI"
            style={{
              background: showAvaChat ? 'linear-gradient(135deg, #7a4cff, #21d4fd)' : 'rgba(122,76,255,0.10)',
              border: '1px solid rgba(122,76,255,0.30)',
              color: showAvaChat ? '#fff' : '#7a4cff',
              cursor: 'pointer',
              width: compact ? 26 : 30, height: compact ? 24 : 28, borderRadius: 8, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .2s ease',
            }}
          >✦</button>
          <button
            onClick={onOpenSettings}
            style={{
              background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.12)',
              color: '#3a4560', cursor: 'pointer',
              width: compact ? 26 : 30, height: compact ? 24 : 28, borderRadius: 8, fontSize: 14,
            }}
            aria-label="Settings"
          >⚙</button>
        </div>

      </div>

      {/* Diagnostics strip — always available */}
      <SipDiagnostics sp={sp} compact={compact} c={c} />

      {sp.credError && (
        <div style={{
          position: 'relative', zIndex: 1,
          margin: compact ? '10px 12px 0' : '14px 16px 0',
          padding: 16,
          borderRadius: 12,
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>🔐</div>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>SIP Not Configured</div>
          <div style={{ color: 'rgba(235,240,255,0.78)', fontSize: 12, lineHeight: 1.5, maxWidth: 280 }}>
            Your extension needs a SIP password. Contact your administrator or visit the portal.
          </div>
          <button
            onClick={() => window.electronAPI?.openExternal?.('https://avastatistic.ca')}
            style={{
              marginTop: 4, padding: '8px 16px', borderRadius: 10,
              background: 'linear-gradient(135deg, #003DA6, #7C3AED)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
            }}
          >Open Portal →</button>
          <div style={{ color: 'rgba(235,240,255,0.5)', fontSize: 10, marginTop: 4 }}>{sp.credError}</div>
        </div>
      )}

      {!sp.credError && sp.snap.status !== 'registered' && sp.snap.status !== 'idle' && (
        <div style={{
          position: 'relative', zIndex: 1,
          margin: compact ? '8px 12px 0' : '10px 16px 0',
          padding: '10px 12px', borderRadius: 10,
          background: sp.snap.status === 'error'
            ? 'rgba(239,68,68,0.10)'
            : sp.snap.status === 'disconnected'
              ? 'rgba(148,163,184,0.10)'
              : 'rgba(245,158,11,0.10)',
          border: sp.snap.status === 'error'
            ? '1px solid rgba(239,68,68,0.35)'
            : sp.snap.status === 'disconnected'
              ? '1px solid rgba(148,163,184,0.35)'
              : '1px solid rgba(245,158,11,0.35)',
          color: '#fff', fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>
              {sp.snap.status === 'error' && '⚠️ SIP Registration Failed'}
              {sp.snap.status === 'connecting' && '🔄 Connecting to SIP…'}
              {sp.snap.status === 'connected' && '🔄 Connected — registering…'}
              {sp.snap.status === 'disconnected' && '⚡ Disconnected — reconnecting…'}
            </div>
            <button
              onClick={() => sp.restart()}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
                color: '#fff', padding: '3px 8px', fontSize: 10, cursor: 'pointer',
              }}
              title="Reinitialize SIP"
            >↻ Retry</button>
          </div>
          {sp.snap.errorCause && (
            <div style={{ marginTop: 4, opacity: 0.9, fontSize: 11 }}>
              {sp.snap.errorCause}
              {' '}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('lemtel:nav', { detail: 'settings' }))}
                style={{
                  marginLeft: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff', borderRadius: 6, padding: '2px 6px', fontSize: 10, cursor: 'pointer',
                }}
                title="Open Diagnostics"
              >Diagnose ↗</button>
            </div>
          )}
          {sp.snap.events && sp.snap.events.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 10, opacity: 0.75 }}>
                Show last {sp.snap.events.length} SIP events
              </summary>
              <div style={{
                marginTop: 4, maxHeight: 140, overflowY: 'auto',
                fontFamily: 'JetBrains Mono, Menlo, monospace', fontSize: 10,
                background: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: 6,
              }}>
                {sp.snap.events.slice().reverse().map((ev, i) => (
                  <div key={i} style={{
                    color: ev.level === 'error' ? '#fca5a5' : ev.level === 'warn' ? '#fcd34d' : '#a7f3d0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {new Date(ev.at).toLocaleTimeString()} · {ev.message}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}




      {/* CONTENT */}
      <div className="lemtel-scroll" style={{
        flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1,
        padding: ringing || inCall ? 0 : compact ? '12px 10px 10px' : '20px 16px 12px',
        minWidth: 0,
      }}>
        {/* Incoming */}
        {sp.snap.callState === 'ringing-in' && (
          <IncomingCall
            who={sp.snap.remoteIdentity || sp.snap.remoteNumber || 'Unknown'}
            number={sp.snap.remoteNumber}
            onAnswer={() => { setTimeout(() => { try { sp.answer(); } catch (e) { console.warn('[softphone] answer failed', e); } }, 0); }}
            onDecline={sp.hangup}
          />
        )}

        {/* Outgoing */}
        {sp.snap.callState === 'ringing-out' && (
          <CallingState
            who={sp.snap.remoteNumber || dial}
            onHangup={sp.hangup}
          />
        )}

        {/* Active / Held */}
        {inCall && (
          <ActiveCall
            sp={sp}
            timer={fmt(timer)}
            showDTMF={showDTMF}
            toggleDTMF={() => setShowDTMF((v) => !v)}
            dialKeys={dialKeys}
            onTransfer={(m) => { setXferMode(m); setShowXfer(true); }}
            compact={compact}
            audioEl={audioRef.current}
            activeOutputLabel={activeOutputLabel}
            autoResetOutput={autoResetOutput}
            onAutoResetChange={(v: boolean) => {
              setAutoResetOutput(v);
              try { localStorage.setItem('lemtel.autoResetOutput', String(v)); } catch {}
            }}
            onActiveOutputLabel={setActiveOutputLabel}
          />
        )}


        {/* Mic permission prompt */}
        {!inCall && !ringing && micPermission === 'denied' && (
          <div style={{
            margin: '12px 16px',
            padding: '14px 16px',
            borderRadius: 10,
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.35)',
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: 18 }}>🎤 Microphone Access Required</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Allow microphone access to make calls. On macOS, enable Lemtel Telecom in System Preferences → Privacy → Microphone.
            </div>
            <button onClick={requestMic} style={{
              background: 'linear-gradient(135deg, #003DA6, #7C3AED)',
              border: 'none', borderRadius: 8, color: 'white',
              padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>Allow Microphone</button>
          </div>
        )}

        {/* Idle — Keypad (Dialer) */}
        {!inCall && !ringing && tab === 'keypad' && (
          <Dialer
            dial={dial} setDial={setDial}
            dialKeys={dialKeys}
            onCall={handleCall}
            canCall={dial.length >= 3 && sipReady && !callBusy && micPermission !== 'denied'}
            sipRegistered={sipReady}
            extension={creds.extension}
            compact={compact}
            ultraCompact={ultraCompact}
          />
        )}

        {/* Chats (SMS) */}
        {!inCall && !ringing && tab === 'chats' && (
          <div style={{ animation: 'fadeIn .25s ease-out' }}>
            <SmsThreads />
          </div>
        )}

        {/* Calls — avec sous-onglets Recents / Recordings / Voicemail */}
        {!inCall && !ringing && tab === 'calls' && (
          <div style={{ animation: 'fadeIn .25s ease-out', display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Sous-onglets */}
            <div style={{
              display: 'flex', gap: 6, padding: compact ? '8px 10px 4px' : '10px 14px 6px',
              flexShrink: 0,
            }}>
              {(['recents', 'recordings', 'voicemail'] as CallsSubTab[]).map((st) => {
                const active = callsSubTab === st;
                const labels: Record<CallsSubTab, string> = { recents: 'Recents', recordings: 'Recordings', voicemail: 'Voicemail' };
                return (
                  <button
                    key={st}
                    onClick={() => setCallsSubTab(st)}
                    style={{
                      flex: 1, padding: '6px 4px', borderRadius: 10, fontSize: 11,
                      fontWeight: active ? 800 : 600, letterSpacing: 0.5,
                      border: active ? '1px solid rgba(0,35,230,0.25)' : '1px solid rgba(0,0,0,0.08)',
                      background: active ? 'rgba(0,35,230,0.10)' : 'rgba(255,255,255,0.7)',
                      color: active ? '#0023e6' : '#6b7a99',
                      cursor: 'pointer',
                      transition: 'all .18s ease',
                    }}
                  >{labels[st]}</button>
                );
              })}
            </div>
            {/* Contenu du sous-onglet */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {callsSubTab === 'recents' && (
                <AppErrorBoundary compact onBack={() => setCallsSubTab('recents')}>
                  <RecentsList extension={creds.extension} onCall={(n) => { setDial(n); sp.call(n); }} />
                </AppErrorBoundary>
              )}
              {callsSubTab === 'recordings' && (
                <AppErrorBoundary compact onBack={() => setCallsSubTab('recents')}>
                  <RecordingsList extension={creds.extension} />
                </AppErrorBoundary>
              )}
              {callsSubTab === 'voicemail' && (
                <AppErrorBoundary compact onBack={() => setCallsSubTab('recents')}>
                  <VoicemailList extension={creds.extension} onCall={(n) => { setDial(n); sp.call(n); }} />
                </AppErrorBoundary>
              )}
            </div>
          </div>
        )}

        {/* Contacts */}
        {!inCall && !ringing && tab === 'contacts' && (
          <div style={{ animation: 'fadeIn .25s ease-out', minWidth: 0, width: '100%' }}>
            <ContactsList selfExtension={creds.extension} onCall={(n) => { setDial(n); sp.call(n); }} />
          </div>
        )}

        {/* Speed Dial */}
        {!inCall && !ringing && tab === 'speeddial' && (
          <div style={{ animation: 'fadeIn .25s ease-out' }}>
            <SpeedDialPane sp={sp} onCall={(n) => { setDial(n); sp.call(n); }} />
          </div>
        )}

        {/* AVA Chat (overlay) */}
        {showAvaChat && !inCall && !ringing && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: '#f0f4ff', display: 'flex', flexDirection: 'column',
          }}>
            <AvaChatPane onClose={() => setShowAvaChat(false)} />
          </div>
        )}

      </div>

      {/* BOTTOM TABS */}
      {!inCall && !ringing && !hideTabs && (
        <div style={{
          position: 'relative', zIndex: 1, flexShrink: 0,
          padding: compact ? '6px 6px 6px' : '8px 8px 8px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,247,255,0.86) 100%)',
          backdropFilter: 'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          borderTop: '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 -4px 24px -8px rgba(7,22,168,0.18), 0 -1px 0 rgba(0,35,230,0.05) inset',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            alignItems: 'center',
            height: ultraCompact ? 50 : compact ? 56 : 64,
            minWidth: 0,
            width: '100%',
          }}>
            {MAIN_TABS.map((tk) => {
              const active = tab === tk;
              const { LucideIcon, label } = TAB_META[tk];
              const accent = '#0023e6';
              const inactiveColor = '#6b7a99';
              return (
                <button
                  key={tk}
                  onClick={() => { setTab(tk); if (showAvaChat) setShowAvaChat(false); }}
                  title={label}
                  aria-label={label}
                  style={{
                    position: 'relative',
                    minHeight: ultraCompact ? 42 : compact ? 48 : 54,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 3, padding: compact ? '4px 2px' : '6px 2px',
                    borderRadius: 12,
                    background: active
                      ? `linear-gradient(180deg, rgba(0,35,230,0.13) 0%, rgba(255,255,255,0.4) 100%)`
                      : 'transparent',
                    border: active ? '1px solid rgba(0,35,230,0.20)' : '1px solid transparent',
                    boxShadow: active
                      ? '0 8px 20px -10px rgba(0,35,230,0.40), 0 1px 0 rgba(255,255,255,0.9) inset'
                      : 'none',
                    color: active ? accent : inactiveColor,
                    cursor: 'pointer',
                    transition: 'all .22s cubic-bezier(.34,1.56,.64,1)',
                    transform: active ? 'translateY(-2px)' : 'translateY(0)',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLButtonElement;
                    if (!active) { el.style.color = accent; el.style.background = 'rgba(0,35,230,0.06)'; }
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLButtonElement;
                    if (!active) { el.style.color = inactiveColor; el.style.background = 'transparent'; }
                  }}
                >
                  <span style={{
                    position: 'relative',
                    display: 'grid', placeItems: 'center',
                    width: compact ? 24 : 28, height: compact ? 24 : 28, borderRadius: 10,
                    background: active
                      ? `radial-gradient(circle at 30% 30%, rgba(0,35,230,0.20), rgba(0,35,230,0.08) 70%)`
                      : 'transparent',
                  }}>
                    <LucideIcon size={ultraCompact ? 16 : compact ? 18 : 20} strokeWidth={active ? 2.6 : 2} color={active ? accent : 'currentColor'} />
                  </span>
                  {!ultraCompact && (
                    <span style={{
                      fontSize: compact ? 9 : 10,
                      fontWeight: active ? 800 : 600,
                      letterSpacing: 0.3,
                      maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}




      {/* Transfer modal */}
      {showXfer && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          backdropFilter: 'blur(8px)',
        }} onClick={() => setShowXfer(false)}>
          <div
            style={{
              background: 'rgba(15,15,30,0.95)', border: `1px solid ${c.borderGold}`,
              borderRadius: 16, padding: 20, width: 300,
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: c.gold }}>
              {xferMode === 'blind' ? '↪ Blind transfer' : '↗ Attended transfer'}
            </div>
            <input
              autoFocus
              className="lemtel-input"
              value={xferTarget}
              onChange={(e) => setXferTarget(e.target.value)}
              placeholder="Extension or number"
              onKeyDown={(e) => e.key === 'Enter' && handleXferSubmit()}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowXfer(false)} style={ghostBtn}>Cancel</button>
              <button onClick={handleXferSubmit} className="lemtel-btn-primary" style={{ ...ghostBtn, color: '#fff', border: 'none' }}>
                {xferMode === 'blind' ? 'Transfer' : 'Start consult'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{
        position: 'relative', zIndex: 1, flexShrink: 0,
        padding: compact ? '7px 8px 8px' : '12px 14px 14px',
        textAlign: 'center',
        borderTop: `1px solid ${c.border}`,
        background: c.bg,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 3 : 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: compact ? 6 : 8, minWidth: 0, maxWidth: '100%', flexWrap: 'wrap' }}>
          <LemtelLogo size="xs" glow />
          <BrandTagline size="sm" showPoweredBy={false} style={{ marginTop: 0, minWidth: 0 }} />
        </div>
        <div style={{ fontSize: compact ? 9 : 10, color: c.textDim, letterSpacing: 0.5 }}>
          v{APP_VERSION} {ultraCompact ? '' : '· Powered by '}
          <a
            onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://assistantvirtualai.com'); }}
            href="#"
            style={{ color: c.gold, textDecoration: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            {ultraCompact ? 'AVA Statistic' : 'AVA Statistic · assistantvirtualai.com'}
          </a>
        </div>
      </div>

    </div>
  );
}


/* ============================================================
   Sub-components
   ============================================================ */

const Dialer = React.memo(function Dialer({
  dial, setDial, dialKeys, onCall, canCall, sipRegistered = true, extension, compact = false, ultraCompact = false,
}: {
  dial: string; setDial: (s: string | ((p: string) => string)) => void;
  dialKeys: [string, string][]; onCall: () => void; canCall: boolean;
  sipRegistered?: boolean; extension: string;
  compact?: boolean; ultraCompact?: boolean;
}) {
  // Stable handlers so the memoized DialerKeypad below doesn't re-render
  // on every keystroke (which was causing the wide-mode freeze).
  const handleKey = useCallback((k: string) => setDial((p) => p + k), [setDial]);
  const handleBackspace = useCallback(() => setDial((p) => p.slice(0, -1)), [setDial]);
  const handleClear = useCallback(() => setDial(''), [setDial]);
  const handleSubmit = useMemo(() => (canCall ? onCall : undefined), [canCall, onCall]);
  const density = ultraCompact ? 'ultra' : compact ? 'compact' : 'spacious';

  return (
    <div style={{ animation: 'fadeIn .25s ease-out', padding: compact ? '2px 0 8px' : '4px 4px 8px', minWidth: 0 }}>
      <CallForwarding extension={extension} />

      {/* Number display — premium glass tile */}
      <div style={{
        margin: compact ? '4px auto 16px' : '4px auto 22px', maxWidth: 320,
        width: '100%', boxSizing: 'border-box',
        padding: compact ? '14px 12px' : '18px 20px', borderRadius: 18,
        background: c.bgElev,
        border: `1px solid ${c.border}`,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -16px rgba(0,35,230,0.18)',
        textAlign: 'center', minHeight: 64,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
      }}>
        <div
          className="ava-display-num"
          style={{
            fontSize: compact ? 26 : 32, letterSpacing: compact ? 0.4 : 0.8, fontWeight: 600,
            lineHeight: 1.05,
            color: dial ? c.text : c.textDim,
            textShadow: dial ? '0 0 22px rgba(33,212,253,0.30)' : 'none',
            minHeight: 36,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
          {dial || 'Enter a number'}
        </div>
        {dial && (
          <div style={{ fontSize: 9.5, color: c.signalGold, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, opacity: 0.92 }}>
            Ready to dial · ext {extension}
          </div>
        )}
      </div>

      {/* Dialpad — locked baselines via DialerKeypad */}
      <div style={{ margin: compact ? '0 auto 16px' : '0 auto 26px', width: '100%' }}>
        <MemoKeypad
          density={density}
          onKey={handleKey}
          onBackspace={handleBackspace}
          onSubmit={handleSubmit}
        />
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        <button
          onClick={handleClear}
          disabled={!dial}
          style={{
            background: 'none', border: 'none',
            color: dial ? c.textSub : 'transparent',
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
            cursor: dial ? 'pointer' : 'default', padding: 8, width: 56,
            transition: 'color 120ms ease',
          }}
          title="Clear"
        >Clear</button>

        <button
          onClick={onCall}
          disabled={!canCall}
          className={canCall ? 'lemtel-glass' : undefined}
          title={canCall && !sipRegistered ? 'SIP connecting — call may fail' : undefined}
          style={{
            width: 78, height: 78, borderRadius: '50%',
            background: !canCall
              ? 'rgba(120,120,140,0.18)'
              : sipRegistered
                ? 'linear-gradient(135deg, #059669, #10B981)'
                : 'linear-gradient(135deg, #D97706, #F59E0B)',
            border: canCall ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 28,
            cursor: canCall ? 'pointer' : 'not-allowed',
            opacity: canCall ? 1 : 0.4,
            boxShadow: !canCall
              ? 'none'
              : sipRegistered
                ? '0 4px 20px rgba(16,185,129,0.5), inset 0 1px 0 rgba(255,255,255,0.28)'
                : '0 4px 20px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.28)',
            transition: 'transform .18s ease, box-shadow .18s ease',
            display: 'grid', placeItems: 'center',
          }}
          onMouseEnter={(e) => { if (canCall) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
          aria-label="Call"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.9.36 1.78.7 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.82.34 1.7.57 2.6.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </button>

        <button
          onClick={handleBackspace}
          disabled={!dial}
          style={{
            background: 'none', border: 'none', color: dial ? c.textSub : 'transparent',
            fontSize: 22, cursor: dial ? 'pointer' : 'default', padding: 8, width: 56,
          }}
          aria-label="Backspace"
        >⌫</button>
      </div>
    </div>
  );
});

// Memoized keypad — stable handler refs above keep this from re-rendering on
// every parent state tick, which fixes the wide-screen dialer freeze.
const MemoKeypad = React.memo(DialerKeypad);


function CallingState({ who, onHangup }: { who: string; onHangup: () => void }) {
  return (
    <div style={callViewStyle}>
      <div style={{ position: 'relative', marginBottom: 22 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `2px solid ${c.gold}`,
            animation: `ripple 1.8s ${i * 0.6}s ease-out infinite`,
          }} />
        ))}
        <div style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'linear-gradient(135deg, #003DA6, #7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 42, color: '#fff', boxShadow: glow.blue,
          position: 'relative', zIndex: 1,
        }}>☏</div>
      </div>
      <div style={{ fontSize: 11, color: c.aiLight, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>Calling…</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 32, color: c.text }}>{who}</div>
      <button onClick={onHangup} style={hangupBtn}>📵</button>
    </div>
  );
}

function IncomingCall({ who, number, onAnswer, onDecline }: { who: string; number?: string; onAnswer: () => void; onDecline: () => void }) {
  return (
    <div style={{ ...callViewStyle, animation: 'slideDown .35s ease-out' }}>
      <div style={{ position: 'relative', marginBottom: 22 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `2px solid ${c.gold}`,
            animation: `ripple 1.6s ${i * 0.5}s ease-out infinite`,
          }} />
        ))}
        <div style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'linear-gradient(135deg, #003DA6, #7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44, color: '#fff', boxShadow: glow.ai,
          position: 'relative', zIndex: 1, fontWeight: 700,
        }}>{String(who).charAt(0).toUpperCase()}</div>
      </div>
      <div style={{ fontSize: 11, color: c.gold, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>Incoming Call</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4, color: c.text }}>{who}</div>
      {number && number !== who && <div style={{ fontSize: 13, color: c.textSub, marginBottom: 32 }}>{number}</div>}
      <div style={{ display: 'flex', gap: 28, marginTop: 24 }}>
        <button onClick={onDecline} className="lemtel-glass lemtel-focus" aria-label="Decline incoming call" style={{
          ...hangupBtn, background: 'linear-gradient(135deg, #DC2626, #EF4444)', boxShadow: glow.red,
        }}>✕</button>
        <button onClick={onAnswer} className="lemtel-glass lemtel-focus" aria-label="Answer incoming call" style={{
          ...hangupBtn, background: 'linear-gradient(135deg, #059669, #10B981)', boxShadow: glow.green,
        }}>✓</button>
      </div>
    </div>
  );
}

function ActiveCall({
  sp, timer, showDTMF, toggleDTMF, dialKeys, onTransfer, compact = false, ultraCompact = false, audioEl = null,
  activeOutputLabel, autoResetOutput, onAutoResetChange, onActiveOutputLabel,
}: {
  sp: any; timer: string; showDTMF: boolean; toggleDTMF: () => void;
  dialKeys: [string, string][]; onTransfer: (m: 'blind' | 'attended') => void;
  compact?: boolean; ultraCompact?: boolean; audioEl?: HTMLAudioElement | null;
  activeOutputLabel: string; autoResetOutput: boolean;
  onAutoResetChange: (v: boolean) => void;
  onActiveOutputLabel: (label: string) => void;
}) {
  const remote = sp.snap.remoteIdentity || sp.snap.remoteNumber || 'Unknown';

  return (
    <div style={{
      ...callViewStyle,
      background: 'linear-gradient(180deg, rgba(245,248,253,0.96) 0%, rgba(230,238,250,0.98) 100%)',
      justifyContent: compact ? 'flex-start' : 'center',
      minHeight: '100%',
      padding: compact ? '18px 10px 20px' : callViewStyle.padding,
    }}>
      <div style={{
        width: compact ? 72 : 92, height: compact ? 72 : 92, borderRadius: '50%',
        background: 'linear-gradient(135deg, #003DA6, #7C3AED)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, fontWeight: 700, color: '#fff', boxShadow: glow.blue,
        marginBottom: 14,
      }}>
        {String(remote).charAt(0).toUpperCase()}
      </div>

      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 700, marginBottom: 4, color: c.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{remote}</div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 999,
        background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
        color: c.green, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
        boxShadow: glow.green, marginBottom: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.green }} />
        {sp.snap.onHold ? 'On Hold' : 'Active Call'}
      </div>
      <div className="ava-display-num" style={{
        fontSize: 26, fontWeight: 600,
        color: c.gold, letterSpacing: '0.04em', marginBottom: 4, lineHeight: 1,
      }}>{timer}</div>
      <div style={{
        fontSize: 10, color: c.textSub, letterSpacing: 0.6,
        marginBottom: 18, display: 'flex', alignItems: 'center', gap: 4,
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 10 }}>🔊</span>
        {activeOutputLabel}
      </div>

      {/* Visualizer */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: compact ? 22 : 32, marginBottom: compact ? 14 : 22 }}>
        {[0.6, 0.9, 0.4, 1, 0.7, 0.5, 0.85].map((h, i) => (
          <div key={i} style={{
            width: 4, height: `${h * 100}%`, borderRadius: 2,
            background: 'linear-gradient(180deg, #003DA6, #7C3AED)',
            animation: `wave ${0.7 + i * 0.1}s ease-in-out infinite`,
            transformOrigin: 'bottom',
          }} />
        ))}
      </div>

      {showDTMF && (
        <div role="group" aria-label="DTMF keypad" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6,
          marginBottom: 14, width: 'min(100%, 240px)',
        }}>
          {dialKeys.map(([k]) => (
            <button
              key={k}
              className="lemtel-key lemtel-glass lemtel-focus"
              onClick={() => sp.sendDTMF(k)}
              aria-label={`Send DTMF tone ${k}`}
              style={{ padding: '10px 0', fontSize: 16 }}
            >{k}</button>
          ))}
        </div>
      )}

      {/* Audio output selector */}
      <OutputDevicePicker
        audioEl={audioEl}
        compact={compact}
        onActiveLabel={onActiveOutputLabel}
        autoReset={autoResetOutput}
        onAutoResetChange={onAutoResetChange}
      />

      {/* Controls — always a continuous horizontal swipe strip when compact
          so every button stays reachable. In ultra-compact mode buttons
          collapse to icon-only (labels still exposed via aria-label + title). */}
      <div
        role="toolbar"
        aria-label="Call controls"
        aria-keyshortcuts="M H K T E"
        className={compact ? 'lemtel-control-strip' : 'lemtel-scroll'}
        style={compact ? {
          width: '100%', marginBottom: 12,
        } : {
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          width: '100%', maxWidth: 300, marginBottom: 12,
          maxHeight: '38vh', overflowY: 'auto', paddingRight: 2,
        }}
      >

        <ControlBtn iconOnly={ultraCompact} icon="🎤" label={sp.snap.muted ? 'Unmute' : 'Mute'} ariaLabel={`${sp.snap.muted ? 'Unmute microphone' : 'Mute microphone'} (shortcut M)`} active={sp.snap.muted} danger onClick={sp.snap.muted ? sp.unmute : sp.mute} />
        <ControlBtn iconOnly={ultraCompact} icon="⏸" label={sp.snap.onHold ? 'Resume' : 'Hold'} ariaLabel={`${sp.snap.onHold ? 'Resume call' : 'Place call on hold'} (shortcut H)`} active={sp.snap.onHold} warning onClick={sp.snap.onHold ? sp.unhold : sp.hold} />
        <ControlBtn iconOnly={ultraCompact} icon="#" label="Keypad" ariaLabel={`${showDTMF ? 'Hide DTMF keypad' : 'Show DTMF keypad'} (shortcut K)`} active={showDTMF} onClick={toggleDTMF} />
        <ControlBtn iconOnly={ultraCompact} icon="⏺" label={sp.recording ? 'Stop' : 'Record'} ariaLabel={sp.recording ? 'Stop recording call' : 'Start recording call'} active={sp.recording} onClick={sp.toggleRecording} />
        <ControlBtn iconOnly={ultraCompact} icon="↪" label="Blind Xfer" ariaLabel="Blind transfer call (shortcut T)" onClick={() => onTransfer('blind')} />
        <ControlBtn iconOnly={ultraCompact} icon="↗" label="Attended" ariaLabel="Attended transfer call (shortcut Shift+T)" onClick={() => onTransfer('attended')} disabled={sp.hasConsult()} active={sp.hasConsult()} />
      </div>


      {sp.hasConsult() ? (
        <div style={{ width: '100%', maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={sp.completeAttendedTransfer} className="lemtel-btn-primary lemtel-glass lemtel-focus" aria-label="Complete attended transfer" style={{
            height: 44, borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>✓ Complete Transfer</button>
          <button onClick={sp.cancelAttendedConsult} className="lemtel-glass lemtel-focus" aria-label="Cancel attended transfer consult" style={endCallBtn}>✕ Cancel Consult</button>
        </div>
      ) : (
        <button onClick={sp.hangup} className="lemtel-glass lemtel-focus" aria-label="End call" style={endCallBtn}>📵 End Call</button>
      )}
    </div>
  );
}

export function ControlBtn({
  icon, label, ariaLabel, onClick, active, danger, warning, disabled, iconOnly,
}: {
  icon: string; label: string; ariaLabel?: string; onClick: () => void;
  active?: boolean; danger?: boolean; warning?: boolean; disabled?: boolean; iconOnly?: boolean;
}) {
  // Force high-contrast white text on a translucent surface so buttons stay
  // readable on every theme (light, dark, midnight) and never blend in.
  const accent = danger ? c.red : warning ? c.yellow : c.gold;
  const bg = active
    ? `color-mix(in srgb, ${accent} 38%, rgba(0,200,200,0.18))`
    : 'rgba(255,255,255,0.10)';
  const bd = active
    ? `color-mix(in srgb, ${accent} 70%, rgba(255,255,255,0.35))`
    : 'rgba(255,255,255,0.25)';
  const col = '#ffffff';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={ariaLabel || label}
      aria-pressed={active ? true : undefined}
      data-control-btn="1"
      className={`lemtel-focus lemtel-ctrlbtn${disabled ? '' : ' lemtel-glass'}`}
      style={{
        height: iconOnly ? 48 : 44,
        width: iconOnly ? 48 : undefined,
        minWidth: iconOnly ? 48 : undefined,
        borderRadius: iconOnly ? 14 : 12,
        background: bg, border: `1px solid ${bd}`, color: col,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: iconOnly ? 0 : 6,
        fontSize: iconOnly ? 0 : 11, fontWeight: 800, letterSpacing: 0.3,
        transition: 'all .15s ease',
        boxShadow: active
          ? `0 8px 18px -10px ${accent}, inset 0 0 0 1px rgba(255,255,255,0.18)`
          : '0 6px 18px -12px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.12)',
        whiteSpace: 'nowrap',
        textShadow: '0 1px 2px rgba(0,0,0,0.55)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: iconOnly ? 20 : 14, color: '#fff' }}>{icon}</span>
      {!iconOnly && <span style={{ color: '#fff' }}>{label}</span>}
    </button>
  );
}

/* ===== shared styles ===== */

const callViewStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', minHeight: 'calc(100vh - 130px)',
  padding: '28px 20px', textAlign: 'center',
  animation: 'fadeIn .3s ease-out',
};

const hangupBtn: React.CSSProperties = {
  width: 64, height: 64, borderRadius: '50%',
  background: 'linear-gradient(135deg, #DC2626, #EF4444)',
  border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer',
  boxShadow: '0 4px 20px rgba(239,68,68,0.5)',
};

const endCallBtn: React.CSSProperties = {
  width: '100%', maxWidth: 280, height: 52, borderRadius: 14,
  background: 'linear-gradient(135deg, #DC2626, #EF4444)',
  border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
  cursor: 'pointer', boxShadow: '0 4px 20px rgba(239,68,68,0.5)',
  marginTop: 4,
};

const ghostBtn: React.CSSProperties = {
  flex: 1, height: 40, borderRadius: 10,
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.border}`,
  color: c.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// SipDiagnostics — visible status + device test + debug report download.
// ---------------------------------------------------------------------------
function SipDiagnostics({
  sp, compact, c,
}: {
  sp: ReturnType<typeof useSoftphone>;
  compact: boolean;
  c: typeof theme.colors;
}) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<{ input: string; output: string; inputs: number; outputs: number; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Hydrate bound devices on mount so labels show before first test.
  useEffect(() => {
    const b = sp.getBoundDevices?.();
    if (b) setDevices((d) => d || { input: b.input, output: b.output, inputs: 0, outputs: 0 });
  }, [sp]);

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await sp.testAudioDevices();
      setDevices(r);
    } finally {
      setTesting(false);
    }
  };

  const statusColor =
    sp.snap.status === 'registered' ? '#10B981' :
    sp.snap.status === 'error' ? '#EF4444' :
    sp.snap.status === 'disconnected' ? '#94A3B8' : '#F59E0B';

  return (
    <div style={{
      position: 'relative', zIndex: 1,
      margin: compact ? '6px 10px 0' : '8px 14px 0',
      padding: '8px 10px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${c.border}`,
      fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusColor,
          }} />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>SIP {sp.snap.status}</span>
          {sp.snap.errorCause && (
            <span title={sp.snap.errorCause} style={{
              color: '#fca5a5', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', minWidth: 0,
            }}>
              · {sp.snap.errorCause}
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${c.border}`,
            borderRadius: 6, color: c.text, fontSize: 10, padding: '3px 8px', cursor: 'pointer',
          }}
        >{open ? 'Hide' : 'Diagnostics'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={runTest} disabled={testing} style={diagBtn(c)}>
              {testing ? 'Testing…' : '🎧 Test Audio Devices'}
            </button>
            <button onClick={() => sp.downloadDebugReport()} style={diagBtn(c)}>
              ⬇ Download Debug Report
            </button>
            <button onClick={() => sp.restart()} style={diagBtn(c)}>
              ↻ Restart SIP
            </button>
          </div>
          {devices && (
            <div style={{
              padding: 6, borderRadius: 6, background: 'rgba(0,0,0,0.3)',
              fontSize: 10, color: 'rgba(235,240,255,0.85)',
              fontFamily: 'JetBrains Mono, Menlo, monospace',
            }}>
              <div>🎙  Input:  {devices.input}</div>
              <div>🔊 Output: {devices.output}</div>
              {!!devices.inputs && <div style={{ opacity: 0.6 }}>{devices.inputs} input · {devices.outputs} output device(s) detected</div>}
              {devices.error && <div style={{ color: '#fca5a5' }}>{devices.error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function diagBtn(c: typeof theme.colors): React.CSSProperties {
  return {
    flex: '1 1 auto',
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${c.border}`,
    borderRadius: 6, color: c.text,
    fontSize: 10, fontWeight: 600,
    padding: '5px 8px', cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/* ============================================================
   SpeedDialPane — Composition rapide (favoris + suggestions)
   ============================================================ */
type Favorite = { id: string; name: string; number: string };
const FAV_KEY = 'ava.speeddial.favorites';
function loadFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(list: Favorite[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch {}
}
function SpeedDialPane({ sp, onCall }: { sp: any; onCall: (n: string) => void }) {
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  useEffect(() => { setFavs(loadFavorites()); }, []);
  const addFav = (name: string, number: string) => {
    const next = [...(favs || []), { id: crypto.randomUUID(), name, number }];
    setFavs(next); saveFavorites(next);
  };
  const removeFav = (id: string) => {
    const next = (favs || []).filter((f) => f.id !== id);
    setFavs(next); saveFavorites(next);
  };
  const [newName, setNewName] = useState('');
  const [newNum, setNewNum] = useState('');
  if (favs === null) return <div style={{ padding: 16, color: c.textDim, fontSize: 12 }}>Chargement…</div>;
  return (
    <div style={{ padding: '14px 14px 20px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 12, letterSpacing: -0.2 }}>
        ⚡ Speed Dial — Favoris
      </div>
      {favs.length === 0 ? (
        <div style={{
          padding: '24px 16px', borderRadius: 14, textAlign: 'center',
          background: 'rgba(0,35,230,0.04)', border: '1px dashed rgba(0,35,230,0.20)',
          color: c.textDim, fontSize: 12,
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⭐</div>
          <div style={{ fontWeight: 700, marginBottom: 4, color: c.text }}>Aucun favori</div>
          <div>Ajoutez vos contacts les plus appelés pour les composer en un clic.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {favs.map((f) => (
            <div key={f.id} style={{
              padding: 12, borderRadius: 14,
              background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,35,230,0.12)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              boxShadow: '0 2px 8px -4px rgba(0,35,230,0.12)',
            }}>
              <button onClick={() => onCall(f.number)} style={{
                width: 52, height: 52, borderRadius: '50%', border: 'none',
                background: 'linear-gradient(135deg, #0023e6, #21d4fd)',
                color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer',
                boxShadow: '0 8px 20px -10px rgba(0,35,230,0.7)',
              }} aria-label={`Appeler ${f.name}`}>
                <Phone size={22} />
              </button>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.text, textAlign: 'center', wordBreak: 'break-word' }}>{f.name}</div>
              <div style={{ fontSize: 10, color: c.textDim, fontFamily: 'JetBrains Mono, monospace' }}>{f.number}</div>
              <button onClick={() => removeFav(f.id)} style={{
                background: 'transparent', border: 'none', color: c.textDim, fontSize: 10, cursor: 'pointer',
              }}>Retirer</button>
            </div>
          ))}
        </div>
      )}
      {/* Ajouter un favori */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.textSub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Ajouter un favori
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom"
            style={{
              flex: 1, minWidth: 80, padding: '7px 10px', borderRadius: 8, fontSize: 12,
              border: '1px solid rgba(0,35,230,0.20)', background: '#fff', color: c.text, outline: 'none',
            }}
          />
          <input
            value={newNum}
            onChange={(e) => setNewNum(e.target.value)}
            placeholder="Numéro"
            style={{
              flex: 1, minWidth: 80, padding: '7px 10px', borderRadius: 8, fontSize: 12,
              border: '1px solid rgba(0,35,230,0.20)', background: '#fff', color: c.text, outline: 'none',
            }}
          />
          <button
            onClick={() => { if (newName && newNum) { addFav(newName, newNum); setNewName(''); setNewNum(''); } }}
            disabled={!newName || !newNum}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: newName && newNum ? 'linear-gradient(135deg, #0023e6, #4d6dff)' : 'rgba(0,0,0,0.08)',
              border: 'none', color: newName && newNum ? '#fff' : c.textDim, cursor: newName && newNum ? 'pointer' : 'not-allowed',
            }}
          >+ Ajouter</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   AvaChatPane — Assistant IA AVA (comme AVAChatScreen mobile)
   ============================================================ */
type AvaMsg = { id: string; role: 'user' | 'assistant'; text: string; pending?: boolean };
const AVA_SUGGESTIONS = [
  "Combien d'appels avons-nous reçus aujourd'hui ?",
  "Qui a manqué le plus d'appels cette semaine ?",
  "Résume le dernier appel enregistré",
  "Quelle est la durée moyenne des appels ?",
];
function AvaChatPane({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<AvaMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);
  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    const userMsg: AvaMsg = { id: 'u' + Date.now(), role: 'user', text };
    const placeholder: AvaMsg = { id: 'a' + Date.now(), role: 'assistant', text: '', pending: true };
    setMsgs((m) => [...m, userMsg, placeholder]);
    setInput(''); setBusy(true);
    try {
      const res = await fetch(`https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/ava-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdlanhpc3JxdHZ4YXZicmZjb3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDMxNzQsImV4cCI6MjA3NzA3OTE3NH0.kaO-GslE99OCNrZ4_AMnbzGqya2azqz_UMZR34zZvvo',
          ...(localStorage.getItem('sb-gejxisrqtvxavbrfcoxz-auth-token')
            ? { Authorization: `Bearer ${JSON.parse(localStorage.getItem('sb-gejxisrqtvxavbrfcoxz-auth-token') || '{}')?.access_token || ''}` }
            : {}),
        },
        body: JSON.stringify({ message: text, history: msgs.map((m) => ({ role: m.role, content: m.text })) }),
      });
      const data = res.ok ? await res.json() : null;
      const reply = data?.answer || "Je suis en mode démo — connectez-vous à votre espace AVA pour poser des questions sur votre PBX.";
      setMsgs((m) => m.map((x) => x.id === placeholder.id ? { ...x, text: reply, pending: false } : x));
    } catch (e: any) {
      setMsgs((m) => m.map((x) => x.id === placeholder.id ? { ...x, text: `Désolé — ${e.message || 'AVA est indisponible.'}`, pending: false } : x));
    } finally {
      setBusy(false);
      setTimeout(() => taRef.current?.focus(), 50);
    }
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f0f4ff' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 10,
        background: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7a4cff, #21d4fd)',
          display: 'grid', placeItems: 'center', fontSize: 16, color: '#fff',
          boxShadow: '0 4px 14px rgba(122,76,255,0.40)',
          flexShrink: 0,
        }}>✦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0d1426', letterSpacing: -0.3 }}>AVA</div>
          <div style={{ fontSize: 10, color: '#6b7a99' }}>Assistant IA · données PBX en direct</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.10)',
            color: '#6b7a99', cursor: 'pointer', borderRadius: 8,
            width: 28, height: 28, display: 'grid', placeItems: 'center', fontSize: 16,
          }}
          aria-label="Fermer AVA"
        >×</button>
      </div>
      {/* Transcript */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 12px' }}>
        {msgs.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1426', marginBottom: 10 }}>
              Posez n'importe quelle question à AVA sur votre système téléphonique.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {AVA_SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} style={{
                  textAlign: 'left', padding: '11px 13px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(122,76,255,0.25)',
                  color: '#0d1426', fontSize: 12, cursor: 'pointer',
                  boxShadow: '0 2px 8px -4px rgba(122,76,255,0.15)',
                }}>
                  <span style={{ color: '#7a4cff', marginRight: 8 }}>✦</span>{s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} style={{
            display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 10,
          }}>
            <div style={{
              maxWidth: '82%',
              padding: '10px 13px',
              borderRadius: 14,
              background: m.role === 'user'
                ? 'linear-gradient(135deg, #0023e6, #4d6dff)'
                : 'rgba(255,255,255,0.92)',
              color: m.role === 'user' ? '#fff' : '#0d1426',
              fontSize: 12, lineHeight: 1.5,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              border: m.role === 'assistant' ? '1px solid rgba(0,0,0,0.08)' : 'none',
              boxShadow: m.role === 'assistant' ? '0 2px 8px -4px rgba(0,0,0,0.10)' : 'none',
            }}>
              {m.pending ? <span style={{ color: '#6b7a99', fontStyle: 'italic' }}>Réflexion…</span> : m.text}
            </div>
          </div>
        ))}
      </div>
      {/* Composer */}
      <div style={{
        padding: '8px 12px 12px',
        borderTop: '1px solid rgba(0,0,0,0.08)',
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(14px)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: '#fff', borderRadius: 14,
          border: '1px solid rgba(0,35,230,0.15)',
          padding: 6, boxShadow: '0 2px 8px -4px rgba(0,35,230,0.12)',
        }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message AVA…"
            rows={1}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{
              flex: 1, resize: 'none', border: 'none', outline: 'none',
              padding: '8px 6px', fontSize: 12, fontFamily: 'inherit',
              background: 'transparent', color: '#0d1426', maxHeight: 120,
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            aria-label="Envoyer"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              border: 'none', cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
              background: input.trim() && !busy ? 'linear-gradient(135deg, #7a4cff, #21d4fd)' : 'rgba(0,0,0,0.08)',
              color: '#fff', fontSize: 16, display: 'grid', placeItems: 'center',
              flexShrink: 0,
            }}
          >↑</button>
        </div>
      </div>
    </div>
  );
}
