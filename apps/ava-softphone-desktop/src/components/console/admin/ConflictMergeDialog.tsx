// Per-field diff + KEEP/THEIRS merge dialog for optimistic-concurrency conflicts.
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../../lib/theme';

const { colors: c } = theme;

export interface ConflictField {
  key: string;
  label?: string;
  baseline: any;
  mine: any;
  theirs: any;
}

interface Props {
  title: string;
  conflicts: ConflictField[];
  onCancel: () => void;
  onResolve: (choices: Record<string, 'mine' | 'theirs'>) => void;
}

const fmt = (v: any) => {
  if (v === undefined || v === null || v === '') return <em style={{ color: c.textSub }}>(empty)</em>;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11, wordBreak: 'break-word' }}>{s.slice(0, 160)}</span>;
};

export default function ConflictMergeDialog({ title, conflicts, onCancel, onResolve }: Props) {
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>(() =>
    Object.fromEntries(conflicts.map((f) => [f.key, 'mine']))
  );

  const setAll = (v: 'mine' | 'theirs') =>
    setChoices(Object.fromEntries(conflicts.map((f) => [f.key, v])));

  const summary = useMemo(() => {
    const mine = Object.values(choices).filter((x) => x === 'mine').length;
    return `${mine} yours · ${conflicts.length - mine} portal`;
  }, [choices, conflicts.length]);

  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(2,6,20,0.65)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(820px, 100%)', maxHeight: '88vh',
        background: c.bgCard, color: c.text,
        border: `1px solid ${c.borderStrong}`, borderRadius: 14,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5)',
      }}>
        <header style={{
          padding: '14px 20px', borderBottom: `1px solid ${c.border}`,
          background: c.bgElev,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: c.text }}>⚠ Merge conflict — {title}</h2>
            <div style={{ fontSize: 11, color: c.textSub, marginTop: 2 }}>
              {conflicts.length} field{conflicts.length > 1 ? 's' : ''} changed in both places · {summary}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setAll('mine')} style={pillBtn(c, false)}>Keep all mine</button>
            <button onClick={() => setAll('theirs')} style={pillBtn(c, false)}>Take all portal</button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: c.bgElev }}>
              <tr>
                <th style={th(c)}>Field</th>
                <th style={th(c)}>Baseline</th>
                <th style={{ ...th(c), color: c.primary }}>Yours</th>
                <th style={{ ...th(c), color: c.signalGold }}>Portal</th>
                <th style={th(c)}>Choose</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((f) => {
                const choice = choices[f.key];
                return (
                  <tr key={f.key} style={{ borderBottom: `1px solid ${c.border}` }}>
                    <td style={td(c)}>
                      <div style={{ fontWeight: 700, color: c.text }}>{f.label || f.key}</div>
                      <code style={{ fontSize: 10, color: c.textSub }}>{f.key}</code>
                    </td>
                    <td style={td(c)}>{fmt(f.baseline)}</td>
                    <td style={{ ...td(c), background: choice === 'mine' ? 'rgba(0,35,230,0.10)' : 'transparent' }}>{fmt(f.mine)}</td>
                    <td style={{ ...td(c), background: choice === 'theirs' ? 'rgba(212,167,58,0.12)' : 'transparent' }}>{fmt(f.theirs)}</td>
                    <td style={{ ...td(c), whiteSpace: 'nowrap' }}>
                      <button onClick={() => setChoices((s) => ({ ...s, [f.key]: 'mine' }))}
                        style={pillBtn(c, choice === 'mine')}>Mine</button>
                      <button onClick={() => setChoices((s) => ({ ...s, [f.key]: 'theirs' }))}
                        style={{ ...pillBtn(c, choice === 'theirs'), marginLeft: 6 }}>Portal</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer style={{
          padding: '12px 20px', borderTop: `1px solid ${c.border}`,
          background: c.bgElev,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button onClick={onCancel} style={{
            padding: '9px 16px', borderRadius: 10, background: 'transparent',
            border: `1px solid ${c.borderStrong}`, color: c.text,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => onResolve(choices)} style={{
            padding: '9px 20px', borderRadius: 10, border: 'none', color: c.onAccent,
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
            backgroundImage: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            boxShadow: '0 8px 24px -10px rgba(0,35,230,0.45)',
          }}>Save merged result</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const th = (c: any): React.CSSProperties => ({
  textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 800,
  letterSpacing: 1, textTransform: 'uppercase', color: c.textSub,
  borderBottom: `1px solid ${c.border}`,
});
const td = (c: any): React.CSSProperties => ({
  padding: '10px 12px', verticalAlign: 'top', color: c.text,
});
const pillBtn = (c: any, active: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
  cursor: 'pointer',
  border: `1px solid ${active ? c.primary : c.borderStrong}`,
  background: active ? c.primarySoft : 'transparent',
  color: active ? c.primary : c.text,
});
