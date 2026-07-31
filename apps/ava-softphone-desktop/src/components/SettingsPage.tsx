import React, { useEffect, useState, useCallback } from 'react';
import { WHITELABEL } from '../whitelabel.config';
import { useTheme } from '../lib/theme';
import { useBrightness, Brightness } from '../hooks/useBrightness';
import { useContrast, Contrast } from '../hooks/useContrast';
import { sipProvider } from '../lib/sip/jssipProvider';
import { theme } from '../lib/theme';
import pkg from '../../package.json';

const c = theme.colors;

const APP_VERSION = (pkg as { version?: string }).version || '2.4.3';
const PORTAL_URL = WHITELABEL.portalUrl || 'https://avastatistic.ca';

const openPortal = (path = '') => {
  const url = `${PORTAL_URL}${path}`;
  window.electronAPI?.openExternal?.(url);
};

/* ─── Shared UI primitives ─────────────────────────────────────────────── */

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginTop: 22, marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: c.textDim, marginBottom: 3 }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>{title}</div>
    </div>
  );
}

function Card({ children, padded = true }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <div style={{
      background: c.overlay04,
      border: `1px solid ${c.overlay08}`,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRadius: 14,
      overflow: 'hidden',
      ...(padded ? { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 } : {}),
    }}>
      {children}
    </div>
  );
}

function SettingsRow({
  icon, label, value, right, onPress, danger, noBorder,
}: {
  icon?: string;
  label: string;
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  noBorder?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onPress}
      onMouseEnter={() => onPress && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 16px',
        cursor: onPress ? 'pointer' : 'default',
        background: hovered ? c.overlay06 : 'transparent',
        borderBottom: noBorder ? 'none' : `1px solid ${c.overlay08}`,
        transition: 'background 120ms ease',
        minHeight: 44,
      }}
    >
      {icon && (
        <span style={{ fontSize: 16, width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: danger ? c.danger : c.text, lineHeight: 1.3 }}>
          {label}
        </div>
        {value && (
          <div style={{ fontSize: 11, color: c.textDim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value}
          </div>
        )}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      {onPress && !right && (
        <span style={{ color: c.textDim, fontSize: 14, flexShrink: 0 }}>›</span>
      )}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange?.(!on); }}
      style={{
        width: 40, height: 22, borderRadius: 999,
        background: on ? `linear-gradient(135deg, ${c.primary}, ${c.warning})` : c.overlay12,
        border: 'none', position: 'relative', cursor: 'pointer',
        transition: 'background 160ms ease', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%', background: c.onAccent,
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        transition: 'left 160ms ease',
        display: 'block',
      }} />
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'registered' ? c.success :
    status === 'error' ? c.danger :
    status === 'disconnected' ? '#94A3B8' : c.warning;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999,
      background: `${color}20`, border: `1px solid ${color}50`,
      fontSize: 11, fontWeight: 700, color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {status}
    </span>
  );
}

/* ─── Main SettingsPage ─────────────────────────────────────────────────── */

export default function SettingsPage({
  creds,
  onSignOut,
  onBack,
}: {
  creds: {
    email: string;
    extension: string;
    displayName?: string;
    sipDomain?: string;
    wssUrl?: string;
  };
  onSignOut: () => void;
  onBack: () => void;
}) {
  const { mode, setMode } = useTheme();
  const { brightness, setBrightness } = useBrightness();
  const { contrast, setContrast } = useContrast();

  /* SIP live state */
  const [sipSnap, setSipSnap] = useState(() => sipProvider.getSnapshot());
  useEffect(() => {
    const unsub = sipProvider.subscribe((s) => setSipSnap({ ...s }));
    return () => { unsub(); };
  }, []);

  /* Audio devices */
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      setMics(devs.filter((d) => d.kind === 'audioinput'));
      setSpeakers(devs.filter((d) => d.kind === 'audiooutput'));
    });
  }, []);

  /* Preferences */
  const [launchOnStartup, setLaunchOnStartup] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [incomingNotif, setIncomingNotif] = useState(true);
  const [missedNotif, setMissedNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);
  const [notifSound, setNotifSound] = useState(true);
  const [autoAnswer, setAutoAnswer] = useState(() => localStorage.getItem('ava.autoAnswer') === 'on');
  const [announceRec, setAnnounceRec] = useState(() => localStorage.getItem('ava.announceRec') !== 'off');
  const [savedToast, setSavedToast] = useState(false);

  /* SIP diagnostics */
  const [sipTestResult, setSipTestResult] = useState<{
    input: string; output: string; inputs: number; outputs: number; error?: string;
  } | null>(null);
  const [sipTesting, setSipTesting] = useState(false);
  const runSipTest = useCallback(async () => {
    setSipTesting(true);
    try {
      const r = await sipProvider.testAudioDevices();
      setSipTestResult(r);
    } finally {
      setSipTesting(false);
    }
  }, []);

  const showToast = () => { setSavedToast(true); setTimeout(() => setSavedToast(false), 2400); };

  const selStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: c.overlay04,
    border: `1px solid ${c.overlay08}`,
    borderRadius: 10, color: c.text,
    fontSize: 13, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{
      height: '100%', overflowY: 'auto', overflowX: 'hidden',
      background: 'radial-gradient(1000px 620px at 6% -12%, rgba(0,35,230,0.32), transparent 62%), radial-gradient(780px 560px at 105% 105%, rgba(224,168,0,0.18), transparent 58%), linear-gradient(180deg, #060C1C 0%, #0A1429 52%, #0E1B3D 100%)',
      scrollBehavior: 'smooth',
    }}>
      {/* Sticky header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: c.overlay04,
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        borderBottom: `1px solid ${c.overlay08}`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'rgba(0,35,230,0.20)', border: `1px solid ${c.overlay08}`,
            color: c.primary, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            padding: '5px 12px', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>Settings</span>
        {savedToast && (
          <span style={{
            marginLeft: 'auto', fontSize: 11, color: c.green,
            background: 'rgba(15,157,88,0.10)', border: `1px solid ${c.green}40`,
            borderRadius: 8, padding: '3px 10px', fontWeight: 700,
          }}>✓ Saved</span>
        )}
      </div>

      <div style={{ padding: '0 16px 40px' }}>

        {/* ── Profile card ─────────────────────────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <Card padded>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16, flexShrink: 0,
                background: `linear-gradient(135deg, ${c.primary}, ${c.primaryLight}, #21d4fd)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.onAccent, fontWeight: 800, fontSize: 22,
                boxShadow: '0 6px 18px -8px rgba(0,35,230,0.45)',
              }}>
                {(creds.displayName || creds.email || 'U')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {creds.displayName || creds.email}
                </div>
                <div style={{ fontSize: 11, color: c.textDim, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
                  Ext {creds.extension} · {creds.sipDomain || 'lemtel.tel'}
                </div>
                <div style={{ marginTop: 6 }}>
                  <StatusDot status={sipSnap.status} />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Appearance ───────────────────────────────────────────────── */}
        <SectionTitle eyebrow="APPEARANCE" title="Theme & Display" />
        <Card padded={false}>
          {/* Theme selector */}
          <div style={{ padding: '12px 16px 14px', borderBottom: `1px solid ${c.overlay08}` }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              Theme
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['daylight', 'light', 'dark', 'midnight'] as const).map((m) => {
                const active = mode === m;
                const meta: Record<string, { icon: string; label: string }> = {
                  daylight: { icon: '🌤️', label: 'Daylight' },
                  light:    { icon: '☀️', label: 'Light' },
                  dark:     { icon: '🌙', label: 'Dark' },
                  midnight: { icon: '🌑', label: 'Midnight' },
                };
                return (
                  <button
                    key={m}
                    onClick={() => { setMode(m); localStorage.setItem('ava-softphone-theme', m); showToast(); }}
                    style={{
                      flex: 1, padding: '10px 6px',
                      background: active ? 'rgba(0,35,230,0.10)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(0,35,230,0.35)' : c.border}`,
                      color: active ? c.primary : c.text,
                      borderRadius: 10, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      fontWeight: active ? 700 : 500, fontSize: 11,
                      transition: 'all 160ms ease',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{meta[m].icon}</span>
                    {meta[m].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Brightness */}
          <div style={{ padding: '12px 16px 14px', borderBottom: `1px solid ${c.overlay08}` }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              Brightness
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['dim', 'medium', 'bright'] as Brightness[]).map((b) => {
                const active = brightness === b;
                return (
                  <button
                    key={b}
                    onClick={() => setBrightness(b)}
                    style={{
                      flex: 1, padding: '9px 6px',
                      background: active ? 'rgba(255,215,0,0.12)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(255,215,0,0.45)' : c.border}`,
                      color: active ? c.gold : c.text,
                      borderRadius: 10, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      fontWeight: active ? 700 : 500, fontSize: 11,
                      transition: 'all 160ms ease',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{b === 'dim' ? '◐' : b === 'medium' ? '◑' : '◓'}</span>
                    {b === 'dim' ? 'Dim' : b === 'medium' ? 'Medium' : 'Bright'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contrast */}
          <div style={{ padding: '12px 16px 14px' }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              Contrast
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['low', 'med', 'high'] as Contrast[]).map((cc) => {
                const active = contrast === cc;
                return (
                  <button
                    key={cc}
                    onClick={() => setContrast(cc)}
                    style={{
                      flex: 1, padding: '9px 6px',
                      background: active ? 'rgba(0,82,204,0.12)' : 'transparent',
                      border: `1px solid ${active ? 'rgba(0,82,204,0.45)' : c.border}`,
                      color: active ? c.primaryLight : c.text,
                      borderRadius: 10, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      fontWeight: active ? 700 : 500, fontSize: 11,
                      transition: 'all 160ms ease',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 800 }}>Aa</span>
                    {cc === 'low' ? 'Low' : cc === 'med' ? 'Medium' : 'High'}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* ── Calls ────────────────────────────────────────────────────── */}
        <SectionTitle eyebrow="CALLS" title="Call Settings" />
        <Card padded={false}>
          <SettingsRow
            icon="⚡" label="Auto Answer"
            value={autoAnswer ? 'Enabled' : 'Disabled'}
            right={<Switch on={autoAnswer} onChange={(v) => { setAutoAnswer(v); localStorage.setItem('ava.autoAnswer', v ? 'on' : 'off'); }} />}
          />
          <SettingsRow
            icon="🔔" label="Announce Call Recording"
            value={announceRec ? 'On (recommended)' : 'Off'}
            right={<Switch on={announceRec} onChange={(v) => { setAnnounceRec(v); localStorage.setItem('ava.announceRec', v ? 'on' : 'off'); }} />}
          />
          <SettingsRow icon="↪" label="Call Forwarding" value="Manage in portal" onPress={() => openPortal('/dashboard/call-forwarding')} />
          <SettingsRow icon="📞" label="Voicemail Settings" value="Configure voicemail" onPress={() => openPortal('/dashboard/voicemail')} noBorder />
        </Card>

        {/* ── Audio ────────────────────────────────────────────────────── */}
        <SectionTitle eyebrow="AUDIO" title="Audio Devices" />
        <Card padded={false}>
          <div style={{ padding: '12px 16px 14px', borderBottom: `1px solid ${c.overlay08}` }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              🎙 Microphone
            </div>
            <select style={selStyle}>
              {mics.length === 0 && <option>Default</option>}
              {mics.map((o) => <option key={o.deviceId} value={o.deviceId}>{o.label || 'Microphone'}</option>)}
            </select>
          </div>
          <div style={{ padding: '12px 16px 14px', borderBottom: `1px solid ${c.overlay08}` }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              🔊 Speaker
            </div>
            <select style={selStyle}>
              {speakers.length === 0 && <option>Default</option>}
              {speakers.map((o) => <option key={o.deviceId} value={o.deviceId}>{o.label || 'Speaker'}</option>)}
            </select>
          </div>
          <div style={{ padding: '12px 16px 14px' }}>
            <div style={{ fontSize: 11, color: c.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              🔔 Ring Device
            </div>
            <select style={selStyle}>
              {speakers.length === 0 && <option>Default</option>}
              {speakers.map((o) => <option key={o.deviceId} value={o.deviceId}>{o.label || 'Speaker'}</option>)}
            </select>
          </div>
        </Card>

        {/* ── Notifications ────────────────────────────────────────────── */}
        <SectionTitle eyebrow="NOTIFICATIONS" title="Notifications" />
        <Card padded={false}>
          <SettingsRow icon="📞" label="Incoming Call" right={<Switch on={incomingNotif} onChange={setIncomingNotif} />} />
          <SettingsRow icon="📵" label="Missed Call" right={<Switch on={missedNotif} onChange={setMissedNotif} />} />
          <SettingsRow icon="💬" label="New SMS" right={<Switch on={smsNotif} onChange={setSmsNotif} />} />
          <SettingsRow icon="🔔" label="Notification Sound" right={<Switch on={notifSound} onChange={setNotifSound} />} noBorder />
        </Card>

        {/* ── General ──────────────────────────────────────────────────── */}
        <SectionTitle eyebrow="GENERAL" title="General" />
        <Card padded={false}>
          <SettingsRow
            icon="🚀" label="Launch on Startup"
            right={<Switch on={launchOnStartup} onChange={(v) => { setLaunchOnStartup(v); window.electronAPI?.setLaunchOnStartup?.(v); }} />}
          />
          <SettingsRow
            icon="🗕" label="Minimize to Tray on Close"
            right={<Switch on={minimizeToTray} onChange={setMinimizeToTray} />}
          />
          <SettingsRow icon="🌐" label="Language" value="English" noBorder />
        </Card>

        {/* ── Account & Extension ──────────────────────────────────────── */}
        <SectionTitle eyebrow="ACCOUNT" title="Extension & Account" />
        <Card padded={false}>
          <SettingsRow icon="📧" label="Email" value={creds.email} />
          <SettingsRow icon="☎" label="Extension" value={creds.extension} />
          <SettingsRow icon="🌐" label="SIP Domain" value={creds.sipDomain || 'lemtel.tel'} />
          <SettingsRow icon="↔" label="WSS URL" value={creds.wssUrl || '—'} />
          <SettingsRow icon="📱" label="Device" value="This device · WebRTC" noBorder />
        </Card>

        {/* ── Admin Portal ─────────────────────────────────────────────── */}
        <SectionTitle eyebrow="WORKSPACE" title="Admin Portal" />
        <Card padded={false}>
          <SettingsRow icon="👥" label="Users & Extensions" value={creds.sipDomain || 'lemtel.tel'} onPress={() => openPortal('/dashboard/team')} />
          <SettingsRow icon="#" label="Phone Numbers" value="Open portal" onPress={() => openPortal('/dashboard/phone-numbers')} />
          <SettingsRow icon="🎛" label="IVR & Routing" value="Open portal" onPress={() => openPortal('/dashboard/routing')} />
          <SettingsRow icon="🤖" label="Voice Agents" value="Open portal" onPress={() => openPortal('/dashboard/agents')} />
          <SettingsRow icon="📊" label="Dashboard" value="Open portal" onPress={() => openPortal('/dashboard')} />
          <SettingsRow icon="↻" label="Sync Status" value={sipSnap.status || 'idle'} onPress={() => sipProvider.restart()} noBorder />
        </Card>

        {/* ── SIP Diagnostics ──────────────────────────────────────────── */}
        <SectionTitle eyebrow="SIP" title="SIP Diagnostics" />
        <Card padded={false}>
          <SettingsRow icon="📡" label="Status" right={<StatusDot status={sipSnap.status} />} />
          <SettingsRow icon="⇄" label="Provider" value="jssip-wss · WebRTC" />
          <SettingsRow icon="↔" label="WSS" value={creds.wssUrl || '—'} />
          <SettingsRow icon="!" label="Last Error" value={sipSnap.errorCause || 'None'} />
          <SettingsRow icon="↻" label="Retry Registration" onPress={() => sipProvider.restart()} />
          <SettingsRow
            icon="🎧"
            label={sipTesting ? 'Testing…' : 'Test Audio Devices'}
            value={sipTestResult ? `${sipTestResult.input} · ${sipTestResult.output}` : 'Tap to run test'}
            onPress={runSipTest}
          />
          {sipTestResult && (
            <div style={{
              padding: '8px 16px 12px', fontSize: 11, color: c.textDim,
              fontFamily: 'JetBrains Mono, monospace',
              borderBottom: `1px solid ${c.overlay08}`,
            }}>
              <div>🎙 Input: {sipTestResult.input}</div>
              <div>🔊 Output: {sipTestResult.output}</div>
              <div style={{ opacity: 0.7 }}>{sipTestResult.inputs} input · {sipTestResult.outputs} output device(s)</div>
              {sipTestResult.error && <div style={{ color: c.danger }}>{sipTestResult.error}</div>}
            </div>
          )}
          <SettingsRow icon="⬇" label="Download Debug Report" onPress={() => sipProvider.downloadDebugReport()} noBorder />
        </Card>

        {/* ── Security & Privacy ───────────────────────────────────────── */}
        <SectionTitle eyebrow="PRIVACY" title="Security & Privacy" />
        <Card padded={false}>
          <SettingsRow icon="🛡" label="Data Safety" onPress={() => openPortal('/data-safety')} />
          <SettingsRow icon="📄" label="Privacy Policy" onPress={() => openPortal('/privacy')} />
          <SettingsRow icon="📜" label="Terms of Service" onPress={() => openPortal('/terms')} />
          <SettingsRow
            icon="🧹" label="Clear Cache"
            onPress={() => {
              Object.keys(localStorage)
                .filter((k) => k.startsWith('ava.aisummary.') || k.startsWith('ava.cache.'))
                .forEach((k) => localStorage.removeItem(k));
              showToast();
            }}
            noBorder
          />
        </Card>

        {/* ── Support & About ──────────────────────────────────────────── */}
        <SectionTitle eyebrow="ABOUT" title="Help & About" />
        <Card padded={false}>
          <SettingsRow
            icon="❓" label="Help & Support"
            onPress={() => window.electronAPI?.openExternal?.('mailto:support@lemtel.tel?subject=AVA%20Softphone%20support')}
          />
          <SettingsRow
            icon="🔄" label="Check for Updates"
            onPress={() => window.electronAPI?.checkForUpdates?.()}
          />
          <SettingsRow
            icon="📋" label="Release Notes"
            onPress={() => window.electronAPI?.openExternal?.('https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/releases')}
          />
          <SettingsRow
            icon="ⓘ" label={WHITELABEL.appName}
            value={`Version ${APP_VERSION} · Powered by AVA AI`}
            noBorder
          />
        </Card>

        {/* ── Sign Out ─────────────────────────────────────────────────── */}
        <div style={{ marginTop: 24 }}>
          <button
            onClick={onSignOut}
            style={{
              width: '100%', height: 48, borderRadius: 12,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.30)',
              color: c.danger,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              transition: 'background 160ms ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.14)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.08)'; }}
          >
            Sign Out
          </button>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: c.textDim, letterSpacing: 0.4 }}>
          {WHITELABEL.appName} · Powered by AVA AI · v{APP_VERSION}
        </div>

      </div>
    </div>
  );
}
