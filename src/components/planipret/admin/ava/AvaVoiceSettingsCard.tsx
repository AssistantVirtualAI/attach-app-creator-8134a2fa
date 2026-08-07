// Admin-side AVA voice studio. Reads/writes the SAME broker profile row as the
// mobile VoiceSettingsSheet through pp-ava-voice-settings, and drives the
// ElevenLabs API directly (voice library, models incl. v3, ConvAI agent config).
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Check, Volume2, Search, Plus, RefreshCw, AlertTriangle, Bot } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMplanipretLang } from "@/hooks/useMplanipretLang";

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  labels?: Record<string, string | undefined>;
  category?: string | null;
  description?: string | null;
  public_owner_id?: string | null;
  shared?: boolean;
}
interface Model { model_id: string; name: string; languages?: string[]; can_use_style?: boolean; can_use_speaker_boost?: boolean }
interface Broker { id: string; full_name: string | null; email?: string | null; ava_voice_name?: string | null; elevenlabs_agent_id?: string | null }
interface AgentCfg {
  prompt: string; llm: string; temperature: number; first_message: string; language: string;
  tts_voice_id: string | null; tts_model_id: string | null;
  stability: number | null; similarity_boost: number | null; speed: number | null;
}

const LANGS = [
  ["fr", "Français"], ["en", "English"], ["es", "Español"], ["de", "Deutsch"], ["it", "Italiano"],
  ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"], ["ar", "العربية"], ["hi", "हिन्दी"],
  ["ja", "日本語"], ["zh", "中文"], ["ko", "한국어"], ["ru", "Русский"],
] as const;

const LLMS = ["gemini-2.0-flash", "gemini-2.5-flash", "gpt-4o-mini", "gpt-4o", "claude-3-5-sonnet"];

function Slider({ label, value, set, min, max, step, disabled }: {
  label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; disabled?: boolean;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{label}</span><span>{Number(value).toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => set(Number(e.target.value))} className="w-full accent-violet-600 disabled:opacity-40" />
    </div>
  );
}

export default function AvaVoiceSettingsCard() {
  const { lang } = useMplanipretLang();
  const L = (fr: string, en: string) => (lang === "en" ? en : fr);

  const [sub, setSub] = useState<"voices" | "settings" | "agent">("voices");
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [brokerId, setBrokerId] = useState<string>("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("eleven_multilingual_v2");
  const [stability, setStability] = useState(0.6);
  const [similarity, setSimilarity] = useState(0.8);
  const [style, setStyle] = useState(0.3);
  const [speed, setSpeed] = useState(1);
  const [boost, setBoost] = useState(true);
  const [voiceLang, setVoiceLang] = useState<string>("fr");
  const [previewText, setPreviewText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elConfigured, setElConfigured] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Library search
  const [q, setQ] = useState("");
  const [libLang, setLibLang] = useState("fr");
  const [libGender, setLibGender] = useState("");
  const [lib, setLib] = useState<Voice[] | null>(null);
  const [libLoading, setLibLoading] = useState(false);

  // Agent
  const [agent, setAgent] = useState<AgentCfg | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("pp-ava-voice-settings", { body });
    if (error) throw new Error(error.message || "invoke_failed");
    if (!(data as any)?.success) throw new Error((data as any)?.error || (data as any)?.details || "request_failed");
    return data as any;
  }, []);

  // Brokers via the edge function (service role) — avoids RLS blank states.
  useEffect(() => {
    (async () => {
      try {
        const d = await call({ action: "brokers" });
        const list = (d.brokers ?? []) as Broker[];
        setBrokers(list);
        setBrokerId((prev) => prev || list[0]?.id || "");
        if (!list.length) { setLoading(false); setError(L("Aucun courtier trouvé", "No broker found")); }
      } catch (e) {
        // Non-admin: still load own settings.
        setBrokers([]);
        setBrokerId("");
        load("");
        void e;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await call({ action: "get", ...(id ? { broker_profile_id: id } : {}) });
      setVoices(d.voices ?? []);
      setModels(d.models ?? []);
      setElConfigured(!!d.elevenlabs_configured);
      const s = d.settings ?? {};
      setVoiceId(s.voice_id ?? d.voices?.[0]?.voice_id ?? "");
      setModelId(s.model_id ?? "eleven_multilingual_v2");
      setStability(Number(s.stability ?? 0.6));
      setSimilarity(Number(s.similarity_boost ?? 0.8));
      setStyle(Number(s.style ?? 0.3));
      setSpeed(Number(s.speed ?? 1));
      setBoost(s.speaker_boost !== false);
      setVoiceLang(s.language ?? "fr");
      setAgentId(s.elevenlabs_agent_id ?? null);
      setAgent(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call]);

  useEffect(() => { if (brokerId) load(brokerId); }, [brokerId, load]);
  useEffect(() => () => { try { audioRef.current?.pause(); } catch { /* */ } }, []);

  const preview = async (v: Voice) => {
    if (previewing === v.voice_id) {
      try { audioRef.current?.pause(); } catch { /* */ }
      setPreviewing(null);
      return;
    }
    setPreviewing(v.voice_id);
    try {
      let src = "";
      try {
        const d = await call({
          action: "preview", voice_id: v.voice_id, language: voiceLang, model_id: modelId,
          text: previewText || undefined,
          stability, similarity_boost: similarity, style, speed, speaker_boost: boost,
        });
        if (d.audio_base64) src = `data:audio/mpeg;base64,${d.audio_base64}`;
      } catch { /* fall back to the library preview clip */ }
      if (!src) src = v.preview_url ?? "";
      if (!src) throw new Error("no_audio");
      try { audioRef.current?.pause(); } catch { /* */ }
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.onended = () => setPreviewing(null);
      await audio.play();
    } catch {
      setPreviewing(null);
      toast.error(L("Aperçu audio indisponible", "Audio preview unavailable"));
    }
  };

  const save = async () => {
    if (!voiceId) return;
    setSaving(true);
    const chosen = voices.find((v) => v.voice_id === voiceId);
    try {
      await call({
        action: "save", ...(brokerId ? { broker_profile_id: brokerId } : {}),
        voice_id: voiceId, voice_name: chosen?.name ?? null,
        model_id: modelId, speaker_boost: boost,
        stability, similarity_boost: similarity, style, speed,
        language: voiceLang,
      });
      toast.success(L("Voix AVA synchronisée avec le mobile", "AVA voice synced with mobile"));
    } catch (e) {
      toast.error(`${L("Échec de l'enregistrement", "Could not save")}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const searchLibrary = async () => {
    setLibLoading(true);
    try {
      const d = await call({
        action: "search_library", search: q || undefined, language: libLang || undefined,
        gender: libGender || undefined, page_size: 40,
      });
      setLib(d.voices ?? []);
    } catch (e) {
      toast.error(`${L("Recherche impossible", "Search failed")}: ${(e as Error).message}`);
    } finally {
      setLibLoading(false);
    }
  };

  const addLibraryVoice = async (v: Voice) => {
    try {
      const d = await call({
        action: "add_library_voice", public_owner_id: v.public_owner_id, voice_id: v.voice_id, name: v.name,
      });
      toast.success(L("Voix ajoutée à l'espace de travail", "Voice added to workspace"));
      await load(brokerId || undefined);
      setVoiceId(d.voice_id ?? v.voice_id);
      setSub("voices");
      setLib(null);
    } catch (e) {
      toast.error(`${L("Ajout impossible", "Could not add")}: ${(e as Error).message}`);
    }
  };

  const loadAgent = async () => {
    setAgentLoading(true);
    setAgentError(null);
    try {
      const d = await call({ action: "agent_get", ...(brokerId ? { broker_profile_id: brokerId } : {}) });
      setAgent(d.agent as AgentCfg);
      setAgentId(d.agent_id);
    } catch (e) {
      setAgentError((e as Error).message);
      setAgent(null);
    } finally {
      setAgentLoading(false);
    }
  };

  const saveAgent = async () => {
    if (!agent) return;
    setAgentSaving(true);
    try {
      await call({ action: "agent_update", ...(brokerId ? { broker_profile_id: brokerId } : {}), agent });
      toast.success(L("Agent ElevenLabs mis à jour", "ElevenLabs agent updated"));
    } catch (e) {
      toast.error(`${L("Mise à jour impossible", "Update failed")}: ${(e as Error).message}`);
    } finally {
      setAgentSaving(false);
    }
  };

  const isV3 = modelId.startsWith("eleven_v3");
  const list = sub === "voices" && lib ? lib : voices;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-slate-800">{L("Studio vocal AVA", "AVA voice studio")}</h2>
        </div>
        <button onClick={() => load(brokerId || undefined)} className="text-xs text-slate-500 inline-flex items-center gap-1 hover:text-slate-700">
          <RefreshCw className="w-3.5 h-3.5" /> {L("Actualiser", "Refresh")}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {L("La voix, le modèle et la langue enregistrés ici sont ceux utilisés par l'app mobile du courtier et par le voicebot.",
           "The voice, model and language saved here are used by the broker mobile app and the voicebot.")}
      </p>

      {!elConfigured && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          {L("Clé ElevenLabs absente — voix de secours seulement.", "ElevenLabs key missing — fallback voices only.")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {brokers.length > 0 && (
          <select aria-label={L("Courtier", "Broker")} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{b.full_name || b.email || b.id.slice(0, 8)}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1">
          {([["voices", L("Voix", "Voices")], ["settings", L("Réglages", "Settings")], ["agent", L("Agent", "Agent")]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setSub(k as any); if (k === "agent" && !agent) loadAgent(); }}
              className={`h-9 px-3 rounded-lg text-sm ${sub === k ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}>{l}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="py-10 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : sub === "voices" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchLibrary(); }}
                placeholder={L("Rechercher dans la bibliothèque ElevenLabs…", "Search the ElevenLabs library…")}
                className="w-full h-9 pl-8 pr-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <select value={libLang} onChange={(e) => setLibLang(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">{L("Toutes langues", "All languages")}</option>
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            <select value={libGender} onChange={(e) => setLibGender(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">{L("Tous genres", "Any gender")}</option>
              <option value="female">{L("Féminine", "Female")}</option>
              <option value="male">{L("Masculine", "Male")}</option>
            </select>
            <button onClick={searchLibrary} disabled={libLoading}
              className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
              {libLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {L("Chercher", "Search")}
            </button>
            {lib && (
              <button onClick={() => setLib(null)} className="h-9 px-3 rounded-lg bg-slate-100 text-slate-600 text-sm">
                {L("Mes voix", "My voices")}
              </button>
            )}
          </div>

          <div className="text-[11px] text-slate-400 mb-1">
            {lib ? L(`${lib.length} voix de la bibliothèque`, `${lib.length} library voices`)
                 : L(`${voices.length} voix disponibles`, `${voices.length} available voices`)}
          </div>

          <div className="max-h-[420px] overflow-y-auto mb-3">
            {list.map((v) => (
              <div key={`${v.voice_id}-${v.public_owner_id ?? ""}`}
                onClick={() => { if (!v.shared) setVoiceId(v.voice_id); }}
                className={`flex items-center gap-2 p-2.5 rounded-lg mb-1.5 border ${v.shared ? "border-slate-200" : "cursor-pointer"} ${
                  voiceId === v.voice_id && !v.shared ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:bg-slate-50"
                }`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 truncate">{v.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {[v.labels?.gender, v.labels?.accent, v.labels?.language, v.labels?.use_case, v.category]
                      .filter(Boolean).join(" · ") || v.voice_id.slice(0, 12)}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); preview(v); }}
                  aria-label={L("Écouter un aperçu", "Play preview")}
                  className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                  {previewing === v.voice_id ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                {v.shared ? (
                  <button onClick={(e) => { e.stopPropagation(); addLibraryVoice(v); }}
                    className="h-8 px-2.5 rounded-lg bg-violet-600 text-white text-xs inline-flex items-center gap-1 shrink-0">
                    <Plus className="w-3.5 h-3.5" /> {L("Ajouter", "Add")}
                  </button>
                ) : voiceId === v.voice_id ? <Check className="w-4 h-4 text-violet-600 shrink-0" /> : null}
              </div>
            ))}
            {!list.length && <div className="py-8 text-center text-sm text-slate-400">{L("Aucune voix", "No voices")}</div>}
          </div>

          <button onClick={save} disabled={saving || !voiceId}
            className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {L("Enregistrer la voix", "Save voice")}
          </button>
        </>
      ) : sub === "settings" ? (
        <>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <label className="text-xs text-slate-500">
              {L("Modèle ElevenLabs", "ElevenLabs model")}
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name} — {m.model_id}</option>)}
                {!models.some((m) => m.model_id === "eleven_v3") && <option value="eleven_v3">Eleven v3 (alpha) — eleven_v3</option>}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              {L("Langue de l'agent", "Agent language")}
              <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)}
                className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                {LANGS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
              </select>
            </label>
          </div>

          <Slider label={L("Stabilité", "Stability")} value={stability} set={setStability} min={0} max={1} step={0.05} />
          <Slider label={L("Similarité", "Similarity")} value={similarity} set={setSimilarity} min={0} max={1} step={0.05} />
          <Slider label={`${L("Style", "Style")}${isV3 ? L(" (ignoré en v3)", " (ignored on v3)") : ""}`} value={style} set={setStyle} min={0} max={1} step={0.05} disabled={isV3} />
          <Slider label={`${L("Vitesse", "Speed")}${isV3 ? L(" (ignorée en v3)", " (ignored on v3)") : ""}`} value={speed} set={setSpeed} min={0.7} max={1.2} step={0.05} disabled={isV3} />

          <label className="flex items-center gap-2 text-xs text-slate-600 mb-3">
            <input type="checkbox" checked={boost} onChange={(e) => setBoost(e.target.checked)} className="accent-violet-600" />
            {L("Speaker boost (clarté)", "Speaker boost (clarity)")}
          </label>

          <label className="text-xs text-slate-500 block mb-3">
            {L("Texte d'essai", "Preview text")}
            <textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)} rows={2}
              placeholder={L("Bonjour, je suis AVA…", "Hi, I'm AVA…")}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800" />
          </label>

          <div className="flex gap-2">
            <button onClick={() => { const v = voices.find((x) => x.voice_id === voiceId); if (v) preview(v); }}
              disabled={!voiceId}
              className="h-10 px-4 rounded-lg bg-slate-900 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Play className="w-4 h-4" /> {L("Tester", "Test")}
            </button>
            <button onClick={save} disabled={saving || !voiceId}
              className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {L("Enregistrer les réglages", "Save settings")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
            <Bot className="w-4 h-4 text-violet-600" />
            {agentId ? <span>Agent ID: <code className="text-slate-700">{agentId}</code></span> : L("Aucun agent ElevenLabs lié à ce courtier.", "No ElevenLabs agent linked to this broker.")}
            <button onClick={loadAgent} className="ml-auto inline-flex items-center gap-1 hover:text-slate-700">
              <RefreshCw className="w-3.5 h-3.5" /> {L("Recharger", "Reload")}
            </button>
          </div>

          {agentError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{agentError}</div>}

          {agentLoading ? (
            <div className="py-10 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : agent ? (
            <>
              <label className="text-xs text-slate-500 block mb-3">
                {L("Message d'accueil", "First message")}
                <input value={agent.first_message} onChange={(e) => setAgent({ ...agent, first_message: e.target.value })}
                  className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800" />
              </label>
              <label className="text-xs text-slate-500 block mb-3">
                {L("Prompt système", "System prompt")}
                <textarea value={agent.prompt} onChange={(e) => setAgent({ ...agent, prompt: e.target.value })} rows={8}
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800 font-mono" />
              </label>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                <label className="text-xs text-slate-500">
                  LLM
                  <select value={agent.llm} onChange={(e) => setAgent({ ...agent, llm: e.target.value })}
                    className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                    {[...new Set([agent.llm, ...LLMS])].filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  {L("Langue", "Language")}
                  <select value={agent.language} onChange={(e) => setAgent({ ...agent, language: e.target.value })}
                    className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                    {LANGS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  {L("Modèle TTS", "TTS model")}
                  <select value={agent.tts_model_id ?? ""} onChange={(e) => setAgent({ ...agent, tts_model_id: e.target.value })}
                    className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                    <option value="">—</option>
                    {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
                    {!models.some((m) => m.model_id === "eleven_v3") && <option value="eleven_v3">eleven_v3</option>}
                  </select>
                </label>
              </div>
              <label className="text-xs text-slate-500 block mb-3">
                {L("Voix de l'agent", "Agent voice")}
                <select value={agent.tts_voice_id ?? ""} onChange={(e) => setAgent({ ...agent, tts_voice_id: e.target.value })}
                  className="mt-1 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-800">
                  <option value="">—</option>
                  {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
                </select>
              </label>
              <Slider label={L("Température", "Temperature")} value={agent.temperature ?? 0.5}
                set={(n) => setAgent({ ...agent, temperature: n })} min={0} max={1} step={0.05} />
              <Slider label={L("Stabilité (agent)", "Stability (agent)")} value={agent.stability ?? 0.5}
                set={(n) => setAgent({ ...agent, stability: n })} min={0} max={1} step={0.05} />
              <Slider label={L("Similarité (agent)", "Similarity (agent)")} value={agent.similarity_boost ?? 0.8}
                set={(n) => setAgent({ ...agent, similarity_boost: n })} min={0} max={1} step={0.05} />
              <Slider label={L("Vitesse (agent)", "Speed (agent)")} value={agent.speed ?? 1}
                set={(n) => setAgent({ ...agent, speed: n })} min={0.7} max={1.2} step={0.05} />

              <button onClick={saveAgent} disabled={agentSaving}
                className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
                {agentSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {L("Appliquer sur ElevenLabs", "Apply to ElevenLabs")}
              </button>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-slate-400">
              {L("Sélectionnez un courtier avec un agent ElevenLabs.", "Select a broker that has an ElevenLabs agent.")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
