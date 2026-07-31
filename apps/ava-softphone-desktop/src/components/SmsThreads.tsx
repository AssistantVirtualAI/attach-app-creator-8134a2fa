import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, SB_URL, SB_KEY } from '@/lib/supabaseClient';
import { audit } from '@/lib/audit';
import SkeletonRows from './ui/SkeletonRows';
import { theme } from '../lib/theme';

const { colors: c } = theme;

interface Thread {
  id: string;
  did_number: string;
  contact_phone: string;
  contact_name: string | null;
  unread_count: number | null;
  last_message_at: string | null;
}

interface Msg {
  id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  body: string | null;
  sent_at: string | null;
  status: string | null;
}

function fmtTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return same
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SmsThreads() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pbx_sms_threads')
      .select('id,did_number,contact_phone,contact_name,unread_count,last_message_at')
      .order('last_message_at', { ascending: false })
      .limit(200);
    if (error) setErr(error.message);
    else setThreads((data as Thread[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Realtime threads
  useEffect(() => {
    const ch = supabase
      .channel('sms-threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pbx_sms_threads' }, () => loadThreads())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadThreads]);

  // Load thread msgs
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pbx_sms_messages')
        .select('id,direction,from_number,to_number,body,sent_at,status')
        .eq('thread_id', selected.id)
        .order('sent_at', { ascending: true })
        .limit(200);
      if (!cancelled) setMsgs((data as Msg[]) || []);
    })();
    const ch = supabase
      .channel(`sms-msg-${selected.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pbx_sms_messages', filter: `thread_id=eq.${selected.id}` },
        (payload) => setMsgs((p) => [...p, payload.new as Msg]),
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const send = async () => {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { setErr('Not authenticated'); return; }
      const res = await fetch(`${SB_URL}/functions/v1/telnyx-sms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SB_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: selected.did_number,
          to: selected.contact_phone,
          text: draft.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Send failed'); return; }
      audit('sms.sent', selected.id, { to: selected.contact_phone, did: selected.did_number, len: draft.trim().length });
      setDraft('');
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} avatar label="Loading SMS" />;

  if (selected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <button onClick={() => setSelected(null)} style={backBtn}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.contact_name || selected.contact_phone}
            </div>
            <div style={{ fontSize: 10, opacity: 0.5 }}>via {selected.did_number}</div>
          </div>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 4 }}>
          {msgs.map((m) => {
            const out = m.direction === 'outbound';
            return (
              <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                <div style={{
                  background: out ? c.gold : c.overlay08,
                  color: out ? '#0a0a1a' : c.onAccent,
                  borderRadius: 12, padding: '6px 10px', fontSize: 13, wordBreak: 'break-word',
                }}>
                  {m.body}
                </div>
                <div style={{ fontSize: 9, opacity: 0.5, textAlign: out ? 'right' : 'left', marginTop: 2 }}>
                  {fmtTime(m.sent_at)}{out && m.status ? ` · ${m.status}` : ''}
                </div>
              </div>
            );
          })}
        </div>
        {err && <div style={{ color: c.danger, fontSize: 11 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message…"
            style={inputBox}
          />
          <button onClick={send} disabled={!draft.trim() || sending} style={sendBtn}>
            {sending ? '…' : '➤'}
          </button>
        </div>
      </div>
    );
  }

  if (threads.length === 0) return <div style={center}>No SMS threads</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {threads.map((t) => (
        <button key={t.id} onClick={() => setSelected(t)} style={rowBtn}>
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.contact_name || t.contact_phone}
            </div>
            <div style={{ fontSize: 10, opacity: 0.55 }}>{t.did_number} · {fmtTime(t.last_message_at)}</div>
          </div>
          {t.unread_count ? (
            <span style={{ background: c.gold, color: '#0a0a1a', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
              {t.unread_count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const center: React.CSSProperties = { textAlign: 'center', padding: 40, opacity: 0.5, fontSize: 12 };
const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  background: `linear-gradient(155deg, ${c.overlay06} 0%, ${c.overlay02} 100%)`, border: `1px solid ${c.overlay08}`,
  borderRadius: 14, padding: '8px 10px', cursor: 'pointer', color: c.text,
};
const backBtn: React.CSSProperties = {
  background: c.overlay08, border: 'none', color: c.onAccent,
  borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11,
};
const inputBox: React.CSSProperties = {
  flex: 1, background: c.overlay08,
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
  color: c.onAccent, padding: '8px 10px', fontSize: 13, outline: 'none',
};
const sendBtn: React.CSSProperties = {
  background: c.gold, color: '#0a0a1a', border: 'none',
  borderRadius: 8, padding: '0 14px', fontSize: 16, cursor: 'pointer', fontWeight: 700,
};
