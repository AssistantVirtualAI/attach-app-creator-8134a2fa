import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { theme } from '../lib/theme';

const { colors: c } = theme;

interface Props { userId: string; }

/**
 * Call center status bar (Phase 4 / desktop).
 * Shows current CC status + Available/Pause/Logout buttons when the signed-in
 * softphone user has a CC role. Hidden for non-CC users.
 */
export default function CallCenterStatusBar({ userId }: Props) {
  const [row, setRow] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('pbx_softphone_users')
        .select('extension, organization_id, cc_role, cc_status, cc_pause_reason, cc_queues')
        .eq('portal_user_id', userId).maybeSingle();
      if (!cancelled) setRow(data);
    };
    load();
    const ch = supabase.channel('cc-statusbar-' + userId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pbx_softphone_users' }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [userId]);

  if (!row || row.cc_role === 'none' || !row.cc_role) return null;

  const call = async (action: string, extra: any = {}) => {
    setBusy(true);
    try {
      await supabase.functions.invoke('call-center-sync', {
        body: { action, extension: row.extension, organization_id: row.organization_id, queue: row.cc_queues?.[0], ...extra },
      });
    } finally { setBusy(false); }
  };

  const color = ({ available: c.success, paused: c.warning, on_call: c.danger, offline: c.textDim } as any)[row.cc_status] || c.textDim;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px',
      background: 'rgba(0,35,230,0.08)', borderBottom: '1px solid rgba(148,163,184,0.2)',
      fontSize: 12, color: '#e2e8f0',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <strong style={{ textTransform: 'capitalize' }}>{(row.cc_status || 'offline').replace('_', ' ')}</strong>
      {row.cc_pause_reason && <span style={{ opacity: 0.7 }}>· {row.cc_pause_reason}</span>}
      <span style={{ flex: 1 }} />
      {row.cc_status === 'offline' && <button disabled={busy} onClick={() => call('agent-login')} style={btn}>Log in</button>}
      {row.cc_status === 'paused' && <button disabled={busy} onClick={() => call('agent-unpause')} style={btn}>Resume</button>}
      {row.cc_status === 'available' && <button disabled={busy} onClick={() => call('agent-pause', { reason: 'Break' })} style={btn}>Pause</button>}
      {row.cc_status !== 'offline' && <button disabled={busy} onClick={() => call('agent-logout')} style={btnGhost}>Log out</button>}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'rgba(0,35,230,0.3)', color: c.onAccent, border: '1px solid rgba(0,35,230,0.5)',
  padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', border: '1px solid rgba(148,163,184,0.3)' };
