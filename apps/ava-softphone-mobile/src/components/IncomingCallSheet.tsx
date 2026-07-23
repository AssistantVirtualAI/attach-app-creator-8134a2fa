import React from 'react';
import { colors } from '../lib/theme';
import { formatSipParty } from '../lib/sip/formatSipParty';

interface Props {
  open: boolean;
  callerName?: string;
  callerNumber?: string;
  onAccept: () => void;
  onDecline: () => void;
  onReplySms?: (text: string) => void;
}

/**
 * Full-screen incoming call sheet (Phase 6).
 * Native-feeling slide-up with accept / decline / SMS-reply quick actions.
 */
export default function IncomingCallSheet({ open, callerName, callerNumber, onAccept, onDecline, onReplySms }: Props) {
  const [replying, setReplying] = React.useState(false);
  const quickReplies = ["Can't talk now", "Call you back", "On my way"];

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'linear-gradient(180deg, #0b1220 0%, #060912 100%)',
            color: colors.textIce,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            paddingTop: 'calc(var(--safe-top) + 80px)',
            paddingBottom: 'calc(var(--safe-bottom) + 40px)',
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.7 }}>Incoming call</div>
          <div style={{ fontSize: 28, fontWeight: 600, marginTop: 12 }}>{callerName || 'Unknown'}</div>
          <div style={{ fontSize: 16, opacity: 0.8, marginTop: 4 }}>{callerNumber}</div>

          <div style={{
            width: 140, height: 140, borderRadius: '50%', marginTop: 40,
            background: 'rgba(0,35,230,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 48,
          }}>📞</div>

          {replying ? (
            <div style={{ marginTop: 'auto', width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickReplies.map((q) => (
                <button key={q} onClick={() => { onReplySms?.(q); onDecline(); }}
                  style={replyBtn}>{q}</button>
              ))}
              <button onClick={() => setReplying(false)} style={{ ...replyBtn, opacity: 0.6 }}>Cancel</button>
            </div>
          ) : (
            <div style={{
              marginTop: 'auto', width: '100%', padding: 24,
              display: 'flex', justifyContent: 'space-around', alignItems: 'center',
            }}>
              <ActionButton color="#ef4444" label="Decline" onClick={onDecline}>✕</ActionButton>
              <ActionButton color="#64748b" label="SMS" onClick={() => setReplying(true)}>💬</ActionButton>
              <ActionButton color="#22c55e" label="Accept" onClick={onAccept}>✓</ActionButton>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ActionButton({ color, label, onClick, children }: any) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer',
    }}>
      <span style={{
        width: 64, height: 64, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 600,
      }}>{children}</span>
      <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>
    </button>
  );
}

const replyBtn: React.CSSProperties = {
  width: '100%', padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 15, textAlign: 'left', cursor: 'pointer',
};
