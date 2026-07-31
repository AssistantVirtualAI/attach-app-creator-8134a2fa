import { useCallback, useEffect, useState } from 'react';
import { theme } from '../../lib/theme';
import { ava } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';
import PageHeader, { ListSkeleton, EmptyState } from './PageHeader';

const { colors: c } = theme;

type Row = {
  domain_uuid: string;
  domain_name: string;
  domain_description?: string;
  domain_enabled?: string | boolean;
  org_id?: string | null;
  org_name?: string | null;
  extensions: number;
  numbers: number;
  queues: number;
};

type EditState =
  | { mode: 'create' }
  | { mode: 'edit'; row: Row }
  | null;

export default function CustomersView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const domains = await ava.domains();
      const [{ data: orgs }, { data: exts }, { data: nums }, { data: queues }, { data: phones }] = await Promise.all([
        supabase.from('organizations').select('id,name,fusionpbx_domain_uuid'),
        supabase.from('pbx_extensions').select('organization_id, domain_uuid'),
        supabase.from('pbx_phone_number_assignments').select('organization_id'),
        supabase.from('pbx_call_queues').select('organization_id'),
        supabase.from('phone_numbers').select('organization_id, domain_uuid'),
      ]);
      const orgByDomain = new Map<string, { id: string; name: string }>();
      for (const o of (orgs || [])) {
        if (o.fusionpbx_domain_uuid) orgByDomain.set(o.fusionpbx_domain_uuid, { id: o.id, name: o.name });
      }
      const countByOrg = (arr: any[] | null, orgId?: string | null) =>
        orgId ? (arr || []).filter((r) => r.organization_id === orgId).length : 0;
      const countByDomainOrOrg = (arr: any[] | null, domainUuid: string, orgId?: string | null) => {
        const list = arr || [];
        const byDomain = list.filter((r) => r.domain_uuid === domainUuid).length;
        if (byDomain > 0) return byDomain;
        return countByOrg(list, orgId);
      };

      const mapped: Row[] = (domains || []).map((d: any) => {
        const org = orgByDomain.get(d.domain_uuid);
        const extCount = countByDomainOrOrg(exts, d.domain_uuid, org?.id);
        const numCount = Math.max(
          countByDomainOrOrg(phones, d.domain_uuid, org?.id),
          countByOrg(nums, org?.id),
        );
        return {
          domain_uuid: d.domain_uuid,
          domain_name: d.domain_name,
          domain_description: d.domain_description || '',
          domain_enabled: d.domain_enabled,
          org_id: org?.id || null,
          org_name: org?.name || null,
          extensions: extCount,
          numbers: numCount,
          queues: countByOrg(queues, org?.id),
        };
      });
      mapped.sort((a, b) => a.domain_name.localeCompare(b.domain_name));
      setRows(mapped);
    } catch (e: any) {
      setError(e?.message || 'Failed to load customers');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const syncDomain = async (r: Row) => {
    if (!r.org_id) { alert('No organization linked to this PBX domain yet.'); return; }
    setSyncing(r.domain_uuid);
    try {
      await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action: 'sync-all', resources: ['extensions','queues','ivrs','ring_groups','cdrs'], organization_id: r.org_id, domain_uuid: r.domain_uuid },
      });
      await load();
    } catch (e: any) { alert('Sync failed: ' + (e?.message || 'unknown')); }
    finally { setSyncing(null); }
  };

  const removeDomain = async (r: Row) => {
    if (!confirm(`Delete domain "${r.domain_name}"? This cannot be undone.`)) return;
    try {
      const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action: 'delete-domain', domain_uuid: r.domain_uuid },
      });
      if (error || (data as any)?.ok === false) throw new Error(error?.message || (data as any)?.error || 'Delete failed');
      await load();
    } catch (e: any) { alert('Delete failed: ' + (e?.message || 'unknown')); }
  };

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q ||
      r.domain_name.toLowerCase().includes(q) ||
      (r.domain_description || '').toLowerCase().includes(q) ||
      (r.org_name || '').toLowerCase().includes(q);
    const isEnabled = r.domain_enabled === 'true' || r.domain_enabled === true;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled' ? isEnabled : !isEnabled);
    const isLinked = !!r.org_id;
    const matchesLink = linkFilter === 'all' || (linkFilter === 'linked' ? isLinked : !isLinked);
    return matchesQuery && matchesStatus && matchesLink;
  });

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%' }}>
      <PageHeader
        eyebrow="PBX"
        title="Customers"
        subtitle="Every FusionPBX domain on this server. Each domain is a customer / tenant."
        accent={c.signalGold}
        icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h18M3 12h18M3 17h18"/></svg>}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.mutedSilver} strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search domains, customers…"
              style={{ padding: '7px 10px 7px 32px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 12.5, outline: 'none', width: 240 }}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 12.5, outline: 'none' }}>
            <option value="all">All statuses</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as any)} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 12.5, outline: 'none' }}>
            <option value="all">All links</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Unlinked</option>
          </select>
          <span style={{ fontSize: 11, color: c.mutedSilver }}>{filtered.length} / {rows.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEdit({ mode: 'create' })} style={{ padding: '8px 14px', borderRadius: 9, background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`, border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ New customer</button>
          <button onClick={load} style={{ padding: '8px 14px', borderRadius: 9, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {error && <div style={{ padding: 14, color: c.danger, background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, marginBottom: 12 }}>{error}</div>}
      {loading && <ListSkeleton rows={6} />}
      {!loading && rows.length === 0 && (
        <EmptyState icon="◉" title="No PBX domains" hint="FusionPBX returned no domains. Create one with + New customer or check your credentials." accent={c.signalGold} />
      )}
      {!loading && filtered.length === 0 && rows.length > 0 && (
        <EmptyState icon="◉" title="No matches" hint="Adjust your search or filters to find customers." accent={c.mutedSilver} />
      )}
      {!loading && filtered.length > 0 && (
        <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 70px 70px 70px 90px 200px', padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel }}>
            {['Domain','Customer','Ext','Numbers','Queues','Status',''].map((col) => (
              <span key={col} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: c.mutedSilver }}>{col}</span>
            ))}
          </div>
          {filtered.map((r) => (
            <div key={r.domain_uuid} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 70px 70px 70px 90px 200px', padding: '12px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce, alignItems: 'center' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.domain_name}</span>
              <span style={{ color: r.org_name ? c.textIce : c.mutedSilver }}>{r.org_name || '— not linked —'}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: r.org_id || r.extensions ? c.textIce : c.mutedSilver }}>{r.extensions || (r.org_id ? '0' : '—')}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: r.org_id || r.numbers ? c.textIce : c.mutedSilver }}>{r.numbers || (r.org_id ? '0' : '—')}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: r.org_id || r.queues ? c.textIce : c.mutedSilver }}>{r.queues || (r.org_id ? '0' : '—')}</span>
              <span style={{ color: r.domain_enabled === 'true' || r.domain_enabled === true ? c.success : c.mutedSilver, fontSize: 11 }}>
                ● {r.domain_enabled === 'true' || r.domain_enabled === true ? 'Enabled' : 'Disabled'}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEdit({ mode: 'edit', row: r })} style={btnGhost(c)}>Edit</button>
                <button onClick={() => syncDomain(r)} disabled={syncing === r.domain_uuid} style={{ ...btnGhost(c), opacity: syncing === r.domain_uuid ? 0.6 : 1 }}>{syncing === r.domain_uuid ? '…' : '↻ Sync'}</button>
                <button onClick={() => removeDomain(r)} style={{ ...btnGhost(c), color: c.danger, borderColor: c.danger }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {edit && <DomainModal state={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function btnGhost(c: any): React.CSSProperties {
  return { padding: '5px 10px', borderRadius: 7, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 11, cursor: 'pointer' };
}

function DomainModal({ state, onClose, onSaved }: { state: Exclude<EditState, null>; onClose: () => void; onSaved: () => void }) {
  const isEdit = state.mode === 'edit';
  const initial = isEdit ? state.row : null;
  const [name, setName] = useState(initial?.domain_name || '');
  const [desc, setDesc] = useState(initial?.domain_description || '');
  const [enabled, setEnabled] = useState<boolean>(initial ? (initial.domain_enabled === 'true' || initial.domain_enabled === true) : true);
  const [orgId, setOrgId] = useState<string>(initial?.org_id || '');
  const [orgs, setOrgs] = useState<{ id: string; name: string; fusionpbx_domain_uuid?: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('organizations').select('id,name,fusionpbx_domain_uuid').order('name')
      .then(({ data }) => setOrgs((data || []) as any));
  }, []);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      let workingDomainUuid = initial?.domain_uuid || '';
      if (isEdit) {
        const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'update-domain', domain_uuid: initial!.domain_uuid, params: { domain_description: desc, domain_enabled: enabled ? 'true' : 'false' } },
        });
        if (error || (data as any)?.ok === false) throw new Error(error?.message || (data as any)?.error || 'Update failed');
      } else {
        if (!name.trim()) throw new Error('Domain name required');
        const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'create-domain', domain_name: name.trim(), domain_description: desc || `Customer ${name}` },
        });
        if (error || (data as any)?.ok === false) throw new Error(error?.message || (data as any)?.error || 'Create failed');
        workingDomainUuid = (data as any)?.domain_uuid || '';
      }

      // Link / unlink organization
      if (orgId && workingDomainUuid) {
        // Clear domain on any other org currently pointing here
        await supabase.from('organizations')
          .update({ fusionpbx_domain_uuid: null })
          .eq('fusionpbx_domain_uuid', workingDomainUuid)
          .neq('id', orgId);
        await supabase.from('organizations')
          .update({ fusionpbx_domain_uuid: workingDomainUuid })
          .eq('id', orgId);
      } else if (!orgId && initial?.org_id) {
        await supabase.from('organizations')
          .update({ fusionpbx_domain_uuid: null })
          .eq('id', initial.org_id);
      }

      // Trigger background sync so counts refresh
      if (orgId && workingDomainUuid) {
        supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'sync-all', resources: ['extensions','queues','phone_numbers'], organization_id: orgId, domain_uuid: workingDomainUuid },
        }).catch(() => {});
      }

      onSaved();
    } catch (e: any) { setErr(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: c.deepPanel, border: `1px solid ${c.border}`, borderRadius: 14, padding: 22, color: c.text }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Edit customer' : 'New customer'}</h2>
        <p style={{ margin: '4px 0 14px', fontSize: 12, color: c.textSub }}>{isEdit ? 'Update this FusionPBX domain and link it to a workspace.' : 'Create a new FusionPBX domain / tenant.'}</p>

        <label style={lbl(c)}>Domain name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit} placeholder="customer.example.com" style={inp(c)} />

        <label style={lbl(c)}>Description</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Friendly customer name" style={inp(c)} />

        <label style={lbl(c)}>Linked workspace / organization</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} style={inp(c)}>
          <option value="">— not linked —</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}{o.fusionpbx_domain_uuid && o.fusionpbx_domain_uuid !== (initial?.domain_uuid || '') ? ' (linked elsewhere)' : ''}
            </option>
          ))}
        </select>
        <p style={{ fontSize: 10.5, color: c.mutedSilver, marginTop: 4 }}>
          Linking enables extension / number / queue counts and per-customer sync.
        </p>

        {isEdit && (
          <label style={{ ...lbl(c), display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
          </label>
        )}

        {err && <p style={{ color: c.danger, fontSize: 12, margin: '10px 0 0' }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost(c)}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 16px', borderRadius: 9, background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`, border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : isEdit ? 'Save & Sync' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

function lbl(c: any): React.CSSProperties {
  return { display: 'block', fontSize: 11, fontWeight: 700, color: c.textSub, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 4 };
}
function inp(c: any): React.CSSProperties {
  return { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.bgCard, color: c.text, fontSize: 13, outline: 'none' };
}
