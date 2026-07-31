// Unified PBX edit sheet (portal-parity). Opaque navy panel, sticky header/footer,
// scrollable body, grouped sections, rich field types incl. ElevenLabs TTS preview.
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../../lib/theme';
import { supabase } from '../../../lib/supabaseClient';
import { validateRecord, type RuleMap } from '../../../lib/pbxValidators';
import SkeletonRows from '../../ui/SkeletonRows';

const { colors: c } = theme;

export type FieldType =
  | 'text' | 'number' | 'textarea' | 'select' | 'checkbox'
  | 'password' | 'tts-greeting' | 'queue-agents';

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  options?: (string | { value: string; label: string })[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  cols?: 1 | 2;            // half / full width inside group grid
  // Mark fields that live outside the main FusionPBX row (joined tables, settings, derived)
  // so the parity check doesn't flag them as "missing from PBX response".
  virtual?: boolean;
  // tts-greeting: when generation succeeds, sets this key with returned filename/path text
  ttsFilenameSuggestion?: (form: any) => string;
}

export interface FieldGroup {
  section: string;
  description?: string;
  fields: FieldDef[];
}

interface Props {
  title: string;
  groups: FieldGroup[];
  initial: any;
  /** Snapshot at sheet open — used by parent for optimistic-concurrency conflict detection. */
  baseline?: any;
  /** Shared validation rules (portal parity). */
  rules?: RuleMap;
  saving?: boolean;
  width?: number;
  onCancel: () => void;
  onSave: (record: any) => void;
}

const TOP_VOICES: { id: string; name: string }[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
];

const inputBase: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 11px', borderRadius: 10,
  background: c.bgElev,
  border: `1px solid ${c.borderStrong}`,
  color: c.text, fontSize: 13, outline: 'none',
  fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1,
  color: c.textSub, textTransform: 'uppercase', marginBottom: 6,
};

function FieldRenderer({ f, value, onChange, fullForm }: {
  f: FieldDef; value: any; onChange: (v: any) => void; fullForm: any;
}) {
  if (f.type === 'textarea') {
    return (
      <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder}
        rows={4}
        style={{ ...inputBase, minHeight: 90, resize: 'vertical' }} />
    );
  }
  if (f.type === 'select') {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={inputBase}>
        <option value="">—</option>
        {(f.options || []).map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    );
  }
  if (f.type === 'checkbox') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.textIce, fontSize: 13, padding: '6px 0' }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.hint || 'Enabled'}</span>
      </label>
    );
  }
  if (f.type === 'tts-greeting') {
    return <TtsGreetingField value={value} onChange={onChange} field={f} fullForm={fullForm} />;
  }
  if (f.type === 'queue-agents') {
    return <QueueAgentsField value={value} onChange={onChange} />;
  }
  return (
    <input
      type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
      value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder}
      style={inputBase} autoComplete="off"
    />
  );
}

function TtsGreetingField({ value, onChange, field, fullForm }: {
  value: any; onChange: (v: any) => void; field: FieldDef; fullForm: any;
}) {
  const [voice, setVoice] = useState(TOP_VOICES[0].id);
  const [text, setText] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ filename: string; bytes: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filename = useMemo(() => {
    const suggest = field.ttsFilenameSuggestion?.(fullForm);
    return suggest || `tts-${field.key}-${Date.now()}.mp3`;
  }, [field, fullForm]);

  const generate = async () => {
    if (!text.trim()) { setErr('Enter greeting text'); return; }
    setBusy(true); setErr(null); setUploaded(false);
    try {
      const { data, error } = await supabase.functions.invoke('voicemail-greeting-tts', {
        body: { text, voiceId: voice, language: 'en' },
      });
      if (error) throw error;
      if (!data?.audioContent) throw new Error(data?.error || 'No audio returned');
      setAudioB64(data.audioContent);
      setAudioUrl(`data:audio/mpeg;base64,${data.audioContent}`);
      onChange(filename);
    } catch (e: any) {
      setErr(e?.message || 'TTS failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadToPbx = async () => {
    if (!audioB64) { setErr('Generate audio first'); return; }
    const orgId = (fullForm as any)?.organization_id || (fullForm as any)?.domain_organization_id;
    setUploading(true); setErr(null); setUploadResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
        body: {
          action: 'upload-recording',
          organization_id: orgId,
          filename, audio_base64: audioB64, mime: 'audio/mpeg',
          description: `AVA TTS for ${field.label}`,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      setUploaded(true);
      setUploadResult({ filename: (data as any)?.filename || filename, bytes: (data as any)?.bytes || 0 });
      onChange(filename);
    } catch (e: any) {
      setErr(e?.message || 'Upload to PBX failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      border: `1px solid ${c.borderStrong}`, borderRadius: 10, padding: 12,
      background: c.primarySoft, display: 'grid', gap: 10,
    }}>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 8 }}>
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Filename on PBX (e.g. welcome.mp3)"
          style={inputBase} />
        <select value={voice} onChange={(e) => setVoice(e.target.value)} style={inputBase}>
          {TOP_VOICES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Type the greeting — ElevenLabs will read it back."
        rows={3} style={{ ...inputBase, minHeight: 72, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={generate} disabled={busy || uploading}
          style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            border: 'none', cursor: 'pointer', color: c.onAccent,
            background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            opacity: (busy || uploading) ? 0.6 : 1,
          }}>{busy ? 'Generating…' : '🎙 Generate'}</button>
        <button type="button" onClick={uploadToPbx} disabled={!audioB64 || uploading || busy}
          style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            border: `1px solid ${c.border}`, cursor: 'pointer',
            color: uploaded ? '#0c1733' : c.textIce,
            background: uploaded ? c.signalGold : 'transparent',
            opacity: (!audioB64 || uploading || busy) ? 0.5 : 1,
          }}>{uploading ? 'Uploading…' : uploaded ? '✓ Uploaded' : '⬆ Upload to PBX'}</button>
        {audioUrl && <audio src={audioUrl} controls style={{ height: 32 }} />}
        {audioUrl && (
          <a href={audioUrl} download={filename} style={{ fontSize: 11, color: c.avaCyan, textDecoration: 'underline' }}>
            Download
          </a>
        )}
        {err && <span style={{ color: c.danger, fontSize: 11 }}>{err}</span>}
      </div>

      {uploadResult && (
        <div style={{
          borderRadius: 8, padding: '10px 12px',
          background: 'rgba(11,181,214,0.08)', border: `1px solid ${c.border}`,
          display: 'grid', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: c.textIce }}>
              Uploaded to PBX: <span style={{ color: c.signalGold }}>{uploadResult.filename}</span>
            </span>
            <span style={{ fontSize: 10, color: c.mutedSilver }}>
              ({(uploadResult.bytes / 1024).toFixed(1)} KB)
            </span>
          </div>
          {audioUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: c.mutedSilver, textTransform: 'uppercase', letterSpacing: 0.8 }}>Preview</span>
              <audio src={audioUrl} controls style={{ height: 32, flex: 1, minWidth: 180 }} />
              <a href={audioUrl} download={uploadResult.filename} style={{ fontSize: 11, color: c.avaCyan, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                Download
              </a>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, color: c.mutedSilver, lineHeight: 1.5 }}>
        One-click: Generate → Upload to PBX. Filename is saved on the resource above.
      </div>
    </div>
  );
}

export type QueueAgentAssignment = { extension: string; display_name?: string; role: 'agent' | 'supervisor' };

function QueueAgentsField({ value, onChange }: { value: any; onChange: (v: QueueAgentAssignment[]) => void }) {
  const [pool, setPool] = useState<{ extension: string; display_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const selected: QueueAgentAssignment[] = Array.isArray(value) ? value : [];

  useEffect(() => {
    (async () => {
      try {
        const { data: orgRow } = await supabase.rpc('get_my_organization_id' as any).maybeSingle?.() || { data: null } as any;
        let orgId: string | null = (orgRow as any) || null;
        if (!orgId) {
          const { data: u } = await supabase.auth.getUser();
          const { data: m } = await supabase.from('org_members').select('organization_id').eq('user_id', u.user?.id || '').maybeSingle();
          orgId = (m as any)?.organization_id || null;
        }
        const q = supabase.from('pbx_softphone_users').select('extension, display_name').not('extension', 'is', null).order('extension');
        const { data, error } = orgId ? await q.eq('organization_id', orgId) : await q;
        if (error) throw error;
        setPool((data || []).filter((r: any) => r.extension) as any);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load extensions');
      } finally { setLoading(false); }
    })();
  }, []);

  const toggle = (ext: string, name: string | null, role: 'agent' | 'supervisor') => {
    const exists = selected.find((s) => s.extension === ext);
    let next: QueueAgentAssignment[];
    if (exists && exists.role === role) {
      next = selected.filter((s) => s.extension !== ext);
    } else if (exists) {
      next = selected.map((s) => s.extension === ext ? { ...s, role } : s);
    } else {
      next = [...selected, { extension: ext, display_name: name || undefined, role }];
    }
    onChange(next);
  };

  return (
    <div style={{ border: `1px solid ${c.borderStrong}`, borderRadius: 10, background: c.bgElev, padding: 10, maxHeight: 280, overflow: 'auto' }}>
      {loading && <SkeletonRows rows={3} padding={8} label="Loading extensions" />}
      {err && <div style={{ fontSize: 11, color: c.danger }}>{err}</div>}
      {!loading && pool.length === 0 && !err && (
        <div style={{ fontSize: 11, color: c.textSub }}>No extensions found. Sync from PBX first.</div>
      )}
      <div style={{ display: 'grid', gap: 4 }}>
        {pool.map((p) => {
          const cur = selected.find((s) => s.extension === p.extension);
          return (
            <div key={p.extension} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, background: cur ? 'rgba(255,230,0,0.06)' : 'transparent' }}>
              <span style={{ flex: 1, fontSize: 12, color: c.text }}>
                <span style={{ fontFamily: 'monospace', color: c.text }}>{p.extension}</span>
                {p.display_name && <span style={{ color: c.textSub, marginLeft: 8 }}>{p.display_name}</span>}
              </span>
              <button type="button" onClick={() => toggle(p.extension, p.display_name, 'agent')}
                style={{ padding: '3px 8px', fontSize: 10, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${cur?.role === 'agent' ? c.signalGold : c.border}`,
                  background: cur?.role === 'agent' ? c.signalGold : 'transparent',
                  color: cur?.role === 'agent' ? '#0c1733' : c.text, fontWeight: 700 }}>Agent</button>
              <button type="button" onClick={() => toggle(p.extension, p.display_name, 'supervisor')}
                style={{ padding: '3px 8px', fontSize: 10, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${cur?.role === 'supervisor' ? c.avaCyan : c.border}`,
                  background: cur?.role === 'supervisor' ? c.avaCyan : 'transparent',
                  color: cur?.role === 'supervisor' ? '#0c1733' : c.text, fontWeight: 700 }}>Supervisor</button>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: c.textSub }}>
        {selected.length} assigned · Agent = level 1 / Supervisor = level 2
      </div>
    </div>
  );
}

export default function PbxEditSheet({
  title, groups, initial, baseline, rules, saving, width = 620, onCancel, onSave,
}: Props) {
  const [form, setForm] = useState<any>(initial || {});
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [narrow, setNarrow] = useState(false);

  // Parity check: any schema field absent from the baseline row returned by FusionPBX
  // would mean the portal form / proxy mapping is out of sync. Surface them as a warning.
  const missingFields = useMemo(() => {
    if (!baseline || typeof baseline !== 'object') return [];
    const out: { key: string; label: string; section: string }[] = [];
    for (const g of groups) for (const f of g.fields) {
      if (f.type === 'tts-greeting' || f.type === 'queue-agents') continue;
      if (f.virtual) continue;
      if (!(f.key in baseline)) out.push({ key: f.key, label: f.label, section: g.section });
    }
    return out;
  }, [groups, baseline]);

  const tryClose = React.useCallback(() => {
    if (dirty) {
      const ok = window.confirm('You have unsaved changes. Discard and close?');
      if (!ok) return;
    }
    onCancel();
  }, [dirty, onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tryClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onResize = () => setNarrow(window.innerWidth < 640);
    onResize();
    window.addEventListener('resize', onResize);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [tryClose, dirty]);

  const update = (k: string, v: any) => {
    setForm((f: any) => ({ ...f, [k]: v }));
    setDirty(true);
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = () => {
    const next: Record<string, string> = {};
    // 1) Schema-level required / number checks.
    for (const g of groups) for (const f of g.fields) {
      const v = form[f.key];
      if (f.required && (v === undefined || v === null || String(v).trim() === '')) {
        next[f.key] = 'Required';
      }
      if (f.type === 'number' && v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
        next[f.key] = 'Must be a number';
      }
    }
    // 2) Shared portal-parity rules (regex / range / enum / email).
    if (rules) {
      const ruleErrors = validateRecord(form, rules);
      for (const [k, msg] of Object.entries(ruleErrors)) if (!next[k]) next[k] = msg;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    setDirty(false);
    onSave(form);
    // Broadcast so other open views (portal in another tab/window) refresh.
    try {
      window.dispatchEvent(new CustomEvent('ava:pbx-resource-saved', { detail: { title } }));
      localStorage.setItem('ava:pbx-resync', String(Date.now()));
    } catch {}
  };

  const panelBg = c.bgCard;
  const headerBg = c.bgElev;

  return createPortal(
    <div onClick={tryClose} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(2,6,20,0.55)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', justifyContent: 'flex-end',
      animation: 'fadeIn 140ms ease-out',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: `min(${width}px, 100%)`, height: '100%', maxWidth: '100vw',
        background: panelBg,
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        borderLeft: `1px solid ${c.borderStrong}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-30px 0 80px rgba(0,0,0,0.35)',
        animation: 'slideInRight 180ms cubic-bezier(.2,.8,.2,1)',
        color: c.text,
      }}>
        <header style={{
          position: 'sticky', top: 0, zIndex: 2,
          padding: '16px 22px', borderBottom: `1px solid ${c.border}`,
          background: headerBg,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: c.text, letterSpacing: 0.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}{dirty && <span style={{ color: c.signalGold, marginLeft: 8, fontSize: 11 }}>● unsaved</span>}
          </h2>
          <button onClick={tryClose} aria-label="Close" style={{
            width: 30, height: 30, borderRadius: 8, border: `1px solid ${c.border}`,
            background: 'transparent', color: c.textSub, cursor: 'pointer', fontSize: 14, flexShrink: 0,
          }}>✕</button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '18px 22px', WebkitOverflowScrolling: 'touch', background: panelBg }}>
          {missingFields.length > 0 && (
            <div role="alert" style={{
              marginBottom: 16, padding: '10px 12px', borderRadius: 10,
              background: 'rgba(220,38,38,0.08)', border: `1px solid ${c.danger}`,
              color: c.text, fontSize: 12, lineHeight: 1.5,
            }}>
              <strong style={{ color: c.danger }}>⚠ Schema mismatch — {missingFields.length} field{missingFields.length > 1 ? 's' : ''} missing from PBX response.</strong>
              <div style={{ marginTop: 4, color: c.textSub, fontSize: 11 }}>
                The portal form expects these fields but FusionPBX did not return them. They may have been removed or the proxy mapping is stale:
              </div>
              <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 11, color: c.textSub }}>
                {missingFields.slice(0, 8).map((m) => (
                  <li key={m.key}><code style={{ color: c.text }}>{m.key}</code> — {m.label} <em>({m.section})</em></li>
                ))}
                {missingFields.length > 8 && <li>…and {missingFields.length - 8} more</li>}
              </ul>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.section} style={{ marginBottom: 22 }}>
              <div style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 1.4,
                color: c.signalGold, textTransform: 'uppercase', marginBottom: 10,
                paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
              }}>{g.section}</div>
              {g.description && (
                <div style={{ fontSize: 11, color: c.textSub, marginBottom: 12 }}>{g.description}</div>
              )}
              <div style={{
                display: 'grid',
                gridTemplateColumns: narrow ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                gap: 14,
              }}>
                {g.fields.map((f) => (
                  <div key={f.key} style={{ gridColumn: narrow ? 'span 1' : (f.cols === 1 ? 'span 1' : 'span 2'), minWidth: 0 }}>
                    <div style={labelStyle}>{f.label}{f.required && <span style={{ color: c.danger }}> *</span>}</div>
                    <FieldRenderer f={f} value={form[f.key]} fullForm={form}
                      onChange={(v) => update(f.key, v)} />
                    {errors[f.key] && (
                      <div style={{ fontSize: 10, color: c.danger, marginTop: 4 }}>{errors[f.key]}</div>
                    )}
                    {f.hint && f.type !== 'checkbox' && !errors[f.key] && (
                      <div style={{ fontSize: 10, color: c.textSub, marginTop: 4 }}>{f.hint}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer style={{
          position: 'sticky', bottom: 0, zIndex: 2,
          padding: '14px 22px', borderTop: `1px solid ${c.border}`,
          background: headerBg,
          display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap',
        }}>
          {Object.keys(errors).length > 0 && (
            <div style={{ marginRight: 'auto', color: c.danger, fontSize: 11, alignSelf: 'center' }}>
              Fix {Object.keys(errors).length} field{Object.keys(errors).length > 1 ? 's' : ''} before saving
            </div>
          )}
          <button onClick={tryClose} style={{
            padding: '9px 16px', borderRadius: 10, background: 'transparent',
            border: `1px solid ${c.borderStrong}`, color: c.text,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '9px 20px', borderRadius: 10, border: 'none',
            color: c.onAccent, fontSize: 12, fontWeight: 800, cursor: 'pointer',
            backgroundImage: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
            opacity: saving ? 0.6 : 1,
            boxShadow: '0 8px 24px -10px rgba(0,35,230,0.45)',
          }}>{saving ? 'Saving…' : 'Save & sync to PBX'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
