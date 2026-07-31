import React from 'react';
import { useCallBus } from '../../hooks/useCallBus';
import { theme } from '../../lib/theme';

const { colors: c } = theme;

export default function IncomingCallToast() {
  const { call, answer, hangup } = useCallBus();

  if (!call || call.status !== 'incoming') return null;

  const initials = (call.displayName || call.number || '?')
    .replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '').join('') || '#';

  return (
    <div className="ava-slide-in-right" style={{
      position: 'fixed', top: 60, right: 24, zIndex: 9999,
      width: 340, padding: 18, borderRadius: 20,
      background: 'linear-gradient(135deg, var(--ava-surface-elev, rgba(8,15,38,0.97)), var(--ava-surface, rgba(12,20,48,0.97)))',
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      border: `1px solid ${c.success}59`,
      boxShadow: `0 24px 60px -10px rgba(0,0,0,0.70), 0 0 30px ${c.success}26`,
      color: c.textIce,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="ava-pulse-badge" style={{
          width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: `${c.success}1f`,
          border: `2px solid ${c.success}`,
          boxShadow: `0 0 0 6px ${c.success}14`,
          fontSize: 15, fontWeight: 800, color: c.success,
        }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: c.signalGold, textTransform: 'uppercase' }}>
            Incoming call
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, color: c.textIce, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {call.displayName || 'Unknown'}
          </div>
          <div className="ava-mono" style={{ fontSize: 12, color: c.mutedSilver }}>
            {call.number}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          className="ava-press"
          onClick={answer}
          style={btn('linear-gradient(135deg, #22c55e, #16a34a)', '#04210f', '0 6px 20px -8px rgba(34,197,94,0.60)')}>
          Answer ⏎
        </button>
        <button
          className="ava-press"
          onClick={hangup}
          style={btn('linear-gradient(135deg, #ef4444, #dc2626)', '#fff', '0 6px 20px -8px rgba(239,68,68,0.50)')}>
          Decline ⎋
        </button>
      </div>
    </div>
  );
}

const btn = (bg: string, color: string, shadow: string): React.CSSProperties => ({
  flex: 1, padding: '10px 12px', borderRadius: 12,
  background: bg, border: 'none', color, fontSize: 12, fontWeight: 800,
  cursor: 'pointer', letterSpacing: 0.4, boxShadow: shadow,
});

