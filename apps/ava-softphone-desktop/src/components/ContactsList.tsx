import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ava } from '../lib/avaApi';
import { theme } from '../lib/theme';
import SkeletonRows from './ui/SkeletonRows';

const { colors: c } = theme;

interface ExtRow {
  id: string;
  extension: string;
  effective_cid_name: string | null;
  description: string | null;
  enabled: boolean | null;
  do_not_disturb: boolean | null;
  status?: string | null;
}

interface PresenceRow {
  extension: string;
  status: string | null;
  last_seen_at: string | null;
}

interface Props {
  selfExtension: string;
  onCall: (n: string) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #0023e6, #2a4dff)',
  'linear-gradient(135deg, #7C3AED, #A855F7)',
  'linear-gradient(135deg, #0891B2, #06B6D4)',
  'linear-gradient(135deg, #059669, #10B981)',
  'linear-gradient(135deg, #D97706, #F59E0B)',
  'linear-gradient(135deg, #DC2626, #EF4444)',
  'linear-gradient(135deg, #7C3AED, #0023e6)',
  'linear-gradient(135deg, #0891B2, #7C3AED)',
];

function avatarGradient(ext: string): string {
  const idx = parseInt(ext, 10) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] || AVATAR_GRADIENTS[0];
}

function statusLabel(st: string, dnd: boolean): string {
  if (dnd) return 'Do Not Disturb';
  if (st === 'oncall' || st === 'busy') return 'On Call';
  if (st === 'available' || st === 'online') return 'Available';
  if (st === 'away') return 'Away';
  return 'Offline';
}

export default function ContactsList({ selfExtension, onCall }: Props) {
  const [exts, setExts] = useState<ExtRow[]>([]);
  const [presence, setPresence] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'available' | 'oncall'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [extRows, presRes] = await Promise.all([
      ava.extensions().catch(() => [] as any[]),
      supabase
        .from('pbx_softphone_users')
        .select('extension,status,last_seen_at'),
    ]);
    setExts((extRows || []).map((e: any) => ({
      id: e.id,
      extension: String(e.extension),
      effective_cid_name: e.displayName || null,
      description: e.user || null,
      enabled: e.enabled !== false,
      do_not_disturb: !!e.doNotDisturb,
      status: e.status || null,
    })));
    if (!presRes.error && presRes.data) {
      const map: Record<string, string> = {};
      (presRes.data as PresenceRow[]).forEach((p) => { map[p.extension] = p.status || 'offline'; });
      (extRows || []).forEach((e: any) => { if (e.extension && e.status && !map[e.extension]) map[e.extension] = e.status; });
      setPresence(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('blf-presence')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pbx_softphone_users' },
        (payload) => {
          const row = (payload.new || payload.old) as PresenceRow;
          if (!row?.extension) return;
          setPresence((prev) => ({ ...prev, [row.extension]: (payload.new as PresenceRow)?.status || 'offline' }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exts
      .filter((e) => e.extension !== selfExtension)
      .filter((e) => {
        if (!needle) return true;
        return (
          e.extension.toLowerCase().includes(needle) ||
          (e.effective_cid_name || '').toLowerCase().includes(needle) ||
          (e.description || '').toLowerCase().includes(needle)
        );
      })
      .filter((e) => {
        if (filter === 'all') return true;
        const st = presence[e.extension] || 'offline';
        if (filter === 'available') return st === 'available' || st === 'online';
        if (filter === 'oncall') return st === 'oncall' || st === 'busy';
        return true;
      })
      .sort((a, b) => {
        const nameA = (a.effective_cid_name || a.description || `Ext ${a.extension}`).toLowerCase();
        const nameB = (b.effective_cid_name || b.description || `Ext ${b.extension}`).toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [exts, q, selfExtension, filter, presence]);

  // Group by first letter
  const grouped = useMemo(() => {
    const groups: Record<string, ExtRow[]> = {};
    filtered.forEach((e) => {
      const name = e.effective_cid_name || e.description || `Ext ${e.extension}`;
      const letter = name[0]?.toUpperCase() || '#';
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const onlineCount = useMemo(() =>
    exts.filter((e) => e.extension !== selfExtension && (presence[e.extension] === 'available' || presence[e.extension] === 'online')).length,
    [exts, presence, selfExtension]);

  if (loading) return <SkeletonRows rows={7} avatar label="Loading contacts" />;
  if (err) return <div style={{ textAlign: 'center', padding: 40, color: c.danger, fontSize: 12 }}>{err}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header with search and stats */}
      <div style={{
        padding: '10px 12px 8px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        {/* Stats row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#7C8AA8', fontWeight: 600, letterSpacing: 0.5 }}>
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: '#10B981', fontWeight: 600,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: 20, padding: '2px 8px',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10B981', animation: 'statusPulse 2s ease-in-out infinite' }} />
            {onlineCount} online
          </span>
        </div>

        {/* Search bar */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: '#7C8AA8', fontSize: 13, pointerEvents: 'none',
          }}>🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or extension…"
            aria-label="Search contacts"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 10, padding: '7px 10px 7px 32px',
              color: '#E8EEFB', fontSize: 12, outline: 'none',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,35,230,0.6)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#7C8AA8', cursor: 'pointer', fontSize: 14, padding: 0,
              }}
            >✕</button>
          )}
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'available', 'oncall'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                background: filter === f ? (f === 'available' ? 'rgba(16,185,129,0.18)' : f === 'oncall' ? 'rgba(245,158,11,0.18)' : 'rgba(0,35,230,0.18)') : 'rgba(255,255,255,0.04)',
                borderColor: filter === f ? (f === 'available' ? 'rgba(16,185,129,0.5)' : f === 'oncall' ? 'rgba(245,158,11,0.5)' : 'rgba(0,35,230,0.5)') : 'rgba(255,255,255,0.10)',
                color: filter === f ? (f === 'available' ? '#10B981' : f === 'oncall' ? '#F59E0B' : '#6B8AFF') : '#7C8AA8',
                transition: 'all 0.15s ease',
              }}
            >
              {f === 'all' ? 'All' : f === 'available' ? '● Available' : '● On Call'}
            </button>
          ))}
        </div>
      </div>

      {/* Contact list */}
      <div className="lemtel-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#7C8AA8', fontSize: 12 }}>
            No contacts found
          </div>
        ) : (
          grouped.map(([letter, contacts]) => (
            <div key={letter}>
              {/* Section header */}
              <div style={{
                padding: '6px 14px 4px',
                fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                color: '#7C8AA8', textTransform: 'uppercase',
                background: 'rgba(255,255,255,0.02)',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                position: 'sticky', top: 0, zIndex: 2,
              }}>
                {letter}
              </div>

              {contacts.map((e) => {
                const st = presence[e.extension] || 'offline';
                const dnd = !!e.do_not_disturb;
                const dotColor =
                  dnd ? '#EF4444' :
                  st === 'oncall' || st === 'busy' ? '#F59E0B' :
                  st === 'available' || st === 'online' ? '#10B981' :
                  st === 'away' ? '#F59E0B' :
                  '#4B5563';
                const name = e.effective_cid_name || e.description || `Extension ${e.extension}`;
                const isOnline = (st === 'available' || st === 'online') && !dnd;
                const isOnCall = st === 'oncall' || st === 'busy';

                return (
                  <div
                    key={e.id}
                    role="row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11,
                      padding: '9px 12px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'default',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    {/* Avatar with presence ring */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: avatarGradient(e.extension),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 14, fontWeight: 700,
                        border: `2px solid ${dnd ? '#EF4444' : isOnCall ? '#F59E0B' : isOnline ? '#10B981' : 'rgba(255,255,255,0.10)'}`,
                        boxShadow: isOnline ? '0 0 10px rgba(16,185,129,0.3)' : isOnCall ? '0 0 10px rgba(245,158,11,0.3)' : 'none',
                        letterSpacing: 0.5,
                      }}>
                        {initials(name)}
                      </div>
                      {/* Status dot */}
                      <span style={{
                        position: 'absolute', bottom: 1, right: 1,
                        width: 10, height: 10, borderRadius: '50%',
                        background: dotColor,
                        border: '2px solid #060C1C',
                        boxShadow: `0 0 6px ${dotColor}`,
                        animation: isOnline ? 'statusPulse 2s ease-in-out infinite' : 'none',
                      }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: '#E8EEFB', fontSize: 13, fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        marginBottom: 2,
                      }}>{name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          background: 'rgba(224,168,0,0.12)', color: '#E0A800',
                          border: '1px solid rgba(224,168,0,0.25)',
                          borderRadius: 4, padding: '1px 5px',
                          fontSize: 10, fontWeight: 700, flexShrink: 0,
                        }}>Ext {e.extension}</span>
                        <span style={{
                          fontSize: 10, color: dotColor, fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}>
                          {statusLabel(st, dnd)}
                        </span>
                      </div>
                    </div>

                    {/* Call button */}
                    <button
                      onClick={() => onCall(e.extension)}
                      aria-label={`Call ${name}, extension ${e.extension}`}
                      title={`Call ${name}`}
                      style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #059669, #10B981)',
                        border: '1px solid rgba(16,185,129,0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0,
                        boxShadow: '0 2px 10px rgba(16,185,129,0.35)',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                      }}
                      onMouseEnter={(ev) => {
                        ev.currentTarget.style.transform = 'scale(1.12)';
                        ev.currentTarget.style.boxShadow = '0 4px 18px rgba(16,185,129,0.55)';
                      }}
                      onMouseLeave={(ev) => {
                        ev.currentTarget.style.transform = 'scale(1)';
                        ev.currentTarget.style.boxShadow = '0 2px 10px rgba(16,185,129,0.35)';
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="white"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
