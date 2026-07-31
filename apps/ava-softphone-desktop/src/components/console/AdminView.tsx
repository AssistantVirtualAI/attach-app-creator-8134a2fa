import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../lib/theme';
import { ava, getMeContext } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';
import PbxResourceSection from './admin/PbxResourceSection';
import PbxEditSheet from './admin/PbxEditSheet';
import {
  EXTENSION_GROUPS, IVR_GROUPS, QUEUE_GROUPS, RING_GROUP_GROUPS,
  TIME_CONDITION_GROUPS, CONFERENCE_GROUPS, HOLD_MUSIC_GROUPS,
  GATEWAY_GROUPS, DIALPLAN_GROUPS,
} from '../../lib/pbxFieldSchemas';
import { EXTENSION_RULES, IVR_RULES, QUEUE_RULES } from '../../lib/pbxValidators';
import { useDesktopRole } from '../../hooks/useDesktopRole';
import { toast } from '../../lib/toast';
import { audit } from '../../lib/audit';
import { runCreatePbxResourceFlow, generateIdempotencyKey } from '../../lib/pbxCreateFlow';
import ConflictResolutionModal, { type ConflictKind } from './admin/ConflictResolutionModal';
import AuditTrail from './admin/AuditTrail';
import VoicemailView from './VoicemailView';
import RecordingsView from './RecordingsView';
import CallsView from './CallsView';
import SkeletonRows from '../ui/SkeletonRows';

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

/**
 * Shared modal shell — rendered via portal so ancestor `transform`, `filter`,
 * `overflow:hidden`, or backdrop-filter ancestors (e.g. the animated console
 * page wrapper) can't trap the overlay or bleed table text through it.
 * Uses a fully opaque panel background so edit forms read cleanly.
 */
function ModalShell({ title, onClose, width = 460, children }: { title: string; onClose: () => void; width?: number; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(2,6,20,0.78)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'grid', placeItems: 'center', padding: 24,
        animation: 'fadeIn 140ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, maxHeight: '88vh', overflowY: 'auto',
          background: c.bgCard,
          backgroundImage: 'linear-gradient(160deg, rgba(35,214,255,0.06), rgba(122,76,255,0.05))',
          border: `1px solid ${(c as any).borderAI || c.border}`,
          borderRadius: 16, padding: 22,
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(35,214,255,0.08)',
          color: c.textIce,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.textIce, letterSpacing: 0.2 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 28, height: 28, borderRadius: 8, border: `1px solid ${c.border}`,
            background: c.overlay04, color: c.mutedSilver, cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hook returning:
 *   • `confirmConflict(existing, identifier)` — plug into the create-flow's
 *     confirmConflict slot. Opens the ConflictResolutionModal and resolves to
 *     true (open existing for edit) or false (abort).
 *   • `modalNode` — JSX to render so the modal appears.
 */
function useConflictModal(kind: ConflictKind) {
  const [state, setState] = useState<{ existing: any; identifier: string; resolve: (v: boolean) => void } | null>(null);
  const confirmConflict = useCallback((existing: any, identifier: string) => new Promise<boolean>((resolve) => {
    setState({ existing, identifier, resolve });
  }), []);
  const modalNode = state ? (
    <ConflictResolutionModal
      kind={kind}
      identifier={state.identifier}
      existing={state.existing}
      onResolve={(choice) => { state.resolve(choice === 'open_for_edit'); setState(null); }}
    />
  ) : null;
  return { confirmConflict, modalNode };
}

function ExtensionsTable() {
  const { isAdmin, loading: roleLoading } = useDesktopRole();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState<{ key: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadFromDb = useCallback(async (orgId: string | null) => {
    let extQ = supabase
      .from('pbx_extensions')
      .select('id, pbx_uuid, extension, effective_cid_name, enabled, voicemail_enabled')
      .order('extension');
    if (orgId) extQ = extQ.eq('organization_id', orgId);
    let spuQ = supabase.from('pbx_softphone_users').select('extension, display_name, portal_user_id, status');
    if (orgId) spuQ = spuQ.eq('organization_id', orgId);
    const [{ data: exts, error: e1 }, { data: spus, error: e2 }] = await Promise.all([extQ, spuQ]);
    if (e1 || e2) throw (e1 || e2);
    const spuMap = new Map<string, any>((spus || []).map((s: any) => [String(s.extension), s]));
    return (exts || []).map((e: any) => {
      const s = spuMap.get(String(e.extension));
      return {
        id: e.id,
        extension_uuid: e.pbx_uuid,
        extension: e.extension,
        display_name: s?.display_name || e.effective_cid_name || '—',
        portal_user_id: s?.portal_user_id || null,
        voicemail_enabled: e.voicemail_enabled,
        enabled: e.enabled !== false,
        status: s?.status || (e.enabled === false ? 'Disabled' : 'Active'),
      };
    });
  }, []);

  const reload = useCallback(async (forceSync = false) => {
    setLoading(true); setError(null);
    try {
      const scope = await resolveDesktopTenantScope();
      const orgId = scope.organization_id;
      const domainUuid = scope.domain_uuid;
      // Trigger FusionPBX sync so all PBX extensions (not just registered softphones) land in the table.
      if (forceSync) {
        setSyncing(true);
        const { error: syncErr } = await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'sync-all', resources: ['extensions'], organization_id: orgId, domain_uuid: domainUuid },
        });
        if (syncErr) console.warn('sync-extensions failed:', syncErr.message);
        setSyncing(false);
      }
      setData(await loadFromDb(orgId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, [loadFromDb]);

  useEffect(() => {
    // First mount: load DB, then auto-sync if list looks incomplete.
    (async () => {
      await reload(false);
    })();
  }, [reload]);

  const updateExtension = async (ext: any, changes: any) => {
    setSaving(true);
    try {
      const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: {
          action: 'update-extension',
          organization_id: (await resolveDesktopTenantScope()).organization_id,
          params: { extension_uuid: ext.extension_uuid, domain_uuid: (await resolveDesktopTenantScope()).domain_uuid, ...changes },
        },
      });
      if (err) throw err;
      setData((prev) => prev.map((e) => (e.id === ext.id ? { ...e, ...changes } : e)));
      setEditing(null);
    } catch (e: any) {
      alert('Update failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const { confirmConflict: confirmExtConflict, modalNode: extConflictModal } = useConflictModal('extension');



  const createExtension = async (form: any) => {
    setSaving(true);
    try {
      const scope = await resolveDesktopTenantScope();
      const ext = String(form.extension || '').trim();
      const out: any = { ...form };
      ['voicemail_enabled', 'enabled', 'voicemail_attach_file',
       'voicemail_local_after_email', 'do_not_disturb',
       'forward_all_enabled', 'forward_busy_enabled', 'forward_no_answer_enabled']
        .forEach((k) => { if (typeof out[k] === 'boolean') out[k] = out[k] ? 'true' : 'false'; });

      const idempotencyKey = creating?.key || generateIdempotencyKey();
      await runCreatePbxResourceFlow({
        isAdmin,
        resourceKind: 'extension',
        identifier: ext || '(unnamed)',
        idempotencyKey,
        findDuplicate: async () => {
          if (!ext) return null;
          const { data: dup } = await supabase
            .from('pbx_extensions')
            .select('id, pbx_uuid, extension, enabled, updated_at')
            .eq('organization_id', scope.organization_id)
            .eq('extension', ext)
            .maybeSingle();
          return dup || null;
        },
        confirmConflict: (existing) => confirmExtConflict(existing, ext || '(unnamed)'),
        openForEdit: async (existing) => {
          setCreating(null);
          await reload(false);
          const match = data.find((r) => String(r.extension) === ext) || existing;
          if (match) setEditing(match);
        },
        submit: async ({ idempotencyKey: idk }) => {
          const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
            body: { action: 'create-extension', organization_id: scope.organization_id, idempotency_key: idk, params: { domain_uuid: scope.domain_uuid, ...out } },
          });
          if (err) throw err;
          setCreating(null);
        },
        reload: (force) => reload(force),
        dispatchSaved: () => window.dispatchEvent(new Event('ava:pbx-resource-saved')),
        toastSuccess: toast.success,
        toastError: toast.error,
        audit: (action, metadata) => audit(action, null, metadata),
      }, `Extension ${ext} created and synced.`);
    } finally { setSaving(false); }
  };


  const cols = ['Ext', 'Display Name', 'User', 'Voicemail', 'Status', ''];
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0 }}>Extensions <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 500 }}>({data.length})</span></h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <button onClick={() => setCreating({ key: generateIdempotencyKey() })} disabled={roleLoading} style={{
              padding: '8px 14px', borderRadius: 9,
              background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
              border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4,
              opacity: roleLoading ? 0.6 : 1,
            }}>＋ New Extension</button>
          )}
          <button onClick={() => reload(true)} disabled={syncing} style={{
            padding: '8px 14px', borderRadius: 9, background: 'transparent',
            border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            opacity: syncing ? 0.6 : 1,
          }}>{syncing ? 'Syncing…' : '↻ Sync from PBX'}</button>
          <button onClick={() => reload(false)} style={{
            padding: '8px 14px', borderRadius: 9, background: 'transparent',
            border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Reload</button>
        </div>
      </header>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel }}>
          {cols.map((col, i) => <span key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: c.mutedSilver }}>{col}</span>)}
        </div>
        {data.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '11px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce, alignItems: 'center' }}>
            <span>{e.extension}</span>
            <span>{e.display_name || '—'}</span>
            <span>{e.portal_user_id ? '✓' : '—'}</span>
            <span>{e.voicemail_enabled ? 'On' : 'Off'}</span>
            <span>{e.status}</span>
            <span>
              <button onClick={() => setEditing(e)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce,
              }}>Edit</button>
            </span>
          </div>
        ))}
        {loading && <SkeletonRows rows={5} padding={20} />}
        {!loading && !error && data.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>No extensions. Click “Sync from PBX”.</div>}
        {!loading && error && <div style={{ padding: 28, textAlign: 'center', color: c.danger, fontSize: 12 }}>{error}</div>}
      </div>

      {editing && (
        <EditExtensionModal
          ext={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(changes) => updateExtension(editing, changes)}
        />
      )}
      {creating && isAdmin && (
        <PbxEditSheet
          title="New Extension"
          groups={EXTENSION_GROUPS}
          initial={{ enabled: true, voicemail_enabled: true, user_context: 'default' }}
          rules={EXTENSION_RULES}
          saving={saving}
          onCancel={() => setCreating(null)}
          onSave={createExtension}
        />
      )}
      {extConflictModal}
    </>
  );
}

function EditExtensionModal({ ext, saving, onClose, onSave }: { ext: any; saving: boolean; onClose: () => void; onSave: (changes: any) => void }) {
  const initial = {
    ...ext,
    effective_caller_id_name: ext.display_name === '—' ? '' : ext.display_name || '',
    voicemail_enabled: !!ext.voicemail_enabled,
    enabled: ext.enabled !== false,
  };
  return (
    <PbxEditSheet
      title={`Edit Extension ${ext.extension}`}
      groups={EXTENSION_GROUPS}
      initial={initial}
      saving={saving}
      onCancel={onClose}
      onSave={(form) => {
        // Booleans → 'true'/'false' strings expected by FusionPBX
        const out: any = { ...form };
        ['voicemail_enabled', 'enabled', 'voicemail_attach_file',
         'voicemail_local_after_email', 'do_not_disturb',
         'forward_all_enabled', 'forward_busy_enabled', 'forward_no_answer_enabled']
          .forEach((k) => { if (typeof out[k] === 'boolean') out[k] = out[k] ? 'true' : 'false'; });
        onSave(out);
      }}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  background: c.deepPanel, border: `1px solid ${c.border}`, color: c.textIce, fontSize: 13, outline: 'none',
};
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: c.mutedSilver, textTransform: 'uppercase', marginBottom: 4 }}>{children}</div>;
}

type Section =
  | 'extensions' | 'devices' | 'numbers' | 'ivrs' | 'queues' | 'ringgroups'
  | 'gateways' | 'sip-profiles' | 'conferences' | 'hold-music' | 'dialplans'
  | 'time-conditions' | 'registrations' | 'voicemails' | 'recordings'
  | 'call-history' | 'feature-codes' | 'sync' | 'audit-trail';

const NAV_GROUPS: { label: string; items: { id: Section; label: string }[] }[] = [
  {
    label: 'Telephony',
    items: [
      { id: 'extensions', label: 'Extensions' },
      { id: 'devices', label: 'Devices' },
      { id: 'numbers', label: 'Phone Numbers' },
      { id: 'registrations', label: 'Live Registrations' },
    ],
  },
  {
    label: 'Routing',
    items: [
      { id: 'ivrs', label: 'Auto-Attendants' },
      { id: 'queues', label: 'Call Queues' },
      { id: 'ringgroups', label: 'Ring Groups' },
      { id: 'time-conditions', label: 'Time Conditions' },
      { id: 'dialplans', label: 'Dialplans' },
    ],
  },
  {
    label: 'Media',
    items: [
      { id: 'voicemails', label: 'Voicemails' },
      { id: 'recordings', label: 'Call Recordings' },
      { id: 'call-history', label: 'Call History' },
      { id: 'hold-music', label: 'Hold Music' },
      { id: 'conferences', label: 'Conferences' },
      { id: 'feature-codes', label: 'Feature Codes' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'gateways', label: 'Gateways' },
      { id: 'sip-profiles', label: 'SIP Profiles' },
      { id: 'sync', label: 'Sync Status' },
      { id: 'audit-trail', label: 'Audit Trail' },
    ],
  },
];

export default function AdminView() {
  const [sec, setSec] = useState<Section>('extensions');
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${c.border}`, background: c.deepPanel, padding: '18px 14px', overflowY: 'auto' }}>
        {NAV_GROUPS.map((g) => (
          <div key={g.label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: c.signalGold, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 6 }}>{g.label}</div>
            {g.items.map((n) => (
              <button key={n.id} onClick={() => setSec(n.id)} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', borderRadius: 8,
                background: sec === n.id ? 'rgba(11,181,214,0.14)' : 'transparent',
                border: 'none', color: sec === n.id ? c.avaCyan : c.mutedSilver,
                fontSize: 12, fontWeight: sec === n.id ? 700 : 500, cursor: 'pointer',
                marginBottom: 1,
                transition: 'all 160ms ease',
              }}>{n.label}</button>
            ))}
          </div>
        ))}
      </aside>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: (sec === 'voicemails' || sec === 'recordings' || sec === 'call-history') ? 0 : '24px 28px' }}>
        {sec === 'extensions' && <ExtensionsTable />}
        {sec === 'devices' && (
          <PbxResourceSection
            kind="devices" actionKind="device" title="Devices" uuidField="device_uuid"
            cols={[{ key: 'device_vendor', label: 'Vendor' }, { key: 'device_mac_address', label: 'MAC' }, { key: 'device_template', label: 'Template' }, { key: 'device_label', label: 'Assigned' }, { key: 'device_enabled', label: 'Enabled' }]}
            fields={[{ key: 'device_label', label: 'Label' }, { key: 'device_vendor', label: 'Vendor' }, { key: 'device_mac_address', label: 'MAC Address' }, { key: 'device_template', label: 'Template' }, { key: 'device_enabled', label: 'Enabled', type: 'select', options: ['true', 'false'] }]}
          />
        )}
        {sec === 'numbers' && (
          <PbxResourceSection
            kind="destinations" actionKind="destination" title="Phone Numbers" uuidField="destination_uuid"
            cols={[{ key: 'destination_number', label: 'Number' }, { key: 'destination_action', label: 'Assigned To' }, { key: 'destination_type', label: 'Type' }, { key: 'destination_enabled', label: 'Enabled' }]}
            fields={[{ key: 'destination_number', label: 'Number' }, { key: 'destination_action', label: 'Destination Action' }, { key: 'destination_type', label: 'Type' }, { key: 'destination_description', label: 'Description' }, { key: 'destination_enabled', label: 'Enabled', type: 'select', options: ['true', 'false'] }]}
          />
        )}
        {sec === 'ivrs' && <IvrsTable />}
        {sec === 'queues' && <QueuesTable />}
        {sec === 'ringgroups' && (
          <PbxResourceSection
            kind="ring-groups" actionKind="ring-group" title="Ring Groups" uuidField="ring_group_uuid"
            cols={[{ key: 'ring_group_name', label: 'Name' }, { key: 'ring_group_extension', label: 'Extension' }, { key: 'ring_group_strategy', label: 'Strategy' }, { key: 'ring_group_enabled', label: 'Enabled' }]}
            fieldGroups={RING_GROUP_GROUPS}
            sheetWidth={680}
          />
        )}
        {sec === 'gateways' && (
          <PbxResourceSection
            kind="gateways" title="Gateways" uuidField="gateway_uuid" global
            cols={[
              { key: 'gateway', label: 'Name' },
              { key: 'proxy', label: 'Proxy' },
              { key: 'username', label: 'Username' },
              { key: 'enabled', label: 'Enabled', render: (v) => (String(v) === 'true' ? '✓' : '—') },
              { key: 'register', label: 'Register' },
            ]}
            fieldGroups={GATEWAY_GROUPS}
            rowActions={[{
              label: 'Restart',
              run: async (row, { orgId }) => {
                await supabase.functions.invoke('fusionpbx-proxy', {
                  body: { action: 'restart-gateway', organization_id: orgId, params: { gateway_name: row.gateway } },
                });
              },
            }]}
          />
        )}
        {sec === 'sip-profiles' && (
          <PbxResourceSection
            kind="sip-profiles" title="SIP Profiles" uuidField="sip_profile_uuid" global canCreate={false}
            cols={[
              { key: 'sip_profile_name', label: 'Name' },
              { key: 'sip_profile_description', label: 'Description' },
              { key: 'sip_profile_enabled', label: 'Enabled' },
            ]}
            rowActions={[{
              label: 'Restart',
              run: async (row, { orgId }) => {
                await supabase.functions.invoke('fusionpbx-proxy', {
                  body: { action: 'restart-sip-profile', organization_id: orgId, params: { profile_name: row.sip_profile_name } },
                });
              },
            }]}
          />
        )}
        {sec === 'conferences' && (
          <PbxResourceSection
            kind="conferences" title="Conferences" uuidField="conference_room_uuid"
            cols={[
              { key: 'conference_room_name', label: 'Name' },
              { key: 'conference_room_extension', label: 'Extension' },
              { key: 'conference_room_pin', label: 'PIN' },
              { key: 'conference_room_enabled', label: 'Enabled' },
            ]}
            fieldGroups={CONFERENCE_GROUPS}
          />
        )}
        {sec === 'hold-music' && (
          <PbxResourceSection
            kind="hold-music" title="Hold Music" uuidField="music_on_hold_uuid"
            cols={[
              { key: 'music_on_hold_name', label: 'Name' },
              { key: 'music_on_hold_path', label: 'Path' },
              { key: 'music_on_hold_rate', label: 'Rate' },
              { key: 'music_on_hold_enabled', label: 'Enabled' },
            ]}
            fieldGroups={HOLD_MUSIC_GROUPS}
          />
        )}
        {sec === 'dialplans' && (
          <PbxResourceSection
            kind="dialplans" title="Dialplans" uuidField="dialplan_uuid"
            cols={[
              { key: 'dialplan_name', label: 'Name' },
              { key: 'dialplan_number', label: 'Number' },
              { key: 'dialplan_context', label: 'Context' },
              { key: 'dialplan_continue', label: 'Continue' },
              { key: 'dialplan_enabled', label: 'Enabled' },
            ]}
            fieldGroups={DIALPLAN_GROUPS}
            sheetWidth={720}
          />
        )}
        {sec === 'time-conditions' && (
          <PbxResourceSection
            kind="time-conditions" title="Time Conditions" uuidField="dialplan_uuid"
            cols={[
              { key: 'dialplan_name', label: 'Name' },
              { key: 'dialplan_number', label: 'Match' },
              { key: 'dialplan_enabled', label: 'Enabled' },
            ]}
            fieldGroups={TIME_CONDITION_GROUPS}
          />
        )}
        {sec === 'feature-codes' && <FeatureCodesTable />}
        {sec === 'voicemails' && <VoicemailView />}
        {sec === 'recordings' && <RecordingsView scope="org" />}
        {sec === 'call-history' && <CallsView scope="org" />}
        {sec === 'registrations' && <LiveRegistrationsTable />}
        {sec === 'sync' && <SyncStatus />}
        {sec === 'audit-trail' && <AuditTrail />}
      </div>
    </div>
  );
}


function Table({ title, cols, load, row }: { title: string; cols: string[]; load: () => Promise<any[]>; row: (item: any) => (string | number)[] }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = React.useCallback(() => {
    setLoading(true); setError(null);
    load()
      .then((d) => setData(Array.isArray(d) ? d : []))
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0 }}>{title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reload} style={{
            padding: '8px 14px', borderRadius: 9, background: 'transparent',
            border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>↻ Refresh</button>
          <button style={{
            padding: '8px 14px', borderRadius: 9,
            background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>+ New</button>
        </div>
      </header>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel }}>
          {cols.map((col) => <span key={col} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: c.mutedSilver }}>{col}</span>)}
        </div>
        {data.map((item, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '11px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce }}>
            {row(item).map((v, j) => <span key={j} style={{ fontFamily: typeof v === 'number' ? 'JetBrains Mono, monospace' : 'inherit' }}>{v}</span>)}
          </div>
        ))}
        {loading && <SkeletonRows rows={5} padding={20} />}
        {!loading && !error && data.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>No records yet. Click Refresh after syncing from the phone system.</div>}
        {!loading && error && <div style={{ padding: 28, textAlign: 'center', color: c.danger, fontSize: 12 }}>{error}</div>}
      </div>
    </>
  );
}

function SyncStatus() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { ava.syncStatus().then(setData); }, []);
  if (!data) return <SkeletonRows rows={4} padding={12} />;
  return (
    <>
      <h1 style={{ fontSize: 22, color: c.textIce, margin: '0 0 16px' }}>Sync Status</h1>
      <div style={{ padding: 18, borderRadius: 12, background: c.bgCard, border: `1px solid ${c.border}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: c.mutedSilver, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>Overall Status</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: data.status === 'ok' ? c.success : c.danger, marginTop: 4 }}>
              {data.status === 'ok' ? '● Healthy' : '● Degraded'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: c.mutedSilver }}>Last sync</div>
            <div style={{ fontSize: 12, color: c.textIce, fontFamily: 'JetBrains Mono, monospace' }}>{new Date(data.lastSync).toLocaleString()}</div>
          </div>
        </div>
      </div>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {data.jobs.map((j: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: `1px solid ${c.border}`, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ color: j.ok ? c.success : c.danger, fontSize: 10 }}>●</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.textIce, textTransform: 'capitalize' }}>{j.kind}</span>
            </div>
            <span style={{ fontSize: 11, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{new Date(j.finishedAt).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================
// IVRs (Auto-Attendants)
// ============================================================
function IvrsTable() {
  const { isAdmin, loading: roleLoading } = useDesktopRole();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState<{ key: string } | null>(null);
  const { confirmConflict: confirmIvrConflict, modalNode: ivrConflictModal } = useConflictModal('ivr');
  const [saving, setSaving] = useState(false);
  const [orgId, setOrgId] = useState<string>(LEMTEL_ORG);

  const reload = useCallback(async (forceSync = false) => {
    setLoading(true); setError(null);
    try {
      const me = await getMeContext();
      const orgId = me.organization_id || LEMTEL_ORG;
      setOrgId(orgId);
      if (forceSync) {
        setSyncing(true);
        await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'sync-all', resources: ['ivrs'], organization_id: orgId, domain_uuid: LEMTEL_DOMAIN },
        });
        setSyncing(false);
      }
      const { data: rows, error: e1 } = await supabase
        .from('pbx_ivrs')
        .select('id, pbx_uuid, name, extension, greet_long, greet_short, timeout_ms, exit_action, enabled')
        .eq('organization_id', orgId).order('name');
      if (e1) throw e1;
      setData(rows || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load IVRs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(false); }, [reload]);

  const save = async (ivr: any, changes: any) => {
    setSaving(true);
    try {
      const { organization_id: _oid, ...cleanChanges } = changes || {};
      const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: {
          action: 'update-ivr',
          organization_id: orgId,
          params: { ivr_menu_uuid: ivr.pbx_uuid, domain_uuid: LEMTEL_DOMAIN, ...cleanChanges },
        },
      });
      if (err) throw err;
      setData((prev) => prev.map((x) => (x.id === ivr.id
        ? { ...x, name: changes.ivr_menu_name ?? x.name, extension: changes.ivr_menu_extension ?? x.extension, greet_long: changes.ivr_menu_greet_long ?? x.greet_long, timeout_ms: changes.ivr_menu_timeout ?? x.timeout_ms, enabled: changes.ivr_menu_enabled !== undefined ? changes.ivr_menu_enabled === 'true' : x.enabled }
        : x)));
      setEditing(null);
    } catch (e: any) {
      alert('Update failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const create = async (form: any) => {
    setSaving(true);
    try {
      const me = await getMeContext();
      const orgId = me.organization_id || LEMTEL_ORG;
      const name = String(form.ivr_menu_name || '').trim();
      const idempotencyKey = creating?.key || generateIdempotencyKey();
      await runCreatePbxResourceFlow({
        isAdmin,
        resourceKind: 'ivr',
        identifier: name || '(unnamed)',
        idempotencyKey,
        findDuplicate: async () => {
          if (!name) return null;
          const { data: dup } = await supabase
            .from('pbx_ivrs')
            .select('id, pbx_uuid, name, extension, updated_at')
            .eq('organization_id', orgId)
            .eq('name', name)
            .maybeSingle();
          return dup || null;
        },
        confirmConflict: (existing) => confirmIvrConflict(existing, name || '(unnamed)'),
        openForEdit: async (existing) => {
          setCreating(null);
          await reload(false);
          const match = data.find((r) => r.name === name) || existing;
          if (match) setEditing(match);
        },
        submit: async ({ idempotencyKey: idk }) => {
          const { organization_id: _oid, ...cleanForm } = form || {};
          const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
            body: { action: 'create-ivr', organization_id: orgId, idempotency_key: idk, params: { domain_uuid: LEMTEL_DOMAIN, ...cleanForm } },
          });
          if (err) throw err;
          setCreating(null);
        },
        reload: (force) => reload(force),
        dispatchSaved: () => window.dispatchEvent(new Event('ava:pbx-resource-saved')),
        toastSuccess: toast.success,
        toastError: toast.error,
        audit: (action, metadata) => audit(action, null, metadata),
      }, `Auto-attendant "${name}" created and synced.`);
    } finally { setSaving(false); }
  };

  const cols = ['Name', 'Ext', 'Greeting', 'Timeout', 'Status', ''];
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0 }}>Auto-Attendants <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 500 }}>({data.length})</span></h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <button onClick={() => setCreating({ key: generateIdempotencyKey() })} disabled={roleLoading} style={{ padding: '8px 14px', borderRadius: 9, background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`, border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4, opacity: roleLoading ? 0.6 : 1 }}>＋ New Auto-Attendant</button>
          )}
          <button onClick={() => reload(true)} disabled={syncing} style={{ padding: '8px 14px', borderRadius: 9, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : '↻ Sync from PBX'}</button>
          <button onClick={() => reload(false)} style={{ padding: '8px 14px', borderRadius: 9, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reload</button>
        </div>
      </header>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel }}>
          {cols.map((col, i) => <span key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: c.mutedSilver }}>{col}</span>)}
        </div>
        {data.map((i, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '11px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce, alignItems: 'center' }}>
            <span>{i.name}</span>
            <span>{i.extension || '—'}</span>
            <span style={{ color: c.mutedSilver, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(i.greet_long || '').slice(0, 50) || '—'}</span>
            <span>{i.timeout_ms ? `${i.timeout_ms}ms` : '—'}</span>
            <span style={{ color: i.enabled ? c.success : c.mutedSilver }}>{i.enabled ? 'Enabled' : 'Disabled'}</span>
            <span><button onClick={() => setEditing(i)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce }}>Edit</button></span>
          </div>
        ))}
        {loading && <SkeletonRows rows={5} padding={20} />}
        {!loading && !error && data.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>No IVRs. Click "Sync from PBX".</div>}
        {!loading && error && <div style={{ padding: 28, textAlign: 'center', color: c.danger, fontSize: 12 }}>{error}</div>}
      </div>
      {editing && <EditIvrModal ivr={editing} orgId={orgId} saving={saving} onClose={() => setEditing(null)} onSave={(changes) => save(editing, changes)} />}
      {creating && isAdmin && (
        <PbxEditSheet
          title="New Auto-Attendant"
          groups={IVR_GROUPS}
          initial={{ ivr_menu_enabled: 'true', ivr_menu_timeout: 3000, ivr_menu_exit_action: 'hangup', organization_id: orgId }}
          rules={IVR_RULES}
          saving={saving}
          width={680}
          onCancel={() => setCreating(null)}
          onSave={create}
        />
      )}
      {ivrConflictModal}
    </>
  );
}

function EditIvrModal({ ivr, orgId, saving, onClose, onSave }: { ivr: any; orgId: string; saving: boolean; onClose: () => void; onSave: (changes: any) => void }) {
  const initial = {
    ivr_menu_name: ivr.name || '',
    ivr_menu_extension: ivr.extension || '',
    ivr_menu_greet_long: ivr.greet_long || '',
    ivr_menu_greet_short: ivr.greet_short || '',
    ivr_menu_timeout: ivr.timeout_ms || 3000,
    ivr_menu_enabled: ivr.enabled !== false ? 'true' : 'false',
    ivr_menu_exit_action: ivr.exit_action || 'hangup',
    organization_id: orgId,
  };
  return (
    <PbxEditSheet
      title={`Edit IVR · ${ivr.name}`}
      groups={IVR_GROUPS}
      initial={initial}
      saving={saving}
      width={680}
      onCancel={onClose}
      onSave={onSave}
    />
  );
}

// ============================================================
// Call Queues
// ============================================================
const STRATEGIES = ['ring-all', 'longest-idle-agent', 'round-robin', 'top-down', 'agent-with-least-talk-time', 'agent-with-fewest-calls', 'sequentially-by-agent-order', 'random'];

function QueuesTable() {
  const { isAdmin, loading: roleLoading } = useDesktopRole();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState<{ key: string } | null>(null);
  const { confirmConflict: confirmQueueConflict, modalNode: queueConflictModal } = useConflictModal('queue');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (forceSync = false) => {
    setLoading(true); setError(null);
    try {
      const me = await getMeContext();
      const orgId = me.organization_id || LEMTEL_ORG;
      if (forceSync) {
        setSyncing(true);
        await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'sync-all', resources: ['queues'], organization_id: orgId, domain_uuid: LEMTEL_DOMAIN },
        });
        setSyncing(false);
      }
      const { data: rows, error: e1 } = await supabase
        .from('pbx_call_queues')
        .select('id, pbx_uuid, name, extension, strategy, max_wait_time, enabled')
        .eq('organization_id', orgId).order('name');
      if (e1) throw e1;
      // Agent counts
      const ids = (rows || []).map((r: any) => r.id);
      const agentCounts: Record<string, number> = {};
      if (ids.length) {
        const { data: agents } = await supabase.from('pbx_queue_agents').select('queue_id').in('queue_id', ids);
        (agents || []).forEach((a: any) => { agentCounts[a.queue_id] = (agentCounts[a.queue_id] || 0) + 1; });
      }
      setData((rows || []).map((r: any) => ({ ...r, agent_count: agentCounts[r.id] || 0 })));
    } catch (e: any) {
      setError(e?.message || 'Failed to load queues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(false); }, [reload]);

  const save = async (q: any, changes: any) => {
    setSaving(true);
    try {
      const { _queue_agents: agents, ...rest } = changes || {};
      const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: {
          action: 'update-queue',
          organization_id: LEMTEL_ORG,
          params: { call_center_queue_uuid: q.pbx_uuid, domain_uuid: LEMTEL_DOMAIN, ...rest },
        },
      });
      if (err) throw err;
      if (q.pbx_uuid) await syncQueueTiers(q.pbx_uuid, agents || []);
      await reload(false);
      setData((prev) => prev.map((x) => (x.id === q.id ? { ...x, name: rest.queue_name ?? x.name, strategy: rest.queue_strategy ?? x.strategy, max_wait_time: rest.queue_max_wait_time !== undefined ? Number(rest.queue_max_wait_time) : x.max_wait_time, enabled: rest.queue_enabled !== undefined ? rest.queue_enabled === 'true' : x.enabled } : x)));
      setEditing(null);
    } catch (e: any) {
      alert('Update failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const create = async (form: any) => {
    setSaving(true);
    try {
      const me = await getMeContext();
      const orgId = me.organization_id || LEMTEL_ORG;
      const name = String(form.queue_name || '').trim();
      const ext = String(form.queue_extension || '').trim();
      const { _queue_agents: agents, ...rest } = form || {};
      const out: any = { ...rest };
      if (out.queue_max_wait_time !== undefined) out.queue_max_wait_time = String(out.queue_max_wait_time);

      const idempotencyKey = creating?.key || generateIdempotencyKey();
      await runCreatePbxResourceFlow({
        isAdmin,
        resourceKind: 'queue',
        identifier: name || '(unnamed)',
        idempotencyKey,
        findDuplicate: async () => {
          if (!name) return null;
          const { data: dup } = await supabase
            .from('pbx_call_queues')
            .select('id, pbx_uuid, name, extension, updated_at')
            .eq('organization_id', orgId)
            .eq('name', name)
            .maybeSingle();
          return dup || null;
        },
        confirmConflict: (existing) => confirmQueueConflict(existing, name || '(unnamed)'),
        openForEdit: async (existing) => {
          setCreating(null);
          await reload(false);
          const match = data.find((r) => r.name === name) || existing;
          if (match) setEditing(match);
        },
        submit: async ({ idempotencyKey: idk }) => {
          const { error: err } = await supabase.functions.invoke('fusionpbx-proxy', {
            body: { action: 'create-queue', organization_id: orgId, idempotency_key: idk, params: { domain_uuid: LEMTEL_DOMAIN, ...out } },
          });
          if (err) throw err;
          // Best-effort: persist queue tiers right after the queue itself.
          if (agents && agents.length) {
            try {
              await reload(true);
              const { data: created } = await supabase
                .from('pbx_call_queues')
                .select('pbx_uuid')
                .eq('organization_id', orgId)
                .eq('name', name)
                .maybeSingle();
              if ((created as any)?.pbx_uuid) await syncQueueTiers((created as any).pbx_uuid, agents);
            } catch { /* tier assignment is non-blocking */ }
          }
          setCreating(null);
        },
        reload: (force) => reload(force),
        dispatchSaved: () => window.dispatchEvent(new Event('ava:pbx-resource-saved')),
        toastSuccess: toast.success,
        toastError: toast.error,
        audit: (action, metadata) => audit(action, null, metadata),
      }, `Call queue "${name}"${ext ? ` (ext ${ext})` : ''} created and synced.`);
    } finally { setSaving(false); }
  };

  const cols = ['Name', 'Ext', 'Strategy', 'Agents', 'Max wait', 'Status', ''];
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0 }}>Call Queues <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 500 }}>({data.length})</span></h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <button onClick={() => setCreating({ key: generateIdempotencyKey() })} disabled={roleLoading} style={{ padding: '8px 14px', borderRadius: 9, background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`, border: 'none', color: c.onAccent, fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.4, opacity: roleLoading ? 0.6 : 1 }}>＋ New Queue</button>
          )}
          <button onClick={() => reload(true)} disabled={syncing} style={{ padding: '8px 14px', borderRadius: 9, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>{syncing ? 'Syncing…' : '↻ Sync from PBX'}</button>
          <button onClick={() => reload(false)} style={{ padding: '8px 14px', borderRadius: 9, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reload</button>
        </div>
      </header>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '10px 14px', borderBottom: `1px solid ${c.border}`, background: c.deepPanel }}>
          {cols.map((col, i) => <span key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: c.mutedSilver }}>{col}</span>)}
        </div>
        {data.map((q, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, padding: '11px 14px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5, color: c.textIce, alignItems: 'center' }}>
            <span>{q.name}</span>
            <span>{q.extension || '—'}</span>
            <span style={{ color: c.avaCyan }}>{q.strategy || '—'}</span>
            <span>{q.agent_count}</span>
            <span>{q.max_wait_time ? `${q.max_wait_time}s` : '—'}</span>
            <span style={{ color: q.enabled ? c.success : c.mutedSilver }}>{q.enabled ? 'Enabled' : 'Disabled'}</span>
            <span><button onClick={() => setEditing(q)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce }}>Edit</button></span>
          </div>
        ))}
        {loading && <SkeletonRows rows={5} padding={20} />}
        {!loading && !error && data.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>No queues. Click "Sync from PBX".</div>}
        {!loading && error && <div style={{ padding: 28, textAlign: 'center', color: c.danger, fontSize: 12 }}>{error}</div>}
      </div>
      {editing && <EditQueueModal queue={editing} saving={saving} onClose={() => setEditing(null)} onSave={(changes) => save(editing, changes)} />}
      {creating && isAdmin && (
        <PbxEditSheet
          title="New Call Queue"
          groups={QUEUE_GROUPS}
          initial={{ queue_enabled: 'true', queue_strategy: 'ring-all', queue_max_wait_time: 60 }}
          rules={QUEUE_RULES}
          saving={saving}
          width={680}
          onCancel={() => setCreating(null)}
          onSave={create}
        />
      )}
      {queueConflictModal}
    </>
  );
}

/** Reconcile queue tiers in FusionPBX so the live list matches the picker. */
async function syncQueueTiers(
  queueUuid: string,
  desired: { extension: string; role: 'agent' | 'supervisor' }[],
) {
  if (!queueUuid) return;
  const { data: listed } = await supabase.functions.invoke('fusionpbx-proxy', {
    body: { action: 'list-queue-tiers', organization_id: LEMTEL_ORG, params: { domain_uuid: LEMTEL_DOMAIN } },
  });
  const current = ((listed as any)?.data || []).filter((t: any) => t.call_center_queue_uuid === queueUuid);
  const desiredMap = new Map(desired.map((d) => [d.extension, d.role]));
  // Remove tiers no longer wanted (or where role changed).
  for (const t of current) {
    const ext = String(t.tier_agent || t.agent_extension || '').split('@')[0];
    const wantedRole = desiredMap.get(ext);
    const curLevel = Number(t.tier_level || 1);
    if (!wantedRole || (wantedRole === 'supervisor' ? curLevel !== 2 : curLevel !== 1)) {
      await supabase.functions.invoke('fusionpbx-proxy', {
        body: { action: 'remove-queue-tier', organization_id: LEMTEL_ORG, params: { call_center_tier_uuid: t.call_center_tier_uuid, domain_uuid: LEMTEL_DOMAIN } },
      });
    } else {
      desiredMap.delete(ext); // already present at correct level
    }
  }
  // Add anything still missing.
  for (const [ext, role] of desiredMap.entries()) {
    await supabase.functions.invoke('fusionpbx-proxy', {
      body: {
        action: 'add-queue-tier',
        organization_id: LEMTEL_ORG,
        params: {
          domain_uuid: LEMTEL_DOMAIN,
          call_center_queue_uuid: queueUuid,
          tier_agent: ext,
          tier_level: role === 'supervisor' ? 2 : 1,
          tier_position: 1,
        },
      },
    });
  }
}

function EditQueueModal({ queue, saving, onClose, onSave }: { queue: any; saving: boolean; onClose: () => void; onSave: (changes: any) => void }) {
  const [tiers, setTiers] = useState<{ extension: string; role: 'agent' | 'supervisor' }[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: 'list-queue-tiers', organization_id: LEMTEL_ORG, params: { domain_uuid: LEMTEL_DOMAIN } },
        });
        const mine = ((data as any)?.data || []).filter((t: any) => t.call_center_queue_uuid === queue.pbx_uuid);
        setTiers(mine.map((t: any) => ({
          extension: String(t.tier_agent || t.agent_extension || '').split('@')[0],
          role: Number(t.tier_level || 1) === 2 ? 'supervisor' as const : 'agent' as const,
        })).filter((x: any) => x.extension));
      } catch { setTiers([]); }
    })();
  }, [queue.pbx_uuid]);

  const initial = {
    queue_name: queue.name || '',
    queue_extension: queue.extension || '',
    queue_strategy: queue.strategy || 'ring-all',
    queue_max_wait_time: queue.max_wait_time || 60,
    queue_enabled: queue.enabled !== false ? 'true' : 'false',
    _queue_agents: tiers || [],
  };
  if (tiers === null) return null;
  return (
    <PbxEditSheet
      title={`Edit Queue · ${queue.name}`}
      groups={QUEUE_GROUPS}
      initial={initial}
      saving={saving}
      width={680}
      onCancel={onClose}
      onSave={(form) => {
        const out: any = { ...form };
        if (out.queue_max_wait_time !== undefined) out.queue_max_wait_time = String(out.queue_max_wait_time);
        onSave(out);
      }}
    />
  );
}

/* ============= New section tables (Supabase-backed reads) ============= */

function SimpleSection({ title, headers, rows, loading, error, onRefresh, extra }: {
  title: string; headers: string[]; rows: any[][]; loading: boolean; error: string | null; onRefresh: () => void; extra?: React.ReactNode;
}) {
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, color: c.textIce, margin: 0, fontWeight: 700 }}>
          {title} <span style={{ fontSize: 12, color: c.mutedSilver, fontWeight: 500, marginLeft: 6 }}>({rows.length})</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {extra}
          <button onClick={onRefresh} style={{ padding: '8px 12px', borderRadius: 10, background: 'transparent', border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </header>
      <div style={{ ...theme.glass.card, padding: 0, overflow: 'hidden', background: c.overlay04, borderColor: c.border }}>
        {loading ? <SkeletonRows rows={6} padding={24} />
          : error ? <div style={{ padding: 24, color: c.danger }}>{error}</div>
          : rows.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: c.mutedSilver }}>No records.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ background: c.bgElev }}>
                  {headers.map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 14px', color: c.mutedSilver, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderBottom: `1px solid ${c.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${c.border}` }}>
                    {r.map((cell, j) => <td key={j} style={{ padding: '11px 14px', color: c.textIce }}>{cell ?? '—'}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}

function useTableLoader(loader: () => Promise<any[]>) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true); setError(null);
    loader().then(setRows).catch((e) => setError(e?.message || 'Failed to load')).finally(() => setLoading(false));
  }, [loader]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, loading, error, reload };
}

function VoicemailsTable() {
  const loader = useCallback(async () => {
    const me = await getMeContext().catch(() => null);
    const orgId = me?.organization_id || LEMTEL_ORG;
    const { data, error } = await supabase.from('pbx_voicemail_settings').select('*').eq('organization_id', orgId).order('extension');
    if (error) throw error;
    return data || [];
  }, []);
  const { rows, loading, error, reload } = useTableLoader(loader);
  return <SimpleSection title="Voicemail Boxes" headers={['Ext', 'Email', 'PIN', 'Greeting', 'Attach', 'Delete after']}
    rows={rows.map((v) => [v.extension, v.email || '—', v.voicemail_password ? '••••' : '—', v.greeting_id || '—', v.attach_file ? '✓' : '—', v.local_after_email ? 'Delete' : 'Keep'])}
    loading={loading} error={error} onRefresh={reload} />;
}

function RecordingRulesTable() {
  const loader = useCallback(async () => {
    const me = await getMeContext().catch(() => null);
    const orgId = me?.organization_id || LEMTEL_ORG;
    const { data, error } = await supabase.from('pbx_call_recording_rules').select('*').eq('organization_id', orgId);
    if (error) throw error;
    return data || [];
  }, []);
  const { rows, loading, error, reload } = useTableLoader(loader);
  return <SimpleSection title="Recording Rules" headers={['Scope', 'Target', 'Mode', 'Retention (days)']}
    rows={rows.map((r) => [r.scope || 'global', r.target || '—', r.mode || 'on', r.retention_days ?? '—'])}
    loading={loading} error={error} onRefresh={reload} />;
}

function FeatureCodesTable() {
  const loader = useCallback(async () => {
    const me = await getMeContext().catch(() => null);
    const orgId = me?.organization_id || LEMTEL_ORG;
    const { data, error } = await supabase.from('pbx_feature_codes').select('*').eq('organization_id', orgId).order('code');
    if (error) throw error;
    return data || [];
  }, []);
  const { rows, loading, error, reload } = useTableLoader(loader);
  return <SimpleSection title="Feature Codes" headers={['Code', 'Name', 'Description', 'Enabled']}
    rows={rows.map((f) => [f.code, f.name || '—', f.description || '—', f.enabled ? '✓' : '—'])}
    loading={loading} error={error} onRefresh={reload} />;
}

function LiveRegistrationsTable() {
  const loader = useCallback(async () => {
    const me = await getMeContext().catch(() => null);
    const orgId = me?.organization_id || LEMTEL_ORG;
    const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
      body: { action: 'get-registrations-live', organization_id: orgId, params: { domain_uuid: LEMTEL_DOMAIN } },
    });
    if (error) throw error;
    return (data as any)?.data || [];
  }, []);
  const { rows, loading, error, reload } = useTableLoader(loader);
  return <SimpleSection title="Live Registrations" headers={['Ext', 'Contact', 'Agent', 'Network', 'Hostname', 'Status', 'Expires']}
    rows={rows.map((r: any) => [r.extension || r.user || '—', r.contact || '—', r.user_agent || r.agent || '—', r.network_ip ? `${r.network_ip}${r.network_port ? ':' + r.network_port : ''}` : '—', r.hostname || '—', r.status || 'registered', r.expires || '—'])}
    loading={loading} error={error} onRefresh={reload} />;
}
