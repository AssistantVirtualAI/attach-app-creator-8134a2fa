import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { theme } from '../../../lib/theme';
import { supabase } from '../../../lib/supabaseClient';
import { getMeContext } from '../../../lib/avaApi';
import PbxEditSheet, { FieldGroup } from './PbxEditSheet';
import ConflictMergeDialog, { ConflictField } from './ConflictMergeDialog';
import type { RuleMap } from '../../../lib/pbxValidators';
import SkeletonRows from '../../ui/SkeletonRows';

const { colors: c } = theme;
const LEMTEL_ORG = '71755d33-ed64-4ad5-a828-61c9d2029eb7';
const LEMTEL_DOMAIN = '2936594e-17b7-42a9-9165-95be48627923';

async function resolveDesktopTenantScope() {
  const me = await getMeContext().catch(() => null);
  const organization_id = me?.organization_id || LEMTEL_ORG;
  let domain_uuid = (me as any)?.domain_uuid || null;

  if (!domain_uuid && organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('fusionpbx_domain_uuid')
      .eq('id', organization_id)
      .maybeSingle();
    domain_uuid = (org as any)?.fusionpbx_domain_uuid || null;
  }

  return { organization_id, domain_uuid: domain_uuid || LEMTEL_DOMAIN };
}

export interface ColDef {
  key: string;
  label: string;
  render?: (v: any, row: any) => React.ReactNode;
}

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'checkbox';
  options?: string[];
  placeholder?: string;
}

interface Props {
  /** kind matches fusionpbx-proxy ADV map */
  kind: string;
  /** Optional singular action name when list and write action names differ. */
  actionKind?: string;
  title: string;
  /** primary key field name returned by FusionPBX (e.g. gateway_uuid) */
  uuidField: string;
  cols: ColDef[];
  /** legacy flat fields */
  fields?: FieldDef[];
  /** preferred: grouped fields (portal-parity sections) */
  fieldGroups?: FieldGroup[];
  /** sheet width */
  sheetWidth?: number;
  /** shared per-field validation rules (portal parity) */
  rules?: RuleMap;
  /** logical entity name written to pbx_admin_actions on conflicts */
  entityType?: string;
  transform?: (rows: any[]) => any[];
  rowActions?: { label: string; run: (row: any, helpers: { reload: () => void; orgId: string; domainUuid: string | null }) => Promise<void> | void }[];
  global?: boolean;
  canCreate?: boolean;
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10,
  background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
  border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  letterSpacing: 0.4,
};
const btnGhost: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, background: 'transparent',
  border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8, background: 'transparent',
  border: `1px solid rgba(220,38,38,0.45)`, color: c.danger, fontSize: 11, fontWeight: 700, cursor: 'pointer',
};

export default function PbxResourceSection({
  kind, actionKind, title, uuidField, cols, fields = [], fieldGroups, sheetWidth, rules, entityType, transform, rowActions = [], global = false, canCreate = true,
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orgId, setOrgId] = useState<string>(LEMTEL_ORG);
  const [domainUuid, setDomainUuid] = useState<string | null>(LEMTEL_DOMAIN);
  const [search, setSearch] = useState('');
  const [conflictState, setConflictState] = useState<{
    record: any; baseline: any; latest: any; conflicts: ConflictField[];
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const scope = await resolveDesktopTenantScope();
      const oid = scope.organization_id;
      setOrgId(oid);
      setDomainUuid(scope.domain_uuid);
      const params = global ? {} : { domain_uuid: scope.domain_uuid };
      const { data, error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action: `list-${kind}`, organization_id: oid, params },
      });
      if (err) throw err;
      const list = Array.isArray((data as any)?.data) ? (data as any).data : [];
      setRows(transform ? transform(list) : list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally { setLoading(false); }
  }, [kind, transform, global]);

  useEffect(() => { reload(); }, [reload]);

  // Auto-sync: refresh whenever any other view (portal tab / sibling sheet) writes a PBX resource.
  useEffect(() => {
    const onSaved = () => { reload(); };
    const onStorage = (e: StorageEvent) => { if (e.key === 'ava:pbx-resync') reload(); };
    window.addEventListener('ava:pbx-resource-saved', onSaved as any);
    window.addEventListener('storage', onStorage);
    const interval = window.setInterval(() => { if (!document.hidden) reload(); }, 60_000);
    return () => {
      window.removeEventListener('ava:pbx-resource-saved', onSaved as any);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(interval);
    };
  }, [reload]);

  const fetchLatest = useCallback(async (uuidValue: string): Promise<any | null> => {
    try {
      const params = global ? {} : { domain_uuid: domainUuid };
      const { data } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action: `list-${kind}`, organization_id: orgId, params },
      });
      const list = Array.isArray((data as any)?.data) ? (data as any).data : [];
      const transformed = transform ? transform(list) : list;
      return transformed.find((r: any) => r[uuidField] === uuidValue) || null;
    } catch { return null; }
  }, [kind, orgId, domainUuid, global, transform, uuidField]);

  const labelFor = (key: string): string => {
    const list = fieldGroups || [];
    for (const g of list) for (const f of g.fields) if (f.key === key) return f.label;
    return key;
  };

  const recordAudit = async (entity_id: string, before: any, after: any, diff: any, result: string, error?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('pbx_admin_actions').insert({
        organization_id: orgId,
        domain_uuid: domainUuid,
        actor_user_id: user.id,
        actor_email: user.email || null,
        entity_type: entityType || actionKind || kind,
        entity_id,
        action: 'conflict-resolution',
        source: 'desktop',
        before_json: before,
        after_json: after,
        diff_json: diff,
        result,
        error: error || null,
        metadata: { ua: navigator.userAgent, at: new Date().toISOString() },
      });
    } catch { /* audit failures must not block the save */ }
  };

  const performWrite = async (record: any, isUpdate: boolean) => {
    const writeKind = actionKind || kind;
    const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
      body: {
        action: isUpdate ? `update-${writeKind}` : `create-${writeKind}`,
        organization_id: orgId,
        params: { ...(global ? {} : { domain_uuid: domainUuid }), ...record },
      },
    });
    if (err) throw err;
    setEditing(null); setCreating(false);
    await reload();
  };

  const save = async (record: any, baseline?: any) => {
    setSaving(true);
    try {
      const isUpdate = !!record[uuidField];

      // Conflict detection (optimistic concurrency).
      if (isUpdate && baseline) {
        const latest = await fetchLatest(record[uuidField]);
        if (latest) {
          const userChanged = Object.keys(record).filter(
            (k) => JSON.stringify(record[k] ?? '') !== JSON.stringify(baseline[k] ?? ''),
          );
          const remoteChanged = Object.keys(latest).filter(
            (k) => JSON.stringify(latest[k] ?? '') !== JSON.stringify(baseline[k] ?? ''),
          );
          const collisions = userChanged.filter((k) => remoteChanged.includes(k));
          const remoteOnly = remoteChanged.filter((k) => !userChanged.includes(k));

          if (collisions.length > 0) {
            const conflicts: ConflictField[] = collisions.map((k) => ({
              key: k, label: labelFor(k),
              baseline: baseline[k], mine: record[k], theirs: latest[k],
            }));
            // Apply auto-merges to the record so the dialog only shows real collisions.
            for (const k of remoteOnly) record[k] = latest[k];
            setConflictState({ record, baseline, latest, conflicts });
            setSaving(false);
            return;
          }
          // No collisions — auto-merge remote-only changes.
          for (const k of remoteOnly) record[k] = latest[k];
        }
      }

      await performWrite(record, isUpdate);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || 'unknown'}`);
    } finally { setSaving(false); }
  };

  const resolveConflict = async (choices: Record<string, 'mine' | 'theirs'>) => {
    if (!conflictState) return;
    const { record, baseline, latest, conflicts } = conflictState;
    const merged = { ...record };
    const diff: Record<string, any> = {};
    for (const c of conflicts) {
      merged[c.key] = choices[c.key] === 'theirs' ? c.theirs : c.mine;
      diff[c.key] = { choice: choices[c.key], baseline: c.baseline, mine: c.mine, theirs: c.theirs, applied: merged[c.key] };
    }
    setConflictState(null);
    setSaving(true);
    try {
      await performWrite(merged, true);
      await recordAudit(merged[uuidField], baseline, merged, { conflicts: diff, remote_version_at: new Date().toISOString(), latest_keys: Object.keys(latest) }, 'resolved');
    } catch (e: any) {
      await recordAudit(merged[uuidField], baseline, merged, { conflicts: diff }, 'error', e?.message);
      alert(`Save failed: ${e?.message || 'unknown'}`);
    } finally { setSaving(false); }
  };

  const cancelConflict = async () => {
    if (!conflictState) return;
    const { record, baseline, conflicts } = conflictState;
    await recordAudit(record[uuidField], baseline, null, { conflicts: conflicts.map((c) => c.key) }, 'cancelled');
    setConflictState(null);
  };

  const remove = async (row: any) => {
    if (!confirm(`Delete this ${title.toLowerCase().slice(0, -1) || 'record'}?`)) return;
    try {
      const writeKind = actionKind || kind;
      const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: {
          action: `delete-${writeKind}`,
          organization_id: orgId,
          params: { [uuidField]: row[uuidField], ...(global ? {} : { domain_uuid: domainUuid }) },
        },
      });
      if (err) throw err;
      await reload();
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || 'unknown'}`);
    }
  };

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0, fontWeight: 700 }}>
          {title} <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 500, marginLeft: 6 }}>({rows.length})</span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, minWidth: 200, outline: 'none' }}
          />
          <button onClick={reload} style={btnGhost}>↻ Refresh</button>
          {canCreate && ((fieldGroups && fieldGroups.length > 0) || fields.length > 0) && (
            <button onClick={() => setCreating(true)} style={btnPrimary}>＋ New</button>
          )}
        </div>
      </header>

      <div style={{
        ...theme.glass.card, padding: 0, overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)', borderColor: c.border,
      }}>
        {loading ? (
          <SkeletonRows rows={5} padding={24} />
        ) : error ? (
          <div style={{ padding: 24, color: c.danger, fontSize: 13 }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: c.mutedSilver, fontSize: 13 }}>No records.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: c.bgElev }}>
                  {cols.map((col) => (
                    <th key={col.key} style={{ textAlign: 'left', padding: '12px 14px', color: c.mutedSilver, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderBottom: `1px solid ${c.border}` }}>{col.label}</th>
                  ))}
                  <th style={{ padding: '12px 14px', borderBottom: `1px solid ${c.border}` }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={row[uuidField] || i} style={{ borderBottom: `1px solid ${c.border}` }}>
                    {cols.map((col) => (
                      <td key={col.key} style={{ padding: '11px 14px', color: c.textIce }}>
                        {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                      </td>
                    ))}
                    <td style={{ padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {rowActions.map((a) => (
                        <button key={a.label} onClick={async () => { await a.run(row, { reload, orgId, domainUuid }); }}
                          style={{ ...btnGhost, padding: '6px 10px', fontSize: 11, marginRight: 6 }}>{a.label}</button>
                      ))}
                      {((fieldGroups && fieldGroups.length > 0) || fields.length > 0) && (
                        <button onClick={() => setEditing(row)} style={{ ...btnGhost, padding: '6px 10px', fontSize: 11, marginRight: 6 }}>Edit</button>
                      )}
                      <button onClick={() => remove(row)} style={btnDanger}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(editing || creating) && (
        <PbxEditSheet
          title={creating ? `New ${title.replace(/s$/, '')}` : `Edit ${title.replace(/s$/, '')}`}
          groups={fieldGroups && fieldGroups.length > 0
            ? fieldGroups
            : [{ section: 'Fields', fields: fields as any }]}
          initial={editing || {}}
          baseline={editing || null}
          rules={rules}
          saving={saving}
          width={sheetWidth}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSave={(rec) => save(rec, editing || undefined)}
        />
      )}

      {conflictState && (
        <ConflictMergeDialog
          title={title}
          conflicts={conflictState.conflicts}
          onCancel={cancelConflict}
          onResolve={resolveConflict}
        />
      )}
    </>
  );
}
