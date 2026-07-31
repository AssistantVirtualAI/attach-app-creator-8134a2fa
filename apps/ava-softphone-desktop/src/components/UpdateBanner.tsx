import React, { useEffect, useState } from 'react';
import { theme } from '../lib/theme';

const { colors: c } = theme;

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

export default function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState<string>('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.onUpdateAvailable((i) => { setVersion(i.version); setPhase('downloading'); });
    api.onUpdateProgress((p) => { setPercent(p.percent); setPhase('downloading'); });
    api.onUpdateDownloaded((i) => { setVersion(i.version); setPhase('ready'); });
    api.onUpdateError?.((m) => { setError(m); setPhase('error'); });
  }, []);

  if (phase === 'idle') return null;

  const base: React.CSSProperties = {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
    background: c.primary, color: c.onAccent, fontSize: 13, zIndex: 9999,
    boxShadow: '0 -2px 12px rgba(0,0,0,0.3)',
  };

  if (phase === 'downloading') {
    return (
      <div style={base}>
        <span>⬇ Downloading update {version} — {percent}%</span>
        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2 }}>
          <div style={{ width: `${percent}%`, height: '100%', background: c.onAccent, borderRadius: 2 }} />
        </div>
      </div>
    );
  }
  if (phase === 'ready') {
    return (
      <div style={base}>
        <span>✓ Update {version} ready</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => window.electronAPI.installUpdate()}
          style={{ background: c.onAccent, color: c.primary, border: 0, padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >
          Restart & Update
        </button>
      </div>
    );
  }
  if (phase === 'error') {
    return <div style={{ ...base, background: '#b00020' }}>Update error: {error}</div>;
  }
  return null;
}
