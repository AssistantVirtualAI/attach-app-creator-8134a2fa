// VoiceSettingsSheet — permet au courtier de choisir sa voix ElevenLabs
// et d'ajuster stability / similarity / style directement depuis l'app mobile.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Play, Square, Loader2, Check } from "lucide-react";

type Voice = { voice_id: string; name: string; preview_url?: string; category?: string; labels?: Record<string, string> };

export default function VoiceSettingsSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>("");
  const [stability, setStability] = useState(0.6);
  const [similarity, setSimilarity] = useState(0.8);
  const [style, setStyle] = useState(0.3);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    (async () => {
      const [voicesRes, profRes] = await Promise.all([
        supabase.functions.invoke("pp-ava-voices", { body: { action: "list" } }),
        supabase.from("planipret_profiles").select("ava_voice_id, ava_voice_stability, ava_voice_similarity, ava_voice_style").eq("user_id", userId).maybeSingle(),
      ]);
      const vs = ((voicesRes.data as any)?.voices ?? []) as Voice[];
      setVoices(vs);
      const p: any = profRes.data ?? {};
      setVoiceId(p.ava_voice_id ?? vs[0]?.voice_id ?? "");
      if (p.ava_voice_stability != null) setStability(Number(p.ava_voice_stability));
      if (p.ava_voice_similarity != null) setSimilarity(Number(p.ava_voice_similarity));
      if (p.ava_voice_style != null) setStyle(Number(p.ava_voice_style));
      setLoading(false);
    })();
    return () => { audioRef.current?.pause(); };
  }, [userId]);

  const preview = async (vId: string) => {
    try {
      audioRef.current?.pause();
      if (previewId === vId) { setPreviewId(null); return; }
      setPreviewId(vId);
      const { data, error } = await supabase.functions.invoke("pp-ava-voices", {
        body: { action: "preview", voice_id: vId, stability, similarity, style },
      });
      if (error) throw error;
      const d = data as any;
      if (!d?.audioContent) throw new Error("no_audio");
      const audio = new Audio(`data:${d.mime};base64,${d.audioContent}`);
      audioRef.current = audio;
      audio.onended = () => setPreviewId(null);
      audio.onerror = () => setPreviewId(null);
      await audio.play();
    } catch (e: any) {
      setPreviewId(null);
      toast.error("Preview indisponible");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("planipret_profiles")
        .update({
          ava_voice_id: voiceId,
          ava_voice_stability: stability,
          ava_voice_similarity: similarity,
          ava_voice_style: style,
        } as any)
        .eq("user_id", userId);
      if (error) throw error;
      toast.success("Voix mise à jour");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full max-h-[85vh] rounded-t-2xl overflow-hidden flex flex-col" style={{ background: "#0A1628", border: "1px solid #0E2A45" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #0E2A45" }}>
          <div className="text-white font-semibold">🎙️ Voix d'AVA</div>
          <button onClick={onClose} className="text-white/70"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="text-xs text-white/60 mb-2">Stabilité: {stability.toFixed(2)}</div>
            <input type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => setStability(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <div className="text-xs text-white/60 mb-2">Similarité: {similarity.toFixed(2)}</div>
            <input type="range" min={0} max={1} step={0.05} value={similarity} onChange={(e) => setSimilarity(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <div className="text-xs text-white/60 mb-2">Style: {style.toFixed(2)}</div>
            <input type="range" min={0} max={1} step={0.05} value={style} onChange={(e) => setStyle(Number(e.target.value))} className="w-full" />
          </div>

          <div className="text-xs text-white/60 mt-4 mb-2">Voix ElevenLabs ({voices.length})</div>
          {loading && <div className="text-white/60 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}
          <div className="space-y-2">
            {voices.map((v) => {
              const selected = v.voice_id === voiceId;
              return (
                <div
                  key={v.voice_id}
                  className="flex items-center gap-2 p-3 rounded-xl cursor-pointer"
                  style={{ background: selected ? "rgba(46,155,220,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${selected ? "#2E9BDC" : "#0E2A45"}` }}
                  onClick={() => setVoiceId(v.voice_id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{v.name}</div>
                    <div className="text-[11px] text-white/50 truncate">
                      {v.category ?? "custom"}{v.labels?.gender ? ` · ${v.labels.gender}` : ""}{v.labels?.accent ? ` · ${v.labels.accent}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); preview(v.voice_id); }}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white/80"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    {previewId === v.voice_id ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  {selected && <Check className="w-4 h-4 text-[#2E9BDC]" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3" style={{ borderTop: "1px solid #0E2A45" }}>
          <button
            onClick={save}
            disabled={saving || !voiceId}
            className="w-full h-11 rounded-xl text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#1A4A8A,#2E9BDC)" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
}
