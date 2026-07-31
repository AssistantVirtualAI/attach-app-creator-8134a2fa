import React, { useEffect, useState } from 'react';
import { useCallBus } from '../../hooks/useCallBus';
import { theme } from '../../lib/theme';
import { useTranslation } from '../../lib/i18n';

const { colors: c } = theme;

export default function ActiveCallDock() {
  const { call, hangup, mute, hold } = useCallBus();
  const { t } = useTranslation();
  const [, force] = useState(0);

  useEffect(() => {
    if (!call?.startedAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [call?.startedAt]);

  if (!call || (call.status !== 'active' && call.status !== 'held')) return null;

  const secs = call.startedAt ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');

  return (
    <div style={{
      position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9998, width: 460,
      padding: '12px 16px', borderRadius: 24,
      background: 'var(--ava-surface-elev, rgba(12,20,48,0.96))',
      backdropFilter: 'blur(28px) saturate(160%)',
      WebkitBackdropFilter: 'blur(28px) saturate(160%)',
      border: `1px solid ${call.status === 'held' ? c.warning + '60' : c.success + '50'}`,
      boxShadow: 'var(--ava-shadow, 0 24px 60px -20px rgba(0,0,0,0.55))',

      display: 'flex', alignItems: 'center', gap: 12, color: c.textIce,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: call.status === 'held' ? c.warning : c.success,
        boxShadow: `0 0 10px ${call.status === 'held' ? c.warning : c.success}`,
        animation: 'pulse 1.5s ease-in-out infinite',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: c.textIce }}>
          {call.displayName || call.number}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 10.5, color: c.mutedSilver }}>
            {call.status === 'held' ? t('dialer.onHold') : t('dialer.inCall')}
          </span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 800,
            letterSpacing: 0.5, color: call.status === 'held' ? c.warning : c.success,
          }}>{mm}:{ss}</span>
        </div>
      </div>

      <DockBtn label={call.muted ? t('dialer.unmute') : t('dialer.mute')} active={call.muted} accent={c.warning} onClick={() => mute(!call.muted)} hint="⌘M" />
      <DockBtn label={call.status === 'held' ? t('dialer.resume') : t('dialer.hold')} active={call.status === 'held'} accent={c.avaCyan} onClick={() => hold(call.status !== 'held')} hint="⌘H" />
      <button onClick={hangup} style={{
        padding: '7px 14px', borderRadius: 9,
        background: `linear-gradient(135deg, ${c.danger}, #b21a30)`,
        border: 'none', color: c.textIce, fontSize: 11, fontWeight: 800,
        cursor: 'pointer', letterSpacing: 0.4,
      }}>{t('dialer.end')}</button>
    </div>
  );
}

function DockBtn({ label, active, accent, onClick, hint }: { label: string; active: boolean; accent: string; onClick: () => void; hint: string }) {
  return (
    <button onClick={onClick} title={hint} style={{
      padding: '7px 11px', borderRadius: 9,
      background: active ? `${accent}22` : c.overlay04,
      border: `1px solid ${active ? accent + '90' : c.border}`,
      color: active ? accent : c.mutedSilver,
      fontSize: 11, fontWeight: 700, cursor: 'pointer',
    }}>{label}</button>
  );
}
