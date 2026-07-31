import React, { useEffect, useMemo, useState } from 'react';
import { theme } from '../../lib/theme';
import type { ConsoleView } from './LeftRail';

const { colors: c } = theme;

interface Item {
  id: string;
  title: string;
  subtitle: string;
  kind: 'view' | 'contact' | 'recent' | 'transcript';
  view?: ConsoleView;
}

const STATIC: Item[] = [
  { id: 'v-home', title: 'Home', subtitle: 'Command center', kind: 'view', view: 'home' },
  { id: 'v-dialer', title: 'Dialer', subtitle: 'Place a call', kind: 'view', view: 'dialer' },
  { id: 'v-calls', title: 'Calls', subtitle: 'Call history & recordings', kind: 'view', view: 'calls' },
  { id: 'v-messages', title: 'Messages', subtitle: 'SMS / MMS inbox', kind: 'view', view: 'messages' },
  { id: 'v-voicemail', title: 'Voicemail', subtitle: 'New & saved', kind: 'view', view: 'voicemail' },
  { id: 'v-ai', title: 'AVA AI', subtitle: 'Intelligence workspace', kind: 'view', view: 'ai' },
  { id: 'v-contacts', title: 'Contacts', subtitle: 'Directory', kind: 'view', view: 'contacts' },
  { id: 'v-admin', title: 'Admin', subtitle: 'Extensions, devices, IVR', kind: 'view', view: 'admin' },
  { id: 'c-marie', title: 'Marie Tremblay', subtitle: '+1 514 555 0182 · Contact', kind: 'contact' },
  { id: 'c-acme', title: 'Acme Corp', subtitle: '+1 438 555 0199 · Client', kind: 'contact' },
  { id: 'r-1', title: 'Missed call · Unknown', subtitle: 'Today 10:42 · 0:00', kind: 'recent' },
  { id: 't-1', title: 'Renewal opportunity', subtitle: 'Transcript · Acme Corp · yesterday', kind: 'transcript' },
];

export default function CommandPalette({
  open, onClose, onNavigate,
}: { open: boolean; onClose: () => void; onNavigate: (v: ConsoleView) => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => { if (open) { setQ(''); setIdx(0); } }, [open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return STATIC.slice(0, 8);
    return STATIC.filter((i) => i.title.toLowerCase().includes(s) || i.subtitle.toLowerCase().includes(s)).slice(0, 10);
  }, [q]);

  if (!open) return null;

  const submit = (item: Item) => {
    if (item.view) onNavigate(item.view);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 200,
        background: 'rgba(5,8,22,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '92vw',
          background: c.deepPanel,
          border: `1px solid ${c.borderGold}`,
          borderRadius: 14,
          boxShadow: '0 24px 60px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,230,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${c.border}` }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.signalGold} strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && results[idx]) submit(results[idx]);
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Search contacts, calls, transcripts, settings…"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: c.textIce, fontSize: 14, outline: 'none',
            }}
          />
          <kbd style={{ fontSize: 9.5, padding: '3px 6px', borderRadius: 4, background: c.overlay06, color: c.textSub }}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && (
            <div style={{ padding: '24px 18px', textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>
              No matches.
            </div>
          )}
          {results.map((r, i) => {
            const active = i === idx;
            return (
              <button
                key={r.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => submit(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', padding: '10px 12px',
                  background: active ? 'rgba(255,230,0,0.08)' : 'transparent',
                  border: 'none', borderRadius: 8,
                  color: c.textIce, fontSize: 12.5, cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: r.kind === 'view' ? 'rgba(255,230,0,0.12)' :
                              r.kind === 'transcript' ? 'rgba(122,76,255,0.18)' :
                              'rgba(35,214,255,0.12)',
                  display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 800,
                  color: r.kind === 'view' ? c.signalGold :
                         r.kind === 'transcript' ? c.avaViolet : c.avaCyan,
                }}>{r.kind[0].toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div style={{ fontSize: 10.5, color: c.mutedSilver, marginTop: 1 }}>{r.subtitle}</div>
                </span>
                {active && <span style={{ fontSize: 10, color: c.signalGold, letterSpacing: 1 }}>↵</span>}
              </button>
            );
          })}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '8px 14px', borderTop: `1px solid ${c.border}`,
          fontSize: 10, color: c.textSub,
        }}>
          <span>↑ ↓ to navigate · ↵ to select</span>
          <span>Global Search</span>
        </div>
      </div>
    </div>
  );
}
