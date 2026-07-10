import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Send, Plus, Menu, Loader2, Sparkles, Mic, Square, Volume2, VolumeX, CheckCircle2, MessageSquare, Radio } from "lucide-react";
import AvaVoiceAgent from "@/components/planipret/mobile/AvaVoiceAgent";
import VoiceSettingsSheet from "@/components/planipret/mobile/VoiceSettingsSheet";
import avaLogo from "@/assets/ava-statistics-logo.png.asset.json";

type AvaSuggestion = { id: string; label: string; kind: string; payload?: Record<string, any> };
type Msg = { id: string; role: "user" | "assistant"; message: string; created_at: string; suggestions?: AvaSuggestion[] };
type Session = { id: string; title: string; last_message_at: string };

const MUTATING_ACTIONS = new Set(["send_email", "create_calendar_event", "send_teams_message", "reply_teams_message"]);

export default function MAvaChat() {
  const [userId, setUserId] = useState<string | null>(null);
  const [voiceAgentAllowed, setVoiceAgentAllowed] = useState(false);
  const [mode, setMode] = useState<"chat" | "voice">(() => (localStorage.getItem("ava_mode") as any) || "chat");
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakReplies, setSpeakReplies] = useState<boolean>(() => localStorage.getItem("ava_tts_on") === "1");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [runningSuggestion, setRunningSuggestion] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressSessionLoadRef = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const switchMode = (m: "chat" | "voice") => { setMode(m); localStorage.setItem("ava_mode", m); };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: prof } = await supabase
        .from("planipret_profiles")
        .select("voice_agent_enabled")
        .eq("user_id", data.user.id)
        .maybeSingle();
      setVoiceAgentAllowed(!!(prof as any)?.voice_agent_enabled);
      const { data: s } = await supabase
        .from("planipret_ava_chat_sessions")
        .select("id,title,last_message_at")
        .order("last_message_at", { ascending: false })
        .limit(50);
      setSessions((s ?? []) as Session[]);
      if (s?.[0]) setSessionId(s[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    if (suppressSessionLoadRef.current === sessionId) {
      suppressSessionLoadRef.current = null;
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("planipret_ava_conversations")
        .select("id,role,message,created_at,tool_calls")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      setMessages(((data ?? []) as any[]).map((r) => ({ ...r, suggestions: Array.isArray(r.tool_calls) ? r.tool_calls : [] })) as Msg[]);
    })();
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!recording) inputRef.current?.focus();
  }, [busy, recording, sessionId]);

  const startNew = () => { setSessionId(null); setMessages([]); };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true); setInput("");
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", message: text, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.message }));
      const { data, error } = await supabase.functions.invoke("pp-ava-chat", {
        body: { mode: "chat", user_message: text, session_id: sessionId, history },
      });
      if (error) throw error;
      const d = data as any;
      const newSid = d.session_id ?? sessionId;
      if (newSid && newSid !== sessionId) {
        suppressSessionLoadRef.current = newSid;
        setSessionId(newSid);
        const { data: srow } = await supabase.from("planipret_ava_chat_sessions").select("id,title,last_message_at").eq("id", newSid).maybeSingle();
        if (srow) setSessions((s) => [srow as Session, ...s.filter((x) => x.id !== newSid)]);
      }
      const replyText = String(d.reply ?? "…");
      const replyId = `a-${Date.now()}`;
      setMessages((m) => [...m, { id: replyId, role: "assistant", message: replyText, suggestions: Array.isArray(d.suggestions) ? d.suggestions : [], created_at: new Date().toISOString() }]);
      if (speakReplies) speak(replyId, replyText);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur AVA");
    } finally { setBusy(false); }
  };

  const runSuggestion = async (suggestion: AvaSuggestion) => {
    const action = String(suggestion.payload?.action ?? "");
    const needsConfirm = suggestion.kind === "call" || suggestion.kind === "sms" || MUTATING_ACTIONS.has(action);
    if (needsConfirm && !confirm(`Confirmer: ${suggestion.label}`)) return;
    setRunningSuggestion(suggestion.id);
    try {
      const { data, error } = await supabase.functions.invoke("pp-ava-chat", {
        body: { mode: "chat", confirm_action: suggestion, approved: true, session_id: sessionId },
      });
      if (error) throw error;
      const replyText = String((data as any)?.reply ?? "Action terminée.");
      setMessages((m) => [...m, { id: `act-${Date.now()}`, role: "assistant", message: replyText, created_at: new Date().toISOString() }]);
      toast.success("Action AVA traitée");
    } catch (e: any) {
      toast.error(e?.message ?? "Action AVA impossible");
    } finally {
      setRunningSuggestion(null);
    }
  };

  const speak = async (id: string, text: string) => {
    try {
      audioRef.current?.pause();
      setSpeakingId(id);
      const { data, error } = await supabase.functions.invoke("pp-ava-tts", { body: { text, language: "fr" } });
      if (error) throw error;
      const d = data as any;
      if (!d?.audioContent) throw new Error("no_audio");
      const audio = new Audio(`data:audio/mpeg;base64,${d.audioContent}`);
      audioRef.current = audio;
      audio.onended = () => setSpeakingId(null);
      audio.onerror = () => setSpeakingId(null);
      await audio.play();
    } catch (e: any) {
      setSpeakingId(null);
      toast.error("Lecture vocale indisponible");
    }
  };

  const toggleTts = () => {
    const next = !speakReplies;
    setSpeakReplies(next);
    localStorage.setItem("ava_tts_on", next ? "1" : "0");
    if (!next) { audioRef.current?.pause(); setSpeakingId(null); }
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        setTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          let bin = ""; const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
          const b64 = btoa(bin);
          const { data, error } = await supabase.functions.invoke("pp-ava-stt", { body: { audio: b64, mime } });
          if (error) throw error;
          const text = String((data as any)?.text ?? "").trim();
          if (text) setInput((v) => (v ? `${v} ${text}` : text));
          else toast.info("Rien détecté");
        } catch (e: any) {
          toast.error("Transcription indisponible");
        } finally { setTranscribing(false); }
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Micro non autorisé");
    }
  };

  const stopRec = () => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
  };

  const currentTitle = useMemo(() => sessions.find((s) => s.id === sessionId)?.title ?? "AVA", [sessions, sessionId]);

  if (mode === "voice" && voiceAgentAllowed && userId) {
    return (
      <div className="relative min-h-full">
        <AvaVoiceAgent userId={userId} onClose={() => switchMode("chat")} />
        <button
          onClick={() => setVoiceSettingsOpen(true)}
          className="absolute top-4 right-16 z-[70] w-9 h-9 rounded-full bg-white/5 text-white/80 flex items-center justify-center"
          title="Voix"
        ><Radio className="w-4 h-4" /></button>
        {voiceSettingsOpen && (
          <VoiceSettingsSheet userId={userId} onClose={() => setVoiceSettingsOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-10 flex items-center gap-2 p-3 backdrop-blur-md" style={{ background: "rgba(3,7,18,0.55)", borderBottom: "1px solid var(--pp-bg-border)" }}>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon"><Menu className="w-5 h-5" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80">
            <SheetHeader><SheetTitle>Conversations AVA</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-2">
              <Button size="sm" variant="secondary" className="w-full" onClick={startNew}>
                <Plus className="w-4 h-4 mr-1" /> Nouvelle conversation
              </Button>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSessionId(s.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm truncate ${s.id === sessionId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                >{s.title || "Sans titre"}</button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
        <Sparkles className="w-5 h-5" style={{ color: "var(--pp-brand-accent)" }} />
        <div className="font-medium truncate flex-1" style={{ color: "var(--pp-text-primary)" }}>{currentTitle}</div>
        {voiceAgentAllowed && (
          <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid var(--pp-bg-border-2)" }}>
            <button
              onClick={() => switchMode("chat")}
              className="px-2 py-1 text-xs flex items-center gap-1"
              style={{ background: mode === "chat" ? "var(--pp-brand-accent)" : "transparent", color: mode === "chat" ? "#03131A" : "var(--pp-text-secondary)" }}
              title="Mode Chat"
            ><MessageSquare className="w-3 h-3" /> Chat</button>
            <button
              onClick={() => switchMode("voice")}
              className="px-2 py-1 text-xs flex items-center gap-1"
              style={{ background: mode === "voice" ? "var(--pp-brand-accent)" : "transparent", color: mode === "voice" ? "#03131A" : "var(--pp-text-secondary)" }}
              title="Mode Vocal"
            ><Radio className="w-3 h-3" /> Vocal</button>
          </div>
        )}
        <Button size="icon" variant="ghost" onClick={toggleTts} title={speakReplies ? "Voix activée" : "Voix désactivée"}>
          {speakReplies ? <Volume2 className="w-5 h-5" style={{ color: "var(--pp-brand-accent)" }} /> : <VolumeX className="w-5 h-5" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={startNew}><Plus className="w-5 h-5" /></Button>
      </div>


      <div className="flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-4 pb-6 space-y-4 max-w-3xl w-full mx-auto">
          {messages.length === 0 && (
            <div className="text-center text-sm py-10" style={{ color: "var(--pp-text-muted)" }}>
              Pose ta question à AVA. Elle a accès à tes leads, appels et courriels.
            </div>
          )}
          {messages.map((m) => {
            const cleaned = m.role === "assistant" ? cleanReply(m.message) : m.message;
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" ? (
                  <div className="max-w-[92%] space-y-2">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 overflow-hidden" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
                        <img src={avaLogo.url} alt="AVA" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0 rounded-2xl rounded-tl-md px-3.5 py-3" style={{ background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)", boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: "var(--pp-text-primary)" }}>
                          {cleaned}
                        </div>
                        <button
                          onClick={() => (speakingId === m.id ? (audioRef.current?.pause(), setSpeakingId(null)) : speak(m.id, cleaned))}
                          className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold opacity-75 hover:opacity-100"
                          style={{ color: "var(--pp-text-muted)" }}
                          title="Écouter"
                        >
                          {speakingId === m.id ? <Square className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />} Écouter
                        </button>
                      </div>
                    </div>
                    {m.suggestions && m.suggestions.length > 0 && (
                      <div className="ml-9 flex flex-wrap gap-1.5">
                        {m.suggestions.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => runSuggestion(s)}
                            disabled={!!runningSuggestion}
                            className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 disabled:opacity-50 transition"
                            style={{ background: "rgba(34,211,238,0.10)", border: "1px solid rgba(34,211,238,0.30)", color: "var(--pp-brand-accent)" }}
                          >
                            {runningSuggestion === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="max-w-[85%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] whitespace-pre-wrap break-words shadow-sm"
                    style={{ background: "linear-gradient(135deg, var(--pp-brand-accent), var(--pp-success))", color: "var(--pp-bg-deep)", fontWeight: 650 }}
                  >
                    {m.message}
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <div className="flex justify-start items-center gap-2 text-sm" style={{ color: "var(--pp-text-muted)" }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: "var(--pp-bg-elevated)", border: "1px solid var(--pp-bg-border-2)" }}>
                <img src={avaLogo.url} alt="AVA" className="w-full h-full object-contain" />
              </div>
              <Loader2 className="w-3 h-3 animate-spin" /> AVA réfléchit…
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 p-3 flex items-end gap-2 backdrop-blur-md" style={{ background: "rgba(3,7,18,0.82)", borderTop: "1px solid var(--pp-bg-border)" }}>
        <Button
          onClick={recording ? stopRec : startRec}
          disabled={busy || transcribing || !userId}
          size="icon"
          variant={recording ? "destructive" : "outline"}
          title={recording ? "Arrêter" : "Dicter"}
          aria-label={recording ? "Arrêter la dictée" : "Dicter à AVA"}
        >
          {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <textarea
          ref={inputRef}
          placeholder={recording ? "Enregistrement…" : "Message à AVA…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={busy || !userId || recording}
          rows={1}
          className="flex-1 min-h-[44px] max-h-28 resize-none rounded-2xl px-3.5 py-3 text-[14px] outline-none disabled:opacity-60"
          style={{ color: "var(--pp-text-primary)", caretColor: "var(--pp-brand-accent)", background: "var(--pp-bg-surface)", border: "1px solid var(--pp-bg-border-2)" }}
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="icon" aria-label="Envoyer à AVA">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// Strip stray JSON arrays/objects the model sometimes appends after its reply.
function cleanReply(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  // Remove fenced ```json ... ``` blocks
  s = s.replace(/```(?:json)?\s*[\[{][\s\S]*?[\]}]\s*```/g, "").trim();
  // Remove a trailing raw JSON array/object dump
  const m = s.match(/^([\s\S]*?)\s*(\[[\s\S]*\]|\{[\s\S]*\})\s*$/);
  if (m && m[1].trim().length > 0) s = m[1].trim();
  return s;
}
