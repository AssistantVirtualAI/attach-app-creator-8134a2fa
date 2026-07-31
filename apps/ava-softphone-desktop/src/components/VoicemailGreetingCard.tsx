// End-user voicemail greeting generator (ElevenLabs TTS).
// Calls existing user-voicemail-greeting edge function.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { theme } from '../lib/theme';

const { colors: c } = theme;

const VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
];

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
  borderRadius: 10, background: c.bgElev,
  border: `1px solid ${c.border}`, color: c.text, fontSize: 13,
  outline: 'none', fontFamily: 'inherit',
};

export default function VoicemailGreetingCard() {
  const [voice, setVoice] = useState(VOICES[0].id);
  const [text, setText] = useState(
    "Hi, you've reached my voicemail. Please leave a message after the tone and I'll get back to you.",
  );
  const [audio, setAudio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('voicemail-greeting-tts', {
        body: { text, voiceId: voice, language: 'en' },
      });
      if (error) throw error;
      if (!data?.audioContent) throw new Error(data?.error || 'No audio');
      setAudio(`data:audio/mpeg;base64,${data.audioContent}`);
    } catch (e: any) { setErr(e?.message || 'TTS failed'); }
    finally { setBusy(false); }
  };

  const saveToMailbox = async () => {
    setSaving(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke('user-voicemail-greeting', {
        body: { action: 'create_greeting', text, voice_id: voice, name: 'AI Greeting' },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error || 'Save failed');
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{
      background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: 12,
      padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.textIce }}>AI Voicemail Greeting</div>
          <div style={{ fontSize: 11, color: c.mutedSilver }}>Generate a natural-sounding greeting with ElevenLabs.</div>
        </div>
        {savedAt && <span style={{ fontSize: 10, color: c.success }}>Saved at {savedAt}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8, marginBottom: 10 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
          style={{ ...input, minHeight: 76, resize: 'vertical' }} />
        <select value={voice} onChange={(e) => setVoice(e.target.value)} style={input}>
          {VOICES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={generate} disabled={busy} style={{
          padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: c.onAccent,
          background: `linear-gradient(135deg, ${c.lemtelBlue}, ${c.avaViolet})`,
          opacity: busy ? 0.6 : 1,
        }}>{busy ? 'Generating…' : '🎙 Preview'}</button>
        {audio && (
          <>
            <audio src={audio} controls style={{ height: 32 }} />
            <button onClick={saveToMailbox} disabled={saving} style={{
              padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
              fontSize: 11, fontWeight: 700, color: c.textIce,
              background: 'transparent', border: `1px solid ${c.border}`,
              opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Saving…' : 'Set as my greeting'}</button>
          </>
        )}
        {err && <span style={{ fontSize: 11, color: c.danger }}>{err}</span>}
      </div>
    </div>
  );
}
