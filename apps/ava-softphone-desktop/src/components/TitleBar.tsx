import React from 'react';
import LemtelLogo from './LemtelLogo';
import ProfileMenu from './ProfileMenu';
import { theme } from '../lib/theme';
import { formatAge, useSyncStatus } from '../hooks/useSyncStatus';

const dragStyle: React.CSSProperties = {
  // @ts-expect-error electron CSS
  WebkitAppRegion: 'drag',
};

interface Props {
  sipStatus?: string;
}

export default function TitleBar(_props: Props = {}) {
  const { colors } = theme;
  const sync = useSyncStatus();
  const retryIn = sync.nextRetryAt ? Math.max(0, Math.round((sync.nextRetryAt - Date.now()) / 1000)) : 0;

  return (
    <div
      style={{
        height: 42,
        background: 'linear-gradient(90deg, var(--ava-surface, rgba(5,8,26,0.98)), var(--ava-surface-elev, rgba(8,12,32,0.98)))',
        borderBottom: `1px solid ${colors.border}`,
        color: colors.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        position: 'relative',
        zIndex: 1000,
        overflow: 'visible',
        ...dragStyle,
      }}
    >
      {/* Aurora accent bar */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, #0023e6, #7a4cff 50%, #21d4fd)',
        opacity: 0.9, pointerEvents: 'none',
      }} />

      {/* Left: brand + window controls spacer (macOS traffic lights) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 70 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.textIce, letterSpacing: 0.2 }}>
          Lemtel Softphone
        </span>
        <img
          src={lemtelWordmark}
          alt="Lemtel"
          style={{ height: 20, width: 'auto', objectFit: 'contain', opacity: 0.95 }}
        />
      </div>






      <details style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <summary style={{
          listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '4px 10px', borderRadius: 999, border: `1px solid ${sync.syncConnected ? colors.success : colors.warning}66`,
          background: colors.bgCard, color: colors.text, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: sync.syncConnected ? colors.success : colors.warning, boxShadow: `0 0 10px ${sync.syncConnected ? colors.success : colors.warning}` }} />
          CDR {sync.syncConnected ? 'Live' : 'Retrying'} · {formatAge(sync.lastSyncAt ? Date.now() - sync.lastSyncAt : null)}
          {retryIn > 0 ? ` · retry ${retryIn}s` : ''}
        </summary>
        <div style={{
          position: 'absolute', top: 31, left: '50%', transform: 'translateX(-50%)', width: 380,
          background: colors.bgElev, border: `1px solid ${colors.border}`, borderRadius: 12,
          boxShadow: '0 18px 50px -18px rgba(0,0,0,.55)', padding: 10, zIndex: 1002,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>CDR sync attempts</div>
          {sync.log.length === 0 ? <div style={{ fontSize: 11, color: colors.mutedSilver }}>No attempts logged yet.</div> : sync.log.slice(0, 8).map((l) => (
            <div key={l.id} style={{ padding: '6px 0', borderTop: `1px solid ${colors.border}`, fontSize: 11, color: l.status === 'failed' ? colors.danger : l.status === 'success' ? colors.success : colors.mutedSilver }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{l.status.toUpperCase()}</strong><span>{new Date(l.at).toLocaleTimeString()}</span></div>
              <div style={{ marginTop: 2, color: colors.mutedSilver }}>{l.source}{l.attempt ? ` · attempt ${l.attempt}` : ''} — {l.reason}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Right: profile menu + window controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <ProfileMenu />
        <WindowControls />
      </div>
    </div>
  );
}

function WindowControls() {
  const { colors } = theme;
  const api = (typeof window !== 'undefined' ? (window as any).electronAPI : null);
  const isElectron = !!api?.minimize;
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
  const [maximized, setMaximized] = React.useState(false);

  if (!isElectron || isMac) return null;

  const btn: React.CSSProperties = {
    width: 34, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: colors.text, border: `1px solid ${colors.border}`,
    borderRadius: 6, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties;
  const closeBtn: React.CSSProperties = { ...btn, borderColor: `${colors.danger}55` };

  const onMin = () => { try { api.minimize(); } catch { /* noop */ } };
  const onMax = () => { try { api.maximize(); setMaximized((v) => !v); } catch { /* noop */ } };
  const onClose = () => { try { api.close(); } catch { /* noop */ } };

  return (
    <div style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
      <button aria-label="Minimize" title="Minimize" style={btn} onClick={onMin}>—</button>
      <button aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} style={btn} onClick={onMax}>{maximized ? '❐' : '▢'}</button>
      <button aria-label="Close" title="Close" style={closeBtn}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = colors.danger; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = colors.text; }}
        onClick={onClose}>✕</button>
    </div>
  );
}

export { LemtelLogo };
