import React, { useEffect, useState } from 'react';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../hooks/useTenant';
import {
  runAllExtensionSync,
  SYNC_ACTION_LABELS,
  SyncAction,
  SyncProgress,
} from '../../hooks/useExtensionDataSync';

const { colors: c } = theme;

type HealthRow = {
  id: string;
  source: string;
  status: string;
  last_error: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  updated_at: string;
  metadata: any;
};

type IsolationReport = {
  has_extension?: boolean;
  extension?: string;
  organization_id?: string;
  visible_cdrs?: number;
  visible_voicemails?: number;
  visible_recordings?: number;
  other_extension_cdrs_visible?: number;
  strict_isolation_ok?: boolean;
};

const ACTIONS: SyncAction[] = ['sync-cdrs', 'sync-voicemail-messages', 'list-recordings'];

export default function SyncStatusView() {
  const { orgId, extension } = useTenant();
  const [progress, setProgress] = useState<Record<SyncAction, SyncProgress>>(() => {
    const init: any = {};
    ACTIONS.forEach((a) => (init[a] = { action: a, state: 'idle' }));
    return init;
  });
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HealthRow[]>([]);
  const [isolation, setIsolation] = useState<IsolationReport | null>(null);
  const [isolationLoading, setIsolationLoading] = useState(false);
  const [isolationError, setIsolationError] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('telecom_sync_health')
      .select('id, source, status, last_error, last_success_at, last_error_at, updated_at, metadata')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(40);
    setHistory((data || []) as HealthRow[]);
  };

  useEffect(() => { loadHistory(); }, [orgId]);


  const runRetry = async () => {
    if (!orgId || running) return;
    setRunning(true);
    ACTIONS.forEach((a) => setProgress((p) => ({ ...p, [a]: { action: a, state: 'running', attempt: 1 } })));
    try {
      await runAllExtensionSync(orgId, extension, {
        onProgress: (p) => setProgress((prev) => ({ ...prev, [p.action]: p })),
      });
    } finally {
      setRunning(false);
      loadHistory();
    }
  };

  const runIsolationCheck = async () => {
    setIsolationLoading(true);
    setIsolationError(null);
    try {
      const { data, error } = await supabase.rpc('audit_my_extension_isolation');
      if (error) throw error;
      setIsolation(data as IsolationReport);
    } catch (e: any) {
      setIsolationError(e?.message || 'Diagnostics failed');
    } finally {
      setIsolationLoading(false);
    }
  };

  // Derived: last successful sync per action.
  const lastOkByAction: Partial<Record<string, HealthRow>> = {};
  history.forEach((row) => {
    if (row.status === 'ok' && row.last_success_at && !lastOkByAction[row.source]) lastOkByAction[row.source] = row;
  });
  const recentFailures = history.filter((r) => r.status !== 'ok').slice(0, 8);


  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: c.text }}>Sync & Diagnostics</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: c.textSub }}>
            Extension <strong>{extension || '—'}</strong>{orgId ? ` · org ${orgId.slice(0, 8)}` : ''}
          </p>
        </div>
        <button
          onClick={runRetry}
          disabled={!orgId || running}
          style={{
            padding: '10px 18px', borderRadius: 12, border: `1px solid ${"rgba(180,196,224,0.55)"}`,
            background: running ? "rgba(245,247,252,0.6)" : `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            color: '#fff', fontWeight: 600, fontSize: 13, cursor: running ? 'wait' : 'pointer',
            opacity: !orgId ? 0.5 : 1,
          }}
        >
          {running ? 'Syncing…' : 'Retry sync now'}
        </button>
      </header>

      {/* Live progress per action */}
      <Card title="Live sync progress">
        <div style={{ display: 'grid', gap: 10 }}>
          {ACTIONS.map((a) => {
            const p = progress[a];
            const last = lastOkByAction[a];
            return (
              <div key={a} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, background: "rgba(245,247,252,0.6)", border: `1px solid ${"rgba(180,196,224,0.55)"}` }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{SYNC_ACTION_LABELS[a]}</span>
                  <span style={{ fontSize: 11, color: c.textSub }}>
                    Last success: {last?.last_success_at ? new Date(last.last_success_at).toLocaleString() : '—'}
                  </span>

                </div>
                <StatusBadge progress={p} />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recent failures */}
      <Card title="Recent sync alerts">
        {recentFailures.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: c.textSub }}>No recent failures recorded. 🎉</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {recentFailures.map((row) => (
              <div key={row.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                  <strong style={{ color: c.danger }}>{SYNC_ACTION_LABELS[row.source as SyncAction] || row.source}</strong>
                  <span style={{ color: c.textSub }}>{new Date(row.last_error_at || row.updated_at).toLocaleString()}</span>
                </div>
                {row.last_error && <p style={{ margin: '4px 0 0', fontSize: 12, color: c.text, opacity: 0.85 }}>{row.last_error}</p>}
                {row.metadata?.extension && <p style={{ margin: '2px 0 0', fontSize: 11, color: c.textSub }}>ext {row.metadata.extension}</p>}
              </div>

            ))}
          </div>
        )}
      </Card>

      {/* Isolation diagnostics */}
      <Card title="Extension isolation diagnostics">
        <p style={{ margin: '0 0 10px', fontSize: 12, color: c.textSub }}>
          Confirms your session can only read CDRs, voicemails, and recordings tied to your own extension.
        </p>
        <button
          onClick={runIsolationCheck}
          disabled={isolationLoading}
          style={{
            padding: '8px 14px', borderRadius: 10, border: `1px solid ${"rgba(180,196,224,0.55)"}`,
            background: "rgba(245,247,252,0.6)", color: c.text, fontSize: 12, fontWeight: 600,
            cursor: isolationLoading ? 'wait' : 'pointer',
          }}
        >
          {isolationLoading ? 'Running…' : 'Run isolation check'}
        </button>

        {isolationError && (
          <p style={{ marginTop: 10, fontSize: 12, color: c.danger }}>{isolationError}</p>
        )}

        {isolation && (
          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            {isolation.has_extension === false ? (
              <p style={{ margin: 0, fontSize: 13, color: c.textSub }}>No extension is currently linked to your account.</p>
            ) : (
              <>
                <Verdict ok={!!isolation.strict_isolation_ok} okText="Strict isolation verified — no cross-extension access detected." failText={`Cross-extension leak: ${isolation.other_extension_cdrs_visible} foreign CDR(s) visible.`} />
                <Grid>
                  <Stat label="Your extension" value={isolation.extension || '—'} />
                  <Stat label="Visible CDRs" value={String(isolation.visible_cdrs ?? 0)} />
                  <Stat label="Visible voicemails" value={String(isolation.visible_voicemails ?? 0)} />
                  <Stat label="Visible recordings" value={String(isolation.visible_recordings ?? 0)} />
                  <Stat label="Foreign-extension CDRs" value={String(isolation.other_extension_cdrs_visible ?? 0)} danger={(isolation.other_extension_cdrs_visible ?? 0) > 0} />
                </Grid>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 18, borderRadius: 16, background: c.deepPanel, border: `1px solid ${"rgba(180,196,224,0.55)"}`, boxShadow: '0 8px 24px -16px rgba(0,0,0,0.4)' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: c.text, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {children}
    </section>
  );
}

function StatusBadge({ progress }: { progress: SyncProgress }) {
  const map: Record<SyncProgress['state'], { bg: string; color: string; text: string }> = {
    idle: { bg: c.deepPanel, color: c.textSub, text: 'Idle' },
    running: { bg: `${c.lemtelBlue}26`, color: c.lemtelBlue, text: 'Running…' },
    retrying: { bg: `${c.warning}2e`, color: c.warning, text: `Retry ${progress.attempt ?? ''}` },
    success: { bg: `${c.success}2e`, color: c.success, text: 'Success' },
    failed: { bg: `${c.danger}2e`, color: c.danger, text: 'Failed' },
  };
  const s = map[progress.state];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={{ padding: '4px 10px', borderRadius: 999, background: s.bg, color: s.color, fontSize: 11, fontWeight: 700 }}>{s.text}</span>
      {progress.error && <span title={progress.error} style={{ fontSize: 11, color: c.danger, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progress.error}</span>}
    </div>
  );
}

function Verdict({ ok, okText, failText }: { ok: boolean; okText: string; failText: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: ok ? 'rgba(34,211,154,0.14)' : 'rgba(255,85,119,0.14)', border: `1px solid ${ok ? 'rgba(34,211,154,0.40)' : 'rgba(255,85,119,0.40)'}`, color: ok ? c.success : c.danger, fontSize: 13, fontWeight: 600 }}>
      {ok ? '✓ ' : '✗ '}{ok ? okText : failText}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>{children}</div>;
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, background: "rgba(245,247,252,0.6)", border: `1px solid ${"rgba(180,196,224,0.55)"}` }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: c.textSub }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: danger ? '#b91c1c' : c.text }}>{value}</div>
    </div>
  );
}
