import React, { useEffect, useRef, useState } from 'react';
import { useCallBus } from '../../hooks/useCallBus';
import { theme } from '../../lib/theme';

const { colors: c } = theme;

/** Visual auto-dismiss window (ms). Purely cosmetic: the call keeps ringing. */
const DISMISS_MS = 4000;

export default function IncomingCallToast() {
  const { call, answer, hangup } = useCallBus();
  const incoming = !!call && call.status === 'incoming';
  const callKey = incoming ? (call!.id ?? `${call!.number}-${call!.status}`) : null;
  const [hidden, setHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset + arm the visual auto-dismiss for each new incoming call.
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setHidden(false);
    if (!callKey) return;
    timer.current = setTimeout(() => setHidden(true), DISMISS_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [callKey]);

  if (!incoming || hidden) return null;

  const initials = (call!.displayName || call!.number || '?')
    .replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '').join('') || '#';

  return (
    <div
      role="alert"
      className="ava-slide-in-right"
      onMouseEnter={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }}
      style={{
        position: 'fixed', top: 60, right: 24, zIndex: 9999,
        width: 340, padding: 18, paddingBottom: 20, borderRadius: 20,
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${c.bgElev}, ${c.bgCard})`,
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
            {call!.displayName || 'Unknown'}
          </div>
          <div className="ava-mono" style={{ fontSize: 12, color: c.mutedSilver }}>
            {call!.number}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          className="ava-press"
          onClick={answer}
          style={btn(`linear-gradient(135deg, ${c.success}, ${c.green})`, c.bgElev, `0 6px 20px -8px ${c.success}99`)}>
          Answer ⏎
        </button>
        <button
          className="ava-press"
          onClick={hangup}
          style={btn(`linear-gradient(135deg, ${c.danger}, ${c.red})`, c.textIce, `0 6px 20px -8px ${c.danger}80`)}>
          Decline ⎋
        </button>
      </div>
      {/* auto-dismiss progress bar */}
      <div aria-hidden style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
        background: `${c.success}1f`,
      }}>
        <div
          className="ava-toast-progress"
          style={{ height: '100%', background: `linear-gradient(90deg, ${c.success}, ${c.cyan})`, animationDuration: `${DISMISS_MS}ms` }}
        />
      </div>
    </div>
  );
}

const btn = (bg: string, color: string, shadow: string): React.CSSProperties => ({
  flex: 1, padding: '10px 12px', borderRadius: 12,
  background: bg, border: 'none', color, fontSize: 12, fontWeight: 800,
  cursor: 'pointer', letterSpacing: 0.4, boxShadow: shadow,
});
