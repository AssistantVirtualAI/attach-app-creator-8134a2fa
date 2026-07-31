import React, { useEffect, useState } from 'react';
import type { SoftphoneSnapshot } from '@/lib/sip/jssipProvider';
import { theme } from '../lib/theme';

const { colors: c } = theme;

interface Props {
  snap: SoftphoneSnapshot;
  /** Fast single-flight re-registration (no teardown). */
  onRetry: () => void;
  /** Full teardown + credential refetch. */
  onFullRestart: () => void;
  onDiagnose?: () => void;
  compact?: boolean;
  notice?: string | null;
  onDismissNotice?: () => void;
}

function tone(snap: SoftphoneSnapshot) {
  if (snap.authBlocked || snap.status === 'error') {
    return { bg: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)' };
  }
  if (snap.status === 'disconnected') {
    return { bg: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.35)' };
  }
  return { bg: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' };
}

function headline(snap: SoftphoneSnapshot): string {
  if (snap.authBlocked) return `⛔ Phone line rejected (${snap.authBlocked.code})`;
  if (snap.status === 'error') return '⚠️ Phone line unavailable';
  if (snap.status === 'connecting') return '🔄 Connecting your phone line…';
  if (snap.status === 'connected') return '🔄 Almost there — registering…';
  if (snap.status === 'disconnected') return '⚡ Phone line dropped — recovering';
  return 'Phone line status';
}

function detail(snap: SoftphoneSnapshot): string {
  if (snap.authBlocked) {
    return 'The server refused your SIP credentials. Automatic retries are paused to avoid lockout — refresh credentials and retry.';
  }
  if (snap.status === 'error') {
    return snap.errorCause || 'Registration failed. Calls are on hold until the line is back.';
  }
  return 'Incoming and outgoing calls are paused until the line is registered. This usually recovers on its own.';
}

/**
 * User-facing recovery UI for a lost/failing SIP registration.
 * Shows what is happening, when the watchdog retries next, and lets the user
 * trigger a safe retry (single-flight — it never stacks REGISTER flows).
 */
export const SipRecoveryBanner: React.FC<Props> = ({
  snap, onRetry, onFullRestart, onDiagnose, compact, notice, onDismissNotice,
}) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!snap.nextRetryAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [snap.nextRetryAt]);

  const t = tone(snap);
  const secs = snap.nextRetryAt ? Math.max(0, Math.ceil((snap.nextRetryAt - Date.now()) / 1000)) : 0;

  return (
    <div style={{
      position: 'relative', zIndex: 1,
      margin: compact ? '8px 12px 0' : '10px 16px 0',
      padding: '10px 12px', borderRadius: 10,
      background: t.bg, border: t.border, color: c.text, fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{headline(snap)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRetry}
            style={{
              background: 'rgba(0,35,230,0.18)', border: `1px solid ${c.overlay18}`,
              borderRadius: 6, color: c.text, padding: '3px 8px', fontSize: 10,
              cursor: 'pointer', fontWeight: 700,
            }}
            title="Retry registration now"
          >↻ Retry now</button>
          <button
            onClick={onFullRestart}
            style={{
              background: 'transparent', border: `1px solid ${c.overlay18}`,
              borderRadius: 6, color: c.textDim, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
            }}
            title="Full restart (refetch credentials)"
          >Restart</button>
        </div>
      </div>

      <div style={{ marginTop: 4, opacity: 0.9, fontSize: 11 }}>{detail(snap)}</div>

      <div style={{ marginTop: 4, fontSize: 10, color: c.textDim }}>
        {snap.recovering && !snap.nextRetryAt && `Reconnecting… (attempt ${snap.recoveryAttempt || 1})`}
        {!!snap.nextRetryAt && `Next automatic retry in ${secs}s · attempt ${snap.recoveryAttempt || 1}`}
        {!snap.recovering && !snap.nextRetryAt && !snap.authBlocked && 'Watchdog active'}
        {onDiagnose && (
          <button
            onClick={onDiagnose}
            style={{
              marginLeft: 8, background: 'transparent', border: `1px solid ${c.overlay18}`,
              color: c.textDim, borderRadius: 6, padding: '2px 6px', fontSize: 10, cursor: 'pointer',
            }}
          >Diagnose ↗</button>
        )}
      </div>

      {notice && (
        <div style={{
          marginTop: 6, padding: '6px 8px', borderRadius: 8, fontSize: 11,
          background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>{notice}</span>
          {onDismissNotice && (
            <button
              onClick={onDismissNotice}
              style={{ background: 'transparent', border: 'none', color: c.text, cursor: 'pointer', fontSize: 12 }}
            >✕</button>
          )}
        </div>
      )}
    </div>
  );
};

export default SipRecoveryBanner;
