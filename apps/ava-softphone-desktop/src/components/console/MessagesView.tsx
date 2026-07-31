import React, { useEffect, useState } from 'react';
import { theme } from '../../lib/theme';
import { ava, SmsThread, SmsMessage } from '../../lib/avaApi';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useOrgId } from '../../lib/useOrgId';
import {
import SkeletonRows from '../ui/SkeletonRows';
  loadTemplates, saveTemplates, interpolate, filterTemplates,
  getDefaultTemplateId, setDefaultTemplate,
  MsgTemplate, TemplateCategory, CATEGORIES,
} from '../../lib/messageTemplates';

const { colors: c } = theme;

interface Msg { id: string; from: 'me' | 'them'; body: string; at: string; status?: string; }

function fmtMsgTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function mapMsg(m: SmsMessage): Msg {
  return { id: m.id, from: m.from, body: m.body, at: fmtMsgTime(m.at), status: m.status };
}

export default function MessagesView() {
  const [threads, setThreads] = useState<SmsThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [templates, setTemplates] = useState<MsgTemplate[]>(() => loadTemplates());
  const [tplOpen, setTplOpen] = useState(false);
  const [tplQuery, setTplQuery] = useState('');
  const [tplCategory, setTplCategory] = useState<TemplateCategory | 'All'>('All');

  const loadThreads = React.useCallback(() => {
    ava.threads().then((t) => {
      setThreads(t);
      setActiveId((prev) => prev && t.some((x) => x.id === prev) ? prev : (t[0]?.id ?? null));
    }).catch(() => {});
  }, []);
  useEffect(() => { loadThreads(); }, [loadThreads]);
  const loadMessages = React.useCallback(async () => {
    if (!activeId) { setMsgs([]); return; }
    setMessagesLoading(true); setMessagesError(null);
    try {
      const rows = await ava.messages(activeId);
      setMsgs(rows.map(mapMsg));
      if (threads.find((t) => t.id === activeId)?.unread) {
        await ava.markThreadRead(activeId);
        setThreads((prev) => prev.map((t) => t.id === activeId ? { ...t, unread: 0 } : t));
        loadThreads();
      }
    } catch (err: any) {
      setMsgs([]);
      setMessagesError(err?.message || 'Unable to load live message history.');
    } finally {
      setMessagesLoading(false);
    }
  }, [activeId, threads, loadThreads]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Realtime: new SMS threads/messages for this tenant refresh the list.
  const orgId = useOrgId();
  useRealtimeRefresh({ table: 'pbx_sms_threads', organizationId: orgId }, loadThreads);
  useRealtimeRefresh({ table: 'pbx_sms_messages', organizationId: orgId }, () => { loadThreads(); loadMessages(); });

  const active = threads.find((t) => t.id === activeId);
  const contactKey = active?.id || '';
  const defaultTplId = contactKey ? getDefaultTemplateId(contactKey) : null;
  const visibleTemplates = filterTemplates(templates, tplQuery, tplCategory);

  const send = async () => {
    if (!draft.trim() || !activeId) return;
    const body = draft.trim();
    const m: Msg = { id: 'm' + Date.now(), from: 'me', body, at: 'sending…', status: 'sending' };
    setMsgs((p) => [...p, m]);
    setDraft('');
    try {
      await ava.sendMessage(activeId, body);
      setMsgs((p) => p.map((x) => x.id === m.id ? { ...x, at: 'sent', status: 'sent' } : x));
      loadThreads();
      setTimeout(loadMessages, 600);
    } catch (err) {
      setMsgs((p) => p.map((x) => x.id === m.id ? { ...x, at: 'failed', status: 'failed' } : x));
    }
  };

  const aiAction = async (action: 'professional' | 'shorten' | 'translate' | 'rewrite') => {
    if (!draft.trim()) return;
    setAiBusy(true);
    const r = await ava.aiRewrite(draft, action);
    setDraft(r.text);
    setAiBusy(false);
  };

  const applyTemplate = (tpl: MsgTemplate) => {
    const vars = { name: active?.contact.split(' ')[0] || 'there', me: 'AVA' };
    setDraft(interpolate(tpl.body, vars));
    setTplOpen(false);
    setTplQuery('');
  };

  const saveCurrentAsTemplate = () => {
    if (!draft.trim()) return;
    const label = prompt('Template name?');
    if (!label) return;
    const category = (prompt('Category? (Greeting, Follow-up, Scheduling, Closing, Custom)', 'Custom') || 'Custom') as TemplateCategory;
    const safeCat = CATEGORIES.includes(category) ? category : 'Custom';
    const next = [...templates, { id: 't' + Date.now(), label, body: draft, category: safeCat }];
    setTemplates(next);
    saveTemplates(next);
  };

  const deleteTemplate = (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveTemplates(next);
  };

  const toggleDefault = (id: string) => {
    if (!contactKey) return;
    setDefaultTemplate(contactKey, defaultTplId === id ? null : id);
    setTemplates([...templates]); // re-render to refresh star state
  };


  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Thread list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${c.border}`, background: c.deepPanel, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${c.border}`,
          background: `linear-gradient(135deg, rgba(0,82,204,0.12), transparent 70%)`,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, ${c.signalGold}, ${c.lemtelBlue} 60%, transparent)`,
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
              background: `linear-gradient(135deg, ${c.signalGold}22, ${c.lemtelBlue}1c)`,
              border: `1px solid ${c.borderGold}`, color: c.signalGold,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 2, color: c.signalGold, textTransform: 'uppercase' }}>Inbox</div>
              <h2 style={{ fontSize: 16, color: c.textIce, margin: '2px 0 0', letterSpacing: -0.2 }}>Messages</h2>
              <div style={{ fontSize: 10.5, color: c.mutedSilver, marginTop: 3 }}>{threads.length} threads</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {threads.map((t) => (
            <button key={t.id} onClick={() => setActiveId(t.id)} style={{
              display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
              padding: '11px 16px', background: activeId === t.id ? 'rgba(255,230,0,0.06)' : 'transparent',
              border: 'none', borderBottom: `1px solid ${c.border}`,
              borderLeft: activeId === t.id ? `2px solid ${c.signalGold}` : '2px solid transparent',
              color: c.textIce, cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.contact}</span>
                {t.unread > 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: c.signalGold, color: '#0b1530' }}>{t.unread}</span>}
              </div>
              <span style={{ fontSize: 11, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessage}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {active && (
          <header style={{ padding: '16px 24px', borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.textIce }}>{active.contact}</div>
              <div style={{ fontSize: 10.5, color: c.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>via {active.number}</div>
            </div>
            <button title="Assignment is managed from the AVA portal permissions workflow." style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${c.border}`, color: c.mutedSilver, fontSize: 11, cursor: 'default' }}>Assigned to me</button>
          </header>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!active && (
            <div style={{ margin: 'auto', maxWidth: 360 }}>
              <div style={{
                position: 'relative', padding: '40px 24px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                borderRadius: 18,
                background: `radial-gradient(circle at 50% 0%, ${c.lemtelBlue}1f, transparent 70%), ${c.bgCard}`,
                border: `1px solid ${c.lemtelBlue}44`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 32px -20px ${c.lemtelBlue}88`,
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center',
                  background: `linear-gradient(135deg, ${c.lemtelBlue}33, ${c.signalGold}1c)`,
                  border: `1px solid ${c.lemtelBlue}66`, color: c.lemtelBlue, fontSize: 26,
                  boxShadow: `0 14px 34px -16px ${c.lemtelBlue}88`,
                }}>✉</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.textIce }}>Pick a conversation</div>
                <div style={{ fontSize: 12, color: c.mutedSilver, lineHeight: 1.5 }}>Select a thread on the left to view messages, or use AVA templates to start a new one.</div>
              </div>
            </div>
          )}
          {messagesLoading && <SkeletonRows rows={5} avatar label="Loading messages" />}
          {messagesError && <div style={{ margin: 'auto', color: c.danger, fontSize: 12 }}>{messagesError}</div>}
          {!messagesLoading && !messagesError && active && msgs.length === 0 && <div style={{ margin: 'auto', color: c.mutedSilver, fontSize: 12 }}>No live messages in this conversation yet.</div>}
          {!messagesLoading && msgs.map((m) => (
            <div key={m.id} style={{
              alignSelf: m.from === 'me' ? 'flex-end' : 'flex-start',
              maxWidth: '72%',
              padding: '10px 13px', borderRadius: 14,
              background: m.from === 'me' ? `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})` : c.bgCard,
              border: m.from === 'me' ? 'none' : `1px solid ${c.border}`,
              color: c.textIce, fontSize: 13, lineHeight: 1.5,
              borderBottomRightRadius: m.from === 'me' ? 4 : 14,
              borderBottomLeftRadius: m.from === 'me' ? 14 : 4,
            }}>
              {m.body}
              <div style={{ fontSize: 9, color: m.from === 'me' ? 'rgba(255,255,255,0.6)' : c.mutedSilver, marginTop: 4, textAlign: 'right' }}>{m.at}</div>
            </div>
          ))}
        </div>

        {active && (
          <div style={{ padding: 16, borderTop: `1px solid ${c.border}`, background: c.deepPanel }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setTplOpen((v) => !v)} style={aiBtn(c.avaCyan)}>📋 Templates{defaultTplId ? ' ★' : ''}</button>
                {tplOpen && (
                  <div style={{
                    position: 'absolute', bottom: '110%', left: 0, zIndex: 50,
                    width: 340, padding: 10, borderRadius: 12,
                    background: c.midnight, border: `1px solid ${c.border}`,
                    boxShadow: '0 18px 40px -10px rgba(0,0,0,0.7)',
                  }}>
                    <input
                      autoFocus
                      value={tplQuery}
                      onChange={(e) => setTplQuery(e.target.value)}
                      placeholder="Search templates…"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '7px 9px', borderRadius: 7, marginBottom: 8,
                        background: c.bgCard, border: `1px solid ${c.border}`,
                        color: c.textIce, fontSize: 12, outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                      {(['All', ...CATEGORIES] as const).map((cat) => {
                        const on = tplCategory === cat;
                        return (
                          <button key={cat} onClick={() => setTplCategory(cat)} style={{
                            padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                            background: on ? c.avaCyan + '22' : 'transparent',
                            border: `1px solid ${on ? c.avaCyan + '80' : c.border}`,
                            color: on ? c.avaCyan : c.mutedSilver, cursor: 'pointer',
                          }}>{cat}</button>
                        );
                      })}
                    </div>
                    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                      {visibleTemplates.length === 0 && (
                        <div style={{ padding: 12, fontSize: 11, color: c.mutedSilver, textAlign: 'center' }}>No matches</div>
                      )}
                      {visibleTemplates.map((tpl) => {
                        const isDefault = defaultTplId === tpl.id;
                        return (
                          <div key={tpl.id} style={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
                            <button
                              onClick={() => toggleDefault(tpl.id)}
                              title={isDefault ? 'Unset default for this contact' : 'Set as default for this contact'}
                              style={{
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: isDefault ? c.signalGold : c.mutedSilver,
                                fontSize: 13, padding: '0 4px',
                              }}
                            >{isDefault ? '★' : '☆'}</button>
                            <button onClick={() => applyTemplate(tpl)} style={{
                              flex: 1, textAlign: 'left', padding: '7px 9px', borderRadius: 7,
                              background: 'transparent', border: 'none', color: c.textIce,
                              fontSize: 12, cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                <span style={{ fontWeight: 700 }}>{tpl.label}</span>
                                <span style={{ fontSize: 9, color: c.mutedSilver, letterSpacing: 1 }}>{tpl.category.toUpperCase()}</span>
                              </div>
                              <div style={{ fontSize: 10.5, color: c.mutedSilver, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.body}</div>
                            </button>
                            <button onClick={() => deleteTemplate(tpl.id)} title="Delete" style={{ background: 'transparent', border: 'none', color: c.mutedSilver, cursor: 'pointer', padding: '0 6px' }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={saveCurrentAsTemplate} disabled={!draft.trim()} style={{
                      width: '100%', marginTop: 8, padding: '7px 9px', borderRadius: 7,
                      background: 'transparent', border: `1px dashed ${c.border}`, color: c.signalGold,
                      fontSize: 11, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed',
                    }}>+ Save current draft as template</button>
                  </div>
                )}
              </div>
              <button onClick={() => aiAction('rewrite')} disabled={aiBusy} style={aiBtn(c.avaViolet)}>✨ Rewrite with AVA</button>
              <button onClick={() => aiAction('professional')} disabled={aiBusy} style={aiBtn(c.avaCyan)}>Make professional</button>
              <button onClick={() => aiAction('shorten')} disabled={aiBusy} style={aiBtn(c.signalGold)}>Shorten</button>
              <button onClick={() => aiAction('translate')} disabled={aiBusy} style={aiBtn(c.mutedSilver)}>Translate FR</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message…"
                rows={2}
                style={{
                  flex: 1, padding: 10, borderRadius: 10,
                  background: c.bgCard, border: `1px solid ${c.border}`,
                  color: c.textIce, fontSize: 13, resize: 'none', outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button onClick={send} disabled={!draft.trim()} style={{
                padding: '0 18px', borderRadius: 10,
                background: draft.trim() ? `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})` : 'rgba(255,255,255,0.05)',
                border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: draft.trim() ? 'pointer' : 'not-allowed',
              }}>Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const aiBtn = (col: string): React.CSSProperties => ({
  padding: '5px 10px', borderRadius: 999,
  background: 'rgba(255,255,255,0.03)',
  border: `1px solid ${col}55`,
  color: col, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
});
