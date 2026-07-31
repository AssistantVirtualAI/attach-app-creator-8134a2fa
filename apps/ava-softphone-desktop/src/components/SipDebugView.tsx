import React, { useEffect, useState } from 'react';
import {
  sipProvider,
  isSdpWorkaroundEnabled,
  setSdpWorkaroundEnabled,
  SipAttempt,
} from '../lib/sip/jssipProvider';
import { theme } from '../lib/theme';

const { colors: c } = theme;


function fmtTime(ms: number) {
  return new Date(ms).toLocaleString();
}

function Pre({ children, max = 240 }: { children: React.ReactNode; max?: number }) {
  return (
    <pre style={{
      margin: 0, padding: 10, borderRadius: 8,
      background: 'rgba(0,0,0,0.55)', color: '#cfe', fontSize: 10.5,
      lineHeight: 1.4, maxHeight: max, overflow: 'auto',
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>{children}</pre>
  );
}

export default function SipDebugView() {
  const [tick, setTick] = useState(0);
  const [workaround, setWorkaround] = useState<boolean>(isSdpWorkaroundEnabled());
  const log = sipProvider.getAttemptLog();
  const last = log[log.length - 1];
  const sdp = sipProvider.getLastSdp();
  const failure = sipProvider.getLastFailure();

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const card: React.CSSProperties = {
    background: c.overlay04,
    border: `1px solid ${c.overlay08}`,
    borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
  };
  const label: React.CSSProperties = {
    fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)', fontWeight: 700,
  };

  return (
    <div data-tick={tick} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>SDP / codec workaround (FusionPBX 488 fix)</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
              Forces PCMU/PCMA and strips DTLS/SRTP from the offer. Turn off to send native WebRTC SDP.
            </div>
          </div>
          <button
            onClick={() => { const v = !workaround; setSdpWorkaroundEnabled(v); setWorkaround(v); }}
            style={{
              padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${workaround ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
              background: workaround ? 'rgba(34,197,94,0.18)' : c.overlay04,
              color: workaround ? '#86efac' : c.onAccent, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            }}
          >{workaround ? 'ENABLED' : 'DISABLED'}</button>
        </div>
      </section>

      {failure && (
        <section style={{ ...card, border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.08)' }}>
          <div style={label}>Last failure</div>
          <div style={{ fontWeight: 700, color: '#fda4af' }}>{failure.title}</div>
          <div style={{ fontSize: 12, color: '#fecdd3' }}>{failure.hint}</div>
          <div style={{ fontSize: 10, opacity: 0.7 }}>category: <code>{failure.category}</code></div>
        </section>
      )}

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={label}>Last call attempt</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => sipProvider.downloadDebugReport()}
              style={btnStyle()}
            >Download report</button>
            <button
              onClick={() => { sipProvider.clearAttemptLog(); setTick((n) => n + 1); }}
              style={btnStyle()}
            >Clear log</button>
          </div>
        </div>
        {!last && <div style={{ fontSize: 12, opacity: 0.6 }}>No attempts yet.</div>}
        {last && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
            <div><span style={label}>When</span><div>{fmtTime(last.at)}</div></div>
            <div><span style={label}>Direction</span><div>{last.direction}</div></div>
            <div><span style={label}>Target</span><div style={{ wordBreak: 'break-all' }}>{last.target}</div></div>
            <div><span style={label}>Outcome</span><div>{last.outcome}{last.responseCode ? ` · ${last.responseCode} ${last.responseReason || ''}` : ''}</div></div>
            <div><span style={label}>Workaround</span><div>{last.workaroundOn ? 'ON' : 'OFF'}</div></div>
            <div><span style={label}>Category</span><div>{last.category || '—'}</div></div>
          </div>
        )}
      </section>

      <section style={card}>
        <div style={label}>SDP BEFORE modifier (last attempt)</div>
        <Pre>{(last?.sdpBefore || sdp.before) || '— none captured —'}</Pre>
        <div style={label}>SDP AFTER modifier (last attempt)</div>
        <Pre>{(last?.sdpAfter || sdp.after) || '— none captured —'}</Pre>
        {last?.responseBody && (
          <>
            <div style={label}>SIP response body</div>
            <Pre max={160}>{last.responseBody}</Pre>
          </>
        )}
      </section>

      <section style={card}>
        <div style={label}>Rolling attempt log ({log.length})</div>
        <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {log.slice().reverse().map((a: SipAttempt) => (
            <div key={a.id} style={{
              fontSize: 10.5, fontFamily: 'JetBrains Mono, Menlo, monospace',
              padding: '6px 8px', borderRadius: 6,
              background: a.outcome === 'failed' ? 'rgba(244,63,94,0.12)' : c.overlay04,
              color: a.outcome === 'failed' ? '#fda4af' : '#cfe',
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}>
              <span>{new Date(a.at).toLocaleTimeString()} · {a.direction} · {a.target}</span>
              <span>{a.outcome}{a.responseCode ? ` (${a.responseCode})` : ''}{a.category ? ` · ${a.category}` : ''}</span>
            </div>
          ))}
          {log.length === 0 && <div style={{ fontSize: 11, opacity: 0.6 }}>Log is empty.</div>}
        </div>
      </section>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
    background: c.overlay06, color: c.onAccent,
    border: `1px solid ${c.overlay12}`, fontSize: 10, fontWeight: 700,
    letterSpacing: 0.5, textTransform: 'uppercase',
  };
}
