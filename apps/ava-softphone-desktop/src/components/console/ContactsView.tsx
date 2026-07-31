import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { theme } from '../../lib/theme';
import { ava, ContactItem, ContactInteraction } from '../../lib/avaApi';
import { supabase } from '../../lib/supabaseClient';
import { useOrgId } from '../../lib/useOrgId';

const { colors: c } = theme;

type Filter = 'all' | 'favorites' | 'vip' | 'at-risk' | 'internal';

const LS_MANUAL = 'ava-manual-contacts-v1';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtRel(iso: string) {
  const diff = Date.now() - +new Date(iso);
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function isOnline(status?: string | null, lastSeenAt?: string | null) {
  if (status === 'online' || status === 'registered') return true;
  if (!lastSeenAt) return false;
  return Date.now() - +new Date(lastSeenAt) < 5 * 60 * 1000;
}

function dedupeByPhone(items: ContactItem[]): ContactItem[] {
  const seen = new Map<string, ContactItem>();
  for (const it of items) {
    const key = (it.phone || it.id).replace(/[^\d+]/g, '').toLowerCase() || it.id;
    if (!seen.has(key)) seen.set(key, it);
  }
  return Array.from(seen.values());
}

export default function ContactsView() {
  const orgId = useOrgId();
  const [items, setItems] = useState<ContactItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<ContactItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', email: '', company: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const [notes, setNotes] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  // One-time LS migration to org_contacts
  useEffect(() => {
    if (!orgId) return;
    let raw: any[] = [];
    try { raw = JSON.parse(localStorage.getItem(LS_MANUAL) || '[]'); } catch {}
    if (!Array.isArray(raw) || raw.length === 0) return;
    (async () => {
      const rows = raw.map((x: any) => ({
        organization_id: orgId, name: x.name || 'Unnamed',
        phone: x.phone || null, email: x.email || null, company: x.company || null,
        notes: x.notes || null, favorite: !!x.favorite, source: 'legacy-localstorage',
      }));
      const { error } = await (supabase as any).from('org_contacts').insert(rows);
      if (!error) localStorage.removeItem(LS_MANUAL);
    })();
  }, [orgId]);

  const loadAll = React.useCallback(async () => {
    const sources = await Promise.allSettled([
      // 1. Internal softphone users (workspace extensions)
      orgId
        ? (supabase as any)
            .from('pbx_softphone_users')
            .select('id,extension,display_name,sip_domain,status,last_seen_at,account_status')
            .eq('organization_id', orgId)
            .order('extension')
            .then((r: any) => r.data || [])
        : Promise.resolve([]),
      // 2. Workspace contacts table
      orgId
        ? (supabase as any)
            .from('org_contacts')
            .select('*')
            .eq('organization_id', orgId)
            .order('name')
            .then((r: any) => r.data || [])
        : Promise.resolve([]),
      // 3. Legacy ava.contacts (CRM/Zoho if wired in avaApi)
      ava.contacts().catch(() => [] as ContactItem[]),
      // 4. Legacy ava.extensions fallback (electron)
      ava.extensions().catch(() => [] as any[]),
    ]);

    const sp = sources[0].status === 'fulfilled' ? sources[0].value : [];
    const oc = sources[1].status === 'fulfilled' ? sources[1].value : [];
    const ct = sources[2].status === 'fulfilled' ? sources[2].value : [];
    const ex = sources[3].status === 'fulfilled' ? sources[3].value : [];

    const internal: ContactItem[] = (Array.isArray(sp) ? sp : []).map((e: any) => {
      const online = isOnline(e.status, e.last_seen_at);
      return {
        id: `sp-${e.id}`,
        name: e.display_name || `Ext ${e.extension}`,
        company: 'Internal · Extension',
        phone: e.extension,
        email: undefined,
        lastInteraction: e.last_seen_at || new Date().toISOString(),
        totalCalls: 0, totalMessages: 0,
        sentiment: online ? 'positive' : 'neutral',
        aiNote: `${online ? 'Online' : 'Offline'}${e.sip_domain ? ` · @${e.sip_domain}` : ''}`,
        tags: ['internal', online ? 'online' : 'offline'],
        favorite: false, interactions: [],
        notes: undefined,
      } as ContactItem;
    });

    const manual: ContactItem[] = (Array.isArray(oc) ? oc : []).map((x: any) => ({
      id: `oc-${x.id}`,
      name: x.name,
      company: x.company || undefined,
      phone: x.phone || '',
      email: x.email || undefined,
      lastInteraction: x.updated_at || x.created_at || new Date().toISOString(),
      totalCalls: 0, totalMessages: 0,
      sentiment: 'neutral',
      aiNote: x.notes || 'Saved contact.',
      tags: [x.source || 'manual'],
      favorite: !!x.favorite,
      interactions: [],
      notes: x.notes || '',
    } as ContactItem));

    const extras: ContactItem[] = (Array.isArray(ex) ? ex : []).map((e: any) => ({
      id: `ext-${e.id}`,
      name: e.displayName || `Ext ${e.extension}`,
      company: 'PBX · Extension',
      phone: e.extension,
      email: e.user,
      lastInteraction: new Date().toISOString(),
      totalCalls: 0, totalMessages: 0,
      sentiment: 'neutral',
      aiNote: `${e.enabled ? 'Active' : 'Disabled'}${e.status ? ` · ${e.status}` : ''}`,
      tags: ['internal', e.status || 'offline'].filter(Boolean),
      favorite: false, interactions: [],
    }));

    const all = dedupeByPhone([
      ...internal,
      ...manual,
      ...(Array.isArray(ct) ? ct : []),
      ...extras,
    ]);
    setItems(all);
  }, [orgId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime: refresh on softphone status changes + contacts inserts
  useEffect(() => {
    if (!orgId) return;
    const ch = (supabase as any)
      .channel(`contacts-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pbx_softphone_users', filter: `organization_id=eq.${orgId}` }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_contacts', filter: `organization_id=eq.${orgId}` }, () => loadAll())
      .subscribe();
    return () => { try { (supabase as any).removeChannel(ch); } catch {} };
  }, [orgId, loadAll]);

  const addManualContact = async () => {
    if (!draft.name.trim() || !draft.phone.trim()) return;
    if (!orgId) { return; }
    setSaving(true);
    const { error } = await (supabase as any).from('org_contacts').insert({
      organization_id: orgId,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim() || null,
      company: draft.company.trim() || null,
      notes: draft.notes.trim() || null,
      source: 'manual',
    });
    setSaving(false);
    if (error) {
      // Fallback: keep working even if RLS denies
      try {
        const ls = JSON.parse(localStorage.getItem(LS_MANUAL) || '[]');
        ls.push({ ...draft, id: `m-${Date.now()}` });
        localStorage.setItem(LS_MANUAL, JSON.stringify(ls));
      } catch {}
    }
    setDraft({ name: '', phone: '', email: '', company: '', notes: '' });
    setShowAdd(false);
    loadAll();
  };

  const toggleFav = async (it: ContactItem) => {
    const next = !it.favorite;
    setItems((all) => all.map((x) => x.id === it.id ? { ...x, favorite: next } : x));
    if (sel?.id === it.id) setSel({ ...sel, favorite: next });
    if (it.id.startsWith('oc-')) {
      const uuid = it.id.replace(/^oc-/, '');
      await (supabase as any).from('org_contacts').update({ favorite: next }).eq('id', uuid);
    } else {
      try { await ava.updateContact(it.id, { favorite: next }); } catch {}
    }
  };

  const callContact = (it: ContactItem) => {
    if (!it.phone) return;
    try { window.dispatchEvent(new CustomEvent('lemtel:dial-number', { detail: { number: it.phone } })); } catch {}
  };

  useEffect(() => {
    setNotes(sel?.notes || '');
    setTagDraft('');
  }, [sel?.id]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return items.filter((k) => {
      if (filter === 'favorites' && !k.favorite) return false;
      if (filter === 'vip' && !k.tags.includes('vip')) return false;
      if (filter === 'at-risk' && !k.tags.includes('at-risk')) return false;
      if (filter === 'internal' && !k.tags.includes('internal')) return false;
      if (!t) return true;
      const hay = `${k.name} ${k.company || ''} ${k.phone} ${k.email || ''} ${k.tags.join(' ')}`.toLowerCase();
      return hay.includes(t);
    });
  }, [items, filter, search]);

  const sentColor = (x: ContactItem['sentiment']) =>
    x === 'positive' ? c.success : x === 'negative' ? c.danger : c.mutedSilver;

  const updateItem = (id: string, patch: Partial<ContactItem>) => {
    setItems((all) => all.map((x) => x.id === id ? { ...x, ...patch } : x));
    if (sel?.id === id) setSel({ ...sel, ...patch });
  };

  const saveNotes = async () => {
    if (!sel) return;
    if (sel.id.startsWith('oc-')) {
      const uuid = sel.id.replace(/^oc-/, '');
      await (supabase as any).from('org_contacts').update({ notes }).eq('id', uuid);
    } else {
      try { await ava.updateContact(sel.id, { notes }); } catch {}
    }
    updateItem(sel.id, { notes });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };
  const addTag = async () => {
    const t = tagDraft.trim().toLowerCase();
    if (!sel || !t || sel.tags.includes(t)) { setTagDraft(''); return; }
    const tags = [...sel.tags, t];
    try { await ava.updateContact(sel.id, { tags }); } catch {}
    updateItem(sel.id, { tags });
    setTagDraft('');
  };
  const removeTag = async (t: string) => {
    if (!sel) return;
    const tags = sel.tags.filter((x) => x !== t);
    try { await ava.updateContact(sel.id, { tags }); } catch {}
    updateItem(sel.id, { tags });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '24px 28px', overflowY: 'auto' }}>
        <header style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: c.textIce, margin: '0 0 4px' }}>Contacts</h1>
            <p style={{ fontSize: 12, color: c.mutedSilver, margin: 0 }}>
              Workspace extensions, saved contacts and CRM — live presence and one-click call.
            </p>
          </div>
          <button onClick={() => setShowAdd((v) => !v)} style={{
            padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            color: c.onAccent, fontSize: 12, fontWeight: 700,
          }}>{showAdd ? 'Close' : '+ New Contact'}</button>
        </header>

        {showAdd && (
          <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, padding: 12, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            <input placeholder="Name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputMini} />
            <input placeholder="Phone *" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={inputMini} />
            <input placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={inputMini} />
            <input placeholder="Company" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} style={inputMini} />
            <textarea placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={{ ...inputMini, gridColumn: '1 / -1', minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
            <button disabled={saving} onClick={addManualContact} style={{ gridColumn: '1 / -1', padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', background: c.signalGold, color: c.midnight, fontWeight: 700, fontSize: 12, opacity: saving ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save contact'}</button>
          </div>
        )}

        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, company, phone, email, tag…"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10,
            background: c.bgCard, border: `1px solid ${c.border}`,
            color: c.textIce, fontSize: 13, marginBottom: 10, outline: 'none',
          }}
        />

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['all', 'internal', 'favorites', 'vip', 'at-risk'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>{f.toUpperCase()}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: c.mutedSilver, alignSelf: 'center' }}>
              {filtered.filter((x) => x.tags.includes('internal')).length} extensions · {filtered.length} of {items.length}
          </span>
        </div>

        <VirtualContactList
          items={filtered}
          sel={sel}
          setSel={setSel}
          toggleFav={toggleFav}
          callContact={callContact}
        />

      </div>

      <aside style={{ width: 400, flexShrink: 0, borderLeft: `1px solid ${c.border}`, background: c.deepPanel, padding: '24px 22px', overflowY: 'auto' }}>
        {!sel && (
          <div style={{ color: c.mutedSilver, fontSize: 12, paddingTop: 80, textAlign: 'center' }}>
            Select a contact to view notes, tags, and recent interactions.
          </div>
        )}
        {sel && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span style={{ ...avatar, width: 48, height: 48, fontSize: 16 }}>{initials(sel.name)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: 17, color: c.textIce, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {sel.name}
                  <button onClick={() => toggleFav(sel)} title="Toggle favorite" style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: sel.favorite ? c.signalGold : c.mutedSilver, fontSize: 16,
                  }}>{sel.favorite ? '★' : '☆'}</button>
                </h2>
                <div style={{ fontSize: 11, color: c.mutedSilver }}>{sel.company || 'Individual'}</div>
              </div>
            </div>

            <Panel title="Contact" accent={c.avaCyan}>
              <div style={{ fontSize: 12, color: c.textIce, lineHeight: 1.7 }}>
                <div>{sel.phone}</div>
                {sel.email && <div style={{ color: c.mutedSilver }}>{sel.email}</div>}
              </div>
            </Panel>

            <Panel title="Activity" accent={c.signalGold}>
              <div style={{ display: 'flex', gap: 16 }}>
                <Stat label="Calls" value={sel.totalCalls} />
                <Stat label="Messages" value={sel.totalMessages} />
                <Stat label="Sentiment" value={sel.sentiment} color={sentColor(sel.sentiment)} />
              </div>
            </Panel>

            <Panel title="AVA Relationship Note" accent={c.avaViolet}>
              <p style={{ fontSize: 12, lineHeight: 1.55, color: c.textIce, margin: 0 }}>{sel.aiNote}</p>
            </Panel>

            <Panel
              title="My notes"
              accent={c.avaCyan}
              right={
                <button onClick={saveNotes} style={miniBtn}>{savedFlash ? '✓ Saved' : 'Save'}</button>
              }
            >
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Private notes about this contact…"
                style={{
                  width: '100%', minHeight: 70, resize: 'vertical',
                  background: 'transparent', color: c.textIce,
                  border: 'none', outline: 'none', fontSize: 12, lineHeight: 1.5,
                  fontFamily: 'inherit',
                }}
              />
            </Panel>

            <Panel title="Tags" accent={c.mutedSilver}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {sel.tags.map((t) => (
                  <span key={t} style={{ ...tag(c.signalGold), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    #{t}
                    <button onClick={() => removeTag(t)} style={{
                      background: 'transparent', border: 'none', color: c.mutedSilver,
                      cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
                    }}>×</button>
                  </span>
                ))}
                {!sel.tags.length && <span style={{ fontSize: 11, color: c.mutedSilver }}>No tags yet.</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add tag…"
                  style={{
                    flex: 1, padding: '6px 9px', borderRadius: 8,
                    background: c.midnight, border: `1px solid ${c.border}`,
                    color: c.textIce, fontSize: 11, outline: 'none',
                  }}
                />
                <button onClick={addTag} style={miniBtn}>Add</button>
              </div>
            </Panel>

            <Panel title="Recent Interactions" accent={c.signalGold}>
              {(sel.interactions || []).length === 0 && (
                <div style={{ fontSize: 11, color: c.mutedSilver }}>No interactions yet.</div>
              )}
              {(sel.interactions || []).map((i) => <InteractionRow key={i.id} i={i} />)}
            </Panel>

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={() => callContact(sel)} style={btnPrimary}>📞 Call</button>
              <button style={btnGhost}>Message</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function InteractionRow({ i }: { i: ContactInteraction }) {
  const icon = i.kind === 'call' ? (i.direction === 'in' ? '↘' : '↗') : i.kind === 'sms' ? '✉' : '🎙';
  const color = i.kind === 'voicemail' ? c.signalGold : i.direction === 'in' ? c.success : c.avaCyan;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '18px 1fr 60px',
      gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${c.border}`,
    }}>
      <span style={{ color, fontSize: 13 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: c.textIce, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.preview}</div>
        <div style={{ fontSize: 10, color: c.mutedSilver }}>
          {i.kind.toUpperCase()}{i.durationSec ? ` · ${Math.floor(i.durationSec / 60)}:${(i.durationSec % 60).toString().padStart(2, '0')}` : ''}
        </div>
      </span>
      <span style={{ fontSize: 10, color: c.mutedSilver, textAlign: 'right' }}>{fmtRel(i.at)}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: c.mutedSilver, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || c.textIce, fontFamily: typeof value === 'number' ? 'JetBrains Mono, monospace' : undefined }}>{value}</div>
    </div>
  );
}

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

const avatar: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%',
  background: `linear-gradient(135deg, ${c.ai}, #23D6FF)`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, color: c.midnight, flexShrink: 0,
};

const chip = (active: boolean): React.CSSProperties => ({
  padding: '6px 11px', borderRadius: 999,
  background: active ? 'rgba(122,76,255,0.14)' : 'transparent',
  border: `1px solid ${active ? c.avaViolet + '66' : c.border}`,
  color: active ? c.avaViolet : c.mutedSilver,
  fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: 'pointer',
});
const tag = (col: string): React.CSSProperties => ({
  fontSize: 10, padding: '3px 8px', borderRadius: 999,
  background: c.overlay04, color: col,
  border: `1px solid ${col}33`, fontWeight: 600,
});
const inputMini: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, background: 'rgba(140,180,255,0.06)',
  border: `1px solid ${c.border}`, color: c.textIce, fontSize: 12, outline: 'none',
};
const miniBtn: React.CSSProperties = {
  padding: '4px 9px', borderRadius: 6,
  background: 'transparent', border: `1px solid ${c.border}`,
  color: c.textIce, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  flex: 1, padding: '10px 12px', borderRadius: 10,
  background: c.signalGold, color: c.midnight, border: 'none',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  flex: 1, padding: '10px 12px', borderRadius: 10,
  background: 'transparent', color: c.textIce,
  border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

function Panel({ title, accent, children, right }: { title: string; accent: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1.5, color: accent, textTransform: 'uppercase' }}>{title}</div>
        {right}
      </div>
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 12px' }}>{children}</div>
    </div>
  );
}

function VirtualContactList({
  items, sel, setSel, toggleFav, callContact,
}: {
  items: ContactItem[];
  sel: ContactItem | null;
  setSel: (i: ContactItem) => void;
  toggleFav: (i: ContactItem) => void;
  callContact: (i: ContactItem) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const ROW = 56;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 10,
  });

  if (items.length === 0) {
    return (
      <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12, padding: 28, textAlign: 'center', color: c.mutedSilver, fontSize: 12 }}>
        No contacts match.
      </div>
    );
  }

  // For small lists, skip virtualization overhead
  const useVirtual = items.length > 50;
  const virtualItems = useVirtual ? virtualizer.getVirtualItems() : items.map((_, i) => ({ index: i, start: i * ROW, key: i, size: ROW }));
  const totalSize = useVirtual ? virtualizer.getTotalSize() : items.length * ROW;

  return (
    <div
      ref={parentRef}
      style={{
        background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12,
        overflow: 'auto', maxHeight: useVirtual ? 600 : undefined,
        position: 'relative',
      }}
    >
      <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
        {virtualItems.map((v: any) => {
          const k = items[v.index];
          if (!k) return null;
          const online = k.tags.includes('online');
          return (
            <div
              key={k.id}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                transform: `translateY(${v.start}px)`,
                display: 'grid', gridTemplateColumns: '32px 1fr 80px 90px 90px',
                alignItems: 'center', gap: 12, width: '100%', height: ROW,
                padding: '10px 14px', boxSizing: 'border-box',
                background: sel?.id === k.id ? 'rgba(122,76,255,0.06)' : 'transparent',
                borderBottom: `1px solid ${c.border}`, color: c.textIce,
              }}
            >
              <button onClick={() => setSel(k)} style={{ ...avatar, border: 'none', cursor: 'pointer', position: 'relative' }}>
                {initials(k.name)}
                {k.tags.includes('internal') && (
                  <span style={{
                    position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%',
                    background: online ? c.success : c.mutedSilver, border: `2px solid ${c.bgCard}`,
                  }} />
                )}
              </button>
              <button onClick={() => setSel(k)} style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', minWidth: 0, color: c.textIce }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {k.name}{k.favorite && <span style={{ color: c.signalGold, marginLeft: 6 }}>★</span>}
                </div>
                <div style={{ fontSize: 10.5, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {k.company || k.phone}
                </div>
              </button>
              <span style={{ fontSize: 11, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{k.phone}</span>
              <button onClick={() => toggleFav(k)} title="Favorite" style={{ background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 8, padding: '4px 8px', color: k.favorite ? c.signalGold : c.mutedSilver, cursor: 'pointer', fontSize: 14 }}>{k.favorite ? '★' : '☆'}</button>
              <button onClick={() => callContact(k)} disabled={!k.phone} style={{ background: c.signalGold, border: 'none', borderRadius: 8, padding: '6px 10px', color: c.midnight, fontSize: 11, fontWeight: 700, cursor: k.phone ? 'pointer' : 'not-allowed', opacity: k.phone ? 1 : 0.4 }}>📞 Call</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
