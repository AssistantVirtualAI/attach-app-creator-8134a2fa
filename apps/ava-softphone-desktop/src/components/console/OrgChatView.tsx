import React, { useEffect, useMemo, useRef, useState } from 'react';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabaseClient';
import { useTranslation } from '../../lib/i18n';
import { mergeIncoming, mergeOnFetch } from './orgChatMerge';


const { colors: c } = theme;

// Inject typing-dot animation once
if (typeof document !== 'undefined' && !document.getElementById('ava-chat-anim')) {
  const s = document.createElement('style');
  s.id = 'ava-chat-anim';
  s.textContent = `
    @keyframes typing-dot { 0%,80%,100% { transform: scale(0.7); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
  `;
  document.head.appendChild(s);
}

type Channel = { id: string; name: string; channel_type: string; organization_id: string; members: string[] | null; archived_at: string | null };
type Message = { id: string; channel_id: string; sender_id: string; sender_name: string | null; content: string; created_at: string; reactions?: Record<string, string[]> | null; attachments?: any[] | null; message_type?: string; edited_at?: string | null };
type Member = { user_id: string; display_name: string; extension: string | null; status: string; call_state: string | null };

// Module-level cache: survives component unmount/remount so navigating away
// and back never appears to "erase" the chat. Bounded to 500 msgs per channel.
const CHANNEL_CACHE = new Map<string, Message[]>();
const CACHE_MAX = 500;
const cacheGet = (id: string): Message[] => CHANNEL_CACHE.get(id) || [];
const cacheSet = (id: string, msgs: Message[]) => {
  const trimmed = msgs.length > CACHE_MAX ? msgs.slice(-CACHE_MAX) : msgs;
  CHANNEL_CACHE.set(id, trimmed);
};

const EMOJIS = ['👍','❤️','😂','🎉','🚀','👀'];


const STATUS_COLOR: Record<string, string> = {
  online: c.success, available: c.success,
  busy: '#ff5a5f', dnd: '#ff5a5f', on_call: '#ff8a3d',
  away: '#f4c248', idle: '#f4c248',
  offline: '#6b7280',
};

const isDmChannel = (ch: Channel) => ch.channel_type === 'dm' || ch.name.startsWith('dm:');

export default function OrgChatView() {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [orgId, setOrgId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [showGroup, setShowGroup] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingChanRef = useRef<any>(null);
  const lastTypingAt = useRef(0);

  const loadUnread = async () => {
    const { data } = await supabase.functions.invoke('org-chat', { body: { action: 'unread_counts' } });
    const counts = (data as any)?.counts ?? [];
    const m: Record<string, number> = {};
    counts.forEach((r: any) => { m[r.channel_id] = Number(r.unread_count); });
    setUnread(m);
  };

  const loadChannels = async (org: string) => {
    const edge = await supabase.functions.invoke('org-chat', { body: { action: 'list_channels' } }).catch(() => ({ data: null, error: null } as any));
    if (Array.isArray((edge.data as any)?.channels)) {
      const channels = (edge.data as any).channels as Channel[];
      setChannels(channels);
      return channels;
    }
    const { data, error } = await supabase.from('org_chat_channels')
      .select('id,name,channel_type,organization_id,members,archived_at')
      .eq('organization_id', org).is('archived_at', null)
      .order('name');
    if (error) { setErrMsg(`Channels error: ${error.message}`); return [] as Channel[]; }
    setChannels(data ?? []);
    return (data ?? []) as Channel[];
  };

  const loadMembers = async (org: string) => {
    const { data: dir } = await supabase.functions.invoke('org-chat', { body: { action: 'list_directory' } }).catch(() => ({ data: null } as any));
    if (Array.isArray((dir as any)?.members)) {
      setMembers((dir as any).members.map((m: any) => ({
        user_id: m.user_id,
        display_name: m.full_name || m.email || `Ext ${m.extension || ''}`,
        extension: m.extension,
        status: m.status || 'offline',
        call_state: m.call_state || null,
      })));
      return;
    }
    const { data: spus } = await supabase.from('pbx_softphone_users')
      .select('portal_user_id, display_name, extension')
      .eq('organization_id', org)
      .not('portal_user_id', 'is', null);
    const ids = (spus ?? []).map((s: any) => s.portal_user_id);
    let presence: Record<string, any> = {};
    if (ids.length) {
      const { data: pres } = await supabase.from('user_presence')
        .select('user_id,status,call_state,last_seen_at').in('user_id', ids);
      (pres ?? []).forEach((p: any) => { presence[p.user_id] = p; });
    }
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    setMembers((spus ?? []).map((s: any) => {
      const p = presence[s.portal_user_id];
      const seen = p?.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
      const isActive = seen >= fiveMinAgo;
      return {
        user_id: s.portal_user_id,
        display_name: s.display_name || `Ext ${s.extension}`,
        extension: s.extension,
        status: isActive ? (p?.status && p.status !== 'offline' ? p.status : 'online') : 'offline',
        call_state: p?.call_state || null,
      };
    }));
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) { setErrMsg('Sign in required to use Team Chat.'); return; }
        const name = (u.user.user_metadata as any)?.full_name ?? u.user.email ?? 'You';
        setMe({ id: u.user.id, name });

        let org: string | null = null;
        const { data: spu } = await supabase.from('pbx_softphone_users')
          .select('organization_id').eq('portal_user_id', u.user.id).maybeSingle();
        org = spu?.organization_id ?? null;
        if (!org) {
          const { data: om } = await supabase.from('organization_members')
            .select('organization_id').eq('user_id', u.user.id).limit(1).maybeSingle();
          org = om?.organization_id ?? null;
        }
        if (!org) {
          const { data: ur } = await supabase.from('user_roles')
            .select('organization_id').eq('user_id', u.user.id).limit(1).maybeSingle();
          org = ur?.organization_id ?? null;
        }
        if (!org) { setErrMsg('No organization linked to your account yet — ask an admin to add you.'); return; }
        setOrgId(org);

        await supabase.rpc('ensure_general_channel', { _org_id: org, _user_id: u.user.id });

        const chs = await loadChannels(org);
        const first = chs.find((c) => !isDmChannel(c));
        if (first) setActiveId(first.id);

        await loadMembers(org);

        const { data: r } = await supabase.from('org_chat_reads')
          .select('channel_id,last_read_at').eq('user_id', u.user.id);
        const map: Record<string, string> = {};
        (r ?? []).forEach((x: any) => { map[x.channel_id] = x.last_read_at; });
        setReads(map);
        await loadUnread();
      } catch (e: any) {
        setErrMsg(e?.message || 'Failed to load team chat.');
      }
    })();
  }, []);

  // Unread polling + invalidation on new msgs
  useEffect(() => {
    if (!orgId) return;
    const id = setInterval(loadUnread, 20000);
    const ch = supabase.channel('chat-unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'org_chat_messages' }, () => loadUnread())
      .subscribe();
    return () => { clearInterval(id); supabase.removeChannel(ch); };
  }, [orgId]);

  // Realtime presence
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase.channel(`org-chat-presence-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => {
        loadMembers(orgId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]);

  // Messages
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setTypingNames([]);

    // Hydrate immediately from module-level cache so the UI never appears empty.
    const cached = cacheGet(activeId);
    if (cached.length) setMessages(cached);

    (async () => {
      const { data, error } = await supabase.from('org_chat_messages')
        .select('id,channel_id,sender_id,sender_name,content,created_at,reactions,attachments,message_type,edited_at')
        .eq('channel_id', activeId).is('deleted_at', null)
        .order('created_at', { ascending: true }).limit(100);
      if (cancelled) return;
      if (error) {
        // Do NOT clear messages on a fetch error — keep what we already have.
        setErrMsg(`Messages error: ${error.message}`);
        return;
      }
      setMessages((prev) => {
        const next = mergeOnFetch(prev as any, (data ?? []) as any, activeId) as Message[];
        cacheSet(activeId, next);
        return next;
      });
    })();

    // Standardized realtime channel name (matches src/hooks/useOrgChat.ts).
    const ch = supabase.channel(`org-chat-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'org_chat_messages', filter: `channel_id=eq.${activeId}` },
        (payload) => setMessages((m) => {
          const next = mergeIncoming(m as any, [payload.new as any], activeId) as Message[];
          cacheSet(activeId, next);
          return next;
        }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'org_chat_messages', filter: `channel_id=eq.${activeId}` },
        (payload) => setMessages((m) => {
          const next = m.map((x) => x.id === (payload.new as any).id ? (payload.new as Message) : x);
          cacheSet(activeId, next);
          return next;
        }))
      .subscribe();


    // typing broadcast channel
    const typingCh = supabase.channel(`chat-typing-${activeId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        if (!payload?.name || payload?.user_id === me?.id) return;
        setTypingNames((cur) => {
          const next = Array.from(new Set([...cur, payload.name]));
          setTimeout(() => setTypingNames((c) => c.filter((n) => n !== payload.name)), 3500);
          return next;
        });
      })
      .subscribe();
    typingChanRef.current = typingCh;

    return () => { cancelled = true; supabase.removeChannel(ch); supabase.removeChannel(typingCh); typingChanRef.current = null; };
  }, [activeId, me?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    if (activeId && me) {
      const now = new Date().toISOString();
      supabase.functions.invoke('org-chat', { body: { action: 'mark_read', payload: { channel_id: activeId } } }).then(() => {
        setReads((r) => ({ ...r, [activeId]: now }));
        setUnread((u) => ({ ...u, [activeId]: 0 }));
      });
    }
  }, [messages, activeId, me]);

  const send = async () => {
    if (!input.trim() || !activeId || !me || !orgId) return;
    const text = input.trim();
    setInput('');
    const { error, data } = await supabase.functions.invoke('org-chat', {
      body: { action: 'send_message', payload: { channel_id: activeId, content: text } },
    });
    if (error || (data as any)?.error) setErrMsg(`Message error: ${((error as any)?.message || (data as any)?.error)}`);
  };

  const handleTyping = (v: string) => {
    setInput(v);
    if (!v || !me) return;
    const now = Date.now();
    if (now - lastTypingAt.current < 1500) return;
    lastTypingAt.current = now;
    typingChanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: me.id, name: me.name } });
  };

  const toggleReaction = async (id: string, emoji: string) => {
    await supabase.functions.invoke('org-chat', { body: { action: 'toggle_reaction', payload: { id, emoji } } });
    setEmojiFor(null);
  };

  const uploadFile = async (file: File) => {
    if (!activeId || file.size > 25 * 1024 * 1024) { setErrMsg('File too big (max 25MB)'); return; }
    const up = await supabase.functions.invoke('org-chat', { body: { action: 'upload_url', payload: { filename: file.name } } });
    const u = (up.data as any);
    if (!u?.signedUrl) { setErrMsg('Upload init failed'); return; }
    const r = await fetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!r.ok) { setErrMsg('Upload failed'); return; }
    await supabase.functions.invoke('org-chat', {
      body: { action: 'send_message', payload: { channel_id: activeId, content: '', attachments: [{ path: u.path, name: file.name, mime: file.type, size: file.size }] } },
    });
  };

  const signedUrlCache = useRef<Record<string, string>>({});
  const getSigned = async (path: string): Promise<string> => {
    if (signedUrlCache.current[path]) return signedUrlCache.current[path];
    const { data } = await supabase.functions.invoke('org-chat', { body: { action: 'signed_url', payload: { path } } });
    const url = (data as any)?.url || '';
    if (url) signedUrlCache.current[path] = url;
    return url;
  };

  const startCall = (to: string | string[]) => {
    window.dispatchEvent(new CustomEvent('lemtel:start-call', { detail: { to } }));
  };

  const openDM = async (otherId: string, otherName: string) => {
    if (!me || !orgId || otherId === me.id) return;
    if (!otherId || String(otherId).startsWith('ext:')) {
      setErrMsg("This teammate hasn't activated their portal yet — DM unavailable.");
      return;
    }
    const key = [me.id, otherId].sort().join(':');
    const dmName = `dm:${key}`;
    let dm = channels.find((c) => isDmChannel(c) && (c.name === dmName || (c.members?.includes(me.id) && c.members?.includes(otherId))));
    if (!dm) {
      const { data, error } = await supabase.functions.invoke('org-chat', { body: { action: 'ensure_dm_channel', payload: { user_id: otherId } } });
      const err = (error as any)?.message || (data as any)?.error;
      if (err) { setErrMsg(['not_in_org', 'not_in_domain'].includes(err) ? 'Teammate is not linked to your PBX domain.' : `DM error: ${err}`); return; }
      if (!(data as any)?.channel) { setErrMsg('Unable to open chat'); return; }
      dm = (data as any).channel as Channel;
      setChannels((cs) => [...cs, dm!]);
    }
    setActiveId(dm.id);
  };

  const createGroup = async (name: string, memberIds: string[]) => {
    if (!me || !orgId || !name.trim()) return;
    const { data, error } = await supabase.from('org_chat_channels').insert({
      organization_id: orgId, name: name.trim(), description: null,
      channel_type: 'private', created_by: me.id, members: [...new Set([me.id, ...memberIds])],
    }).select('*').single();
    if (error) { alert('Group error: ' + error.message); return; }
    setChannels((cs) => [...cs, data as Channel]);
    setActiveId((data as Channel).id);
    setShowGroup(false);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, search]);

  const dmNameFor = (ch: Channel) => {
    if (!me || !isDmChannel(ch) || !ch.members) return ch.name;
    const other = ch.members.find((id) => id !== me.id);
    return members.find((m) => m.user_id === other)?.display_name || 'Direct message';
  };

  const visibleChannels = channels.filter((c) => !isDmChannel(c) && !((c.members?.length ?? 0) > 2 && c.channel_type === 'private'));
  const groupChannels = channels.filter((c) => c.channel_type === 'private' && (c.members?.length ?? 0) > 2);
  const dmChannels = channels.filter((c) => isDmChannel(c));
  const activeChannel = channels.find((ch) => ch.id === activeId);
  const isActiveDm = !!activeChannel && isDmChannel(activeChannel);
  const isActiveGroup = !!activeChannel && activeChannel.channel_type === 'private' && (activeChannel.members?.length ?? 0) > 2;

  const headerLabel = activeChannel
    ? (isActiveDm ? '@ ' + dmNameFor(activeChannel)
      : isActiveGroup ? '👥 ' + activeChannel.name
      : (activeChannel.channel_type === 'private' ? '🔒 ' : '# ') + activeChannel.name)
    : '—';

  const otherDmUserId = isActiveDm ? (activeChannel?.members || []).find((id) => id !== me?.id) : null;
  const otherDmMember = otherDmUserId ? members.find((m) => m.user_id === otherDmUserId) : null;
  const groupExtensions = isActiveGroup ? (activeChannel?.members || []).filter((id) => id !== me?.id).map((id) => members.find((m) => m.user_id === id)?.extension).filter(Boolean) as string[] : [];
  const canCall = (isActiveDm && !!otherDmMember?.extension) || (isActiveGroup && groupExtensions.length > 0);

  const renderChannelRow = (ch: Channel, label: string, icon: string) => {
    const active = ch.id === activeId;
    const unreadN = unread[ch.id] || 0;
    return (
      <button key={ch.id} onClick={() => setActiveId(ch.id)} style={{
        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '7px 10px', marginBottom: 2, borderRadius: 8, border: 'none', cursor: 'pointer',
        background: active ? 'rgba(122,76,255,0.18)' : 'transparent',
        color: active ? c.textIce : c.mutedSilver,
        fontSize: 12.5, fontWeight: active || unreadN > 0 ? 700 : 500, textAlign: 'left',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{icon} {label}</span>
        {unreadN > 0 && !active && (
          <span style={{ background: c.danger, color: c.onAccent, fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>{unreadN}</span>
        )}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>

      {/* ─── SIDEBAR ─── */}
      <aside style={{
        width: 220, flexShrink: 0,
        borderRight: `1px solid ${c.overlay06}`,
        background: c.bgElev,
        display: 'flex', flexDirection: 'column',
        overflowY: 'hidden',
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: '14px 14px 12px',
          borderBottom: `1px solid ${c.border}`,
          background: 'linear-gradient(135deg, rgba(0,35,230,0.10), transparent 70%)',
          position: 'relative',
          flexShrink: 0,
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${c.warning}, rgba(0,35,230,0.6) 60%, transparent)` }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(224,168,0,0.15)', border: '1px solid rgba(224,168,0,0.30)', color: c.warning, fontSize: 13 }}>💬</div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.8, color: c.warning, textTransform: 'uppercase' }}>Team Chat</div>
                <div style={{ fontSize: 10, color: c.textSub, marginTop: 1 }}>{channels.length} channels</div>
              </div>
            </div>
            <button onClick={() => setShowGroup(true)} title="New group" style={{
              background: 'linear-gradient(135deg, rgba(0,35,230,0.30), rgba(122,76,255,0.30))',
              border: '1px solid rgba(0,35,230,0.45)',
              color: '#8CB4FF', fontSize: 14, width: 26, height: 26, borderRadius: 8,
              cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,35,230,0.25)',
            }}>+</button>
          </div>
        </div>

        <div style={{ flex: 1, padding: '8px 6px', overflowY: 'auto' }}>
          {/* Public channels */}
          {visibleChannels.length === 0 && <div style={{ fontSize: 11, color: c.mutedSilver, padding: '4px 6px' }}>{t('orgchat.noChannels')}</div>}
          {visibleChannels.map((ch) => renderChannelRow(ch, ch.name, ch.channel_type === 'private' ? '🔒' : '#'))}

          {/* Groups */}
          {groupChannels.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: c.warning, textTransform: 'uppercase', padding: '14px 8px 5px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ flex: 1 }}>Groups</span>
                <span style={{ fontSize: 9, background: 'rgba(224,168,0,0.15)', color: c.warning, padding: '1px 5px', borderRadius: 4 }}>{groupChannels.length}</span>
              </div>
              {groupChannels.map((ch) => renderChannelRow(ch, ch.name, '👥'))}
            </>
          )}

          {/* DMs */}
          {dmChannels.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: c.warning, textTransform: 'uppercase', padding: '14px 8px 5px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ flex: 1 }}>Direct</span>
                <span style={{ fontSize: 9, background: 'rgba(224,168,0,0.15)', color: c.warning, padding: '1px 5px', borderRadius: 4 }}>{dmChannels.length}</span>
              </div>
              {dmChannels.map((ch) => renderChannelRow(ch, dmNameFor(ch), '@'))}
            </>
          )}

          {/* Team members */}
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: c.warning, textTransform: 'uppercase', padding: '14px 8px 5px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ flex: 1 }}>Team</span>
            <span style={{ fontSize: 9, background: 'rgba(224,168,0,0.15)', color: c.warning, padding: '1px 5px', borderRadius: 4 }}>{members.length}</span>
          </div>
          {members.length === 0 && <div style={{ fontSize: 11, color: c.mutedSilver, padding: '4px 6px' }}>No teammates yet.</div>}
          {members.filter((m) => m.user_id !== me?.id).map((m) => {
            const color = STATUS_COLOR[m.status] || STATUS_COLOR.offline;
            return (
              <button key={m.user_id} onClick={() => openDM(m.user_id, m.display_name)} style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 7,
                padding: '5px 8px', marginBottom: 1, borderRadius: 7, border: 'none', cursor: 'pointer',
                background: 'transparent', color: c.textDim, fontSize: 12, textAlign: 'left',
                transition: 'background .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = c.overlay04)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Avatar initials */}
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: `linear-gradient(135deg, rgba(0,35,230,0.6), rgba(122,76,255,0.6))`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: c.onAccent, position: 'relative',
                }}>
                  {m.display_name.charAt(0).toUpperCase()}
                  <span style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 8, height: 8, borderRadius: '50%',
                    background: color, border: `1.5px solid ${c.bgCard}`,
                  }} />
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 }}>{m.display_name}</span>
              </button>
            );
          })}
          {errMsg && <div style={{ fontSize: 10, color: '#f87171', marginTop: 8, padding: '0 6px' }}>{errMsg}</div>}
        </div>
      </aside>

      {/* ─── MAIN CHAT AREA ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* Chat header */}
        <div style={{
          padding: '10px 18px', flexShrink: 0,
          borderBottom: `1px solid ${c.border}`,
          background: 'linear-gradient(135deg, rgba(0,35,230,0.06), transparent 70%)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {headerLabel || <span style={{ color: c.textDim }}>Select a channel</span>}
            </div>
            {activeChannel && (
              <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>
                {isActiveDm && otherDmMember ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[otherDmMember.status] || STATUS_COLOR.offline, display: 'inline-block' }} />
                    {otherDmMember.status === 'on_call' ? 'On a call' : otherDmMember.status.charAt(0).toUpperCase() + otherDmMember.status.slice(1)}
                    {otherDmMember.extension && <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>Ext {otherDmMember.extension}</span>}
                  </span>
                ) : isActiveGroup ? (
                  <span>{(activeChannel.members?.length ?? 0)} members</span>
                ) : (
                  <span>{messages.length} messages</span>
                )}
              </div>
            )}
          </div>
          {canCall && (
            <button onClick={() => {
              if (isActiveDm && otherDmMember?.extension) startCall(otherDmMember.extension);
              else if (isActiveGroup) {
                startCall(groupExtensions);
                supabase.functions.invoke('org-chat', { body: { action: 'send_message', payload: { channel_id: activeId, content: `📞 ${me?.name} started a group call.` } } });
              }
            }} style={{
              padding: '5px 12px', borderRadius: 8,
              border: '1px solid rgba(34,211,154,0.30)',
              background: 'rgba(34,211,154,0.12)', color: c.success,
              cursor: 'pointer', fontSize: 11.5, fontWeight: 700, flexShrink: 0,
            }}>📞 {isActiveGroup ? 'Call group' : 'Call'}</button>
          )}
          {/* Search */}
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              padding: '5px 10px', borderRadius: 8,
              border: `1px solid ${c.overlay08}`,
              background: c.overlay04,
              color: c.text, fontSize: 11.5, width: 130, flexShrink: 0, outline: 'none',
            }} />
        </div>

        {/* Messages list */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: 'auto', padding: '16px 14px 8px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0,35,230,0.30) transparent',
        }}>
          {filtered.length === 0 && (
            <div style={{ color: c.textDim, fontSize: 12, textAlign: 'center', marginTop: 48 }}>
              {messages.length === 0 ? '👋 Say hi to your team!' : 'No messages match your search.'}
            </div>
          )}
          {filtered.map((m) => (
            <MessageRow key={m.id} m={m} meId={me?.id} onReact={(e) => toggleReaction(m.id, e)}
              emojiOpen={emojiFor === m.id} onToggleEmoji={() => setEmojiFor((p) => p === m.id ? null : m.id)}
              getSigned={getSigned} />
          ))}
        </div>

        {/* Typing indicator */}
        {typingNames.length > 0 && (
          <div style={{ padding: '4px 18px', fontSize: 11, color: c.textDim, fontStyle: 'italic', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'flex', gap: 3 }}>
              {[0,1,2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: c.textDim, display: 'inline-block', animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </span>
            <span>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</span>
          </div>
        )}

        {/* Composer */}
        <div style={{
          padding: '10px 14px 12px',
          borderTop: `1px solid ${c.border}`,
          background: c.bgCard,
          backdropFilter: 'blur(12px)',
          display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        }}>
          <button onClick={() => fileRef.current?.click()} disabled={!activeId} title="Attach file" style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            border: `1px solid ${c.overlay10}`,
            background: c.overlay04,
            color: c.textDim, cursor: activeId ? 'pointer' : 'not-allowed', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .15s',
          }}>
            📎
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadFile(f); e.target.value = ''; } }} />
          <input value={input} onChange={(e) => handleTyping(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={activeId ? `Message ${headerLabel || 'channel'}…` : 'Sélectionnez un canal pour commencer'}
            disabled={!activeId}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 12,
              border: `1px solid ${c.overlay10}`,
              background: c.overlay06,
              color: c.text, fontSize: 13, outline: 'none',
              transition: 'border-color .15s, box-shadow .15s',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.20)',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,35,230,0.50)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,35,230,0.15), inset 0 1px 3px rgba(0,0,0,0.20)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = c.overlay10; e.currentTarget.style.boxShadow = 'inset 0 1px 3px rgba(0,0,0,0.20)'; }}
          />
          <button onClick={send} disabled={!input.trim() || !activeId} title="Send (Enter)" style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            border: 'none', cursor: input.trim() && activeId ? 'pointer' : 'not-allowed',
            background: input.trim() && activeId
              ? `linear-gradient(135deg, ${c.primary}, ${c.ai})`
              : c.overlay06,
            color: c.onAccent, fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .15s',
            boxShadow: input.trim() && activeId ? '0 4px 14px rgba(0,35,230,0.40)' : 'none',
            transform: input.trim() && activeId ? 'translateY(-1px)' : 'none',
          }}>➤</button>
        </div>
      </div>


      {showGroup && me && (
        <NewGroupModal
          members={members.filter((m) => m.user_id !== me.id)}
          onClose={() => setShowGroup(false)}
          onCreate={createGroup}
        />
      )}
    </div>
  );
}

function NewGroupModal({ members, onClose, onCreate }: { members: Member[]; onClose: () => void; onCreate: (name: string, ids: string[]) => void }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 50, display: 'grid', placeItems: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: c.textIce, marginBottom: 12 }}>New group chat</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
          background: c.deepPanel, border: `1px solid ${c.border}`, color: c.textIce, fontSize: 13, outline: 'none', marginBottom: 12,
        }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: c.mutedSilver, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Members ({selected.size})</div>
        <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 8 }}>
          {members.length === 0 && <div style={{ padding: 12, color: c.mutedSilver, fontSize: 12 }}>No teammates available.</div>}
          {members.map((m) => (
            <label key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${c.border}`, fontSize: 12, color: c.textIce, cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(m.user_id)} onChange={() => toggle(m.user_id)} />
              <span style={{ flex: 1 }}>{m.display_name}</span>
              {m.extension && <span style={{ fontSize: 10, color: c.mutedSilver }}>{m.extension}</span>}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${c.border}`, color: c.mutedSilver, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onCreate(name, Array.from(selected))} disabled={!name.trim() || selected.size === 0} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, color: c.onAccent, cursor: 'pointer',
            background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            opacity: !name.trim() || selected.size === 0 ? 0.5 : 1,
          }}>Create</button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m, meId, onReact, emojiOpen, onToggleEmoji, getSigned }: {
  m: Message; meId?: string; onReact: (e: string) => void; emojiOpen: boolean; onToggleEmoji: () => void;
  getSigned: (path: string) => Promise<string>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (m.attachments ?? []).forEach(async (a: any) => {
      if (!urls[a.path]) { try { const u = await getSigned(a.path); setUrls((p) => ({ ...p, [a.path]: u })); } catch {} }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  if (m.message_type === 'deleted') return (
    <div style={{ fontSize: 11, fontStyle: 'italic', color: c.textDim, marginBottom: 10, paddingLeft: 42 }}>— message deleted</div>
  );

  const isMine = m.sender_id === meId;
  const reactions = m.reactions || {};
  const initials = (m.sender_name ?? 'U').charAt(0).toUpperCase();
  const now = new Date();
  const msgDate = new Date(m.created_at);
  const diffMs = now.getTime() - msgDate.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const isToday = msgDate.toDateString() === now.toDateString();
  const timeStr = isToday
    ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const relTime = diffMin < 1 ? 'just now'
    : diffMin < 60 ? `${diffMin}m ago`
    : diffH < 24 ? `${diffH}h ago`
    : timeStr;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMine ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginBottom: 10,
      position: 'relative',
    }}>
      {/* Avatar */}
      {!isMine && (
        <span style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(0,35,230,0.7), rgba(122,76,255,0.7))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: c.onAccent,
        }}>{initials}</span>
      )}

      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
        {/* Sender name + time */}
        {!isMine && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: c.text }}>{m.sender_name ?? 'User'}</span>
            <span style={{ fontSize: 10, color: c.textDim }} title={timeStr}>{relTime}{m.edited_at ? ' · edited' : ''}</span>
          </div>
        )}

        {/* Bubble */}
        {m.content && (
          <div style={{
            padding: '9px 14px',
            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            background: isMine
              ? `linear-gradient(135deg, ${c.primary} 0%, ${c.primary} 60%, ${c.ai} 100%)`
              : c.overlay08,
            border: isMine ? 'none' : `1px solid ${c.overlay10}`,
            boxShadow: isMine
              ? '0 4px 18px -6px rgba(0,35,230,0.50)'
              : '0 2px 8px -4px rgba(0,0,0,0.30)',
            color: c.text,
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>{m.content}</div>
        )}

        {/* Time for own messages */}
        {isMine && (
          <span style={{ fontSize: 9.5, color: c.textDim, marginTop: 3 }} title={timeStr}>{relTime}{m.edited_at ? ' · edited' : ''}</span>
        )}

        {/* Attachments */}
        {(m.attachments ?? []).map((a: any) => (
          <div key={a.path} style={{ marginTop: 6 }}>
            {a.mime?.startsWith('image/') && urls[a.path]
              ? <img src={urls[a.path]} alt={a.name} style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 10, border: `1px solid ${c.overlay10}` }} />
              : <a href={urls[a.path]} target="_blank" rel="noreferrer" style={{ color: '#8CB4FF', fontSize: 12 }}>📎 {a.name}</a>
            }
          </div>
        ))}

        {/* Reactions */}
        {Object.keys(reactions).length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            {Object.entries(reactions).map(([e, uids]) => (
              <button key={e} onClick={() => onReact(e)} style={{
                background: (uids as string[]).includes(meId || '') ? 'rgba(0,35,230,0.30)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${c.overlay10}`,
                color: c.text, fontSize: 11, padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
              }}>{e} {(uids as string[]).length}</button>
            ))}
          </div>
        )}

        {/* Emoji picker */}
        {emojiOpen && (
          <div style={{
            display: 'flex', gap: 6, marginTop: 5, padding: '5px 10px',
            background: 'rgba(6,12,28,0.95)',
            border: `1px solid ${c.overlay12}`,
            borderRadius: 10, width: 'fit-content',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => onReact(e)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}>{e}</button>
            ))}
          </div>
        )}
      </div>

      {/* React button on hover */}
      <button onClick={onToggleEmoji} title="React" style={{
        background: 'transparent', border: 'none', color: c.textDim,
        cursor: 'pointer', fontSize: 13, alignSelf: 'center', opacity: 0.6,
        padding: 2,
      }}>😊</button>
    </div>
  );
}
