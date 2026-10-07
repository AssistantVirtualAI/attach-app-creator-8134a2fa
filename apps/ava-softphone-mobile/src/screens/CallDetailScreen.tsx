import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Loader2, Sparkles, RefreshCw, Stethoscope } from 'lucide-react';
import { colors, font, radius, gradients } from '../lib/theme';
import { mobileApi, CallDetail } from '../lib/mobileApi';
import { Card, Chip, AIPanel, Skeleton, GhostButton } from '../components/ui/Primitives';
import RecordingDebugScreen from './RecordingDebugScreen';
import { showMobileToast } from '../lib/mobileToast';
import { useMobileCredentials } from '../hooks/useMobileCredentials';
import { useT } from '../lib/i18n';
import { loadPbxRecordingAudioMobile } from '../lib/mobileSupabase';

type AiStage = 'idle' | 'transcribing' | 'analyzing' | 'done' | 'error';

export default function CallDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const mobile = useMobileCredentials();
  const { lang } = useT();
  const fr = lang === 'fr';
  const [debugOpen, setDebugOpen] = useState(false);
  const [storedData, setData] = useState<CallDetail | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [aiStage, setAiStage] = useState<AiStage>('idle');
  const errorRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestKey = `${id}:${mobile.userId || ''}:${mobile.organizationId || ''}:${mobile.extension || ''}:${mobile.accessToken || ''}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const data = dataKey === requestKey ? storedData : null;

  const load = useCallback(() => { const key = requestKey; mobileApi.callDetail(id).then((d) => { if (key === requestKeyRef.current) { setData(d); setDataKey(key); } }).catch(() => {}); }, [id, requestKey]);
  useEffect(() => { load(); }, [load]);

  // Auto-prefetch signed audio URL the moment we know a recording exists,
  // so the Play button is instant on tap. Silent failure (audioError state
  // surfaces it inline) — never throws into the screen.
  useEffect(() => {
    if (dataKey === requestKey && data?.hasRecording && !audioUrl && !loadingAudio) {
      fetchUrl().then((u) => { if (u) setAudioUrl(u); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.hasRecording, dataKey, requestKey]);

  // Cleanup audio on unmount or call change
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, [requestKey]);
  // Phase 30A — neither a new CDR nor a new account/extension can reuse audio.
  const firstIdRef = useRef(true);
  useEffect(() => {
    if (firstIdRef.current) { firstIdRef.current = false; return; }
    setData(null); setDataKey(null); setAudioUrl(null); setAudioError(null); setLoadingAudio(false); setPlaying(false); setCur(0); setDur(0);
  }, [requestKey]);

  // Phase 29B — single authenticated audio path: the shared helper. Metadata
  // comes only from the loaded CDR (`data`) and the detail `id`; the server
  // enforces the signed-in extension scope.
  const fetchUrl = useCallback(async (): Promise<string | null> => {
    setAudioError(null);
    setLoadingAudio(true);
    const key = requestKey;
    try {
      const d: any = data || {};
      const meta: any = { xml_cdr_uuid: d.pbx_uuid || id, id };
      const url = await loadPbxRecordingAudioMobile(
        meta,
        mobile.accessToken,
        mobile.organizationId,
        mobile.fusionpbxDomainUuid,
      );
      if (key !== requestKeyRef.current) { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); return null; }
      return url || null;
    } catch (e: any) {
      if (key !== requestKeyRef.current) return null;
      const raw = String(e?.code || e?.message || '');
      const denied = /forbidden|scope|403/i.test(raw) || e?.http_status === 403;
      setAudioError(denied
        ? 'You are not allowed to listen to this call (extension scope).'
        : 'Unable to load recording');
      return null;
    } finally {
      if (key === requestKeyRef.current) setLoadingAudio(false);
    }
  }, [id, requestKey, mobile.accessToken, mobile.organizationId, mobile.fusionpbxDomainUuid, data]);


  const togglePlay = useCallback(async () => {
    if (requestKey !== requestKeyRef.current || dataKey !== requestKey) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    let url = audioUrl;
    if (!url) {
      url = await fetchUrl();
      if (!url) return;
      if (requestKey !== requestKeyRef.current) return;
      setAudioUrl(url);
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audio.ontimeupdate = () => { if (requestKey === requestKeyRef.current) setCur(audio.currentTime); };
    audio.onloadedmetadata = () => { if (requestKey === requestKeyRef.current) setDur(audio.duration || data?.durationSec || 0); };
    audio.onended = () => {
      if (requestKey !== requestKeyRef.current) return;
      setPlaying(false);
      setCur(0);
      if (data && !data.transcript?.length) transcribe();
    };
    audio.onerror = () => {
      if (requestKey !== requestKeyRef.current) return;
      setAudioError('Playback failed');
      setPlaying(false);
    };
    audioRef.current = audio;
    try {
      await audio.play();
      if (requestKey === requestKeyRef.current) setPlaying(true);
    } catch {
      if (requestKey === requestKeyRef.current) { setAudioError('Playback failed — tap retry'); setPlaying(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audioUrl, fetchUrl, data, dataKey, requestKey]);

  const retry = useCallback(async () => {
    setAudioUrl(null);
    setAudioError(null);
    await new Promise((r) => setTimeout(r, 1500));
    togglePlay();
  }, [togglePlay]);

  const transcribe = useCallback(async () => {
    if (transcribing || dataKey !== requestKey) return;
    const key = requestKey;
    setTranscribing(true);
    setTranscribeError(null);
    setAiStage('transcribing');
    try {
      const t = await mobileApi.transcribeCall(id);
      if (key !== requestKeyRef.current) return;
      if (t?.stub || t?.error) {
        const reason = t.reason || t.error || '';
        const fetchTxt = (t.fetchErrors || []).join(' ');
        let friendly = '';
        if (reason === 'pbx-auth-failed' || /FUSIONPBX_AUTH_FAILED|login[_ ]failed/i.test(fetchTxt)) {
          friendly = "Identifiants FusionPBX expirés — l'administrateur doit rafraîchir FUSIONPBX_USERNAME / FUSIONPBX_PASSWORD.";
        } else if (reason === 'recording-not-found' || /RECORDING_NOT_FOUND/i.test(fetchTxt)) {
          friendly = "Enregistrement introuvable sur le PBX (le fichier .mp3/.wav n'est plus sur le disque FusionPBX).";
        } else if (reason === 'recording-not-synced' || reason === 'no-recording') {
          friendly = "Enregistrement non disponible — l'appel n'a pas été enregistré, ou la synchro PBX n'est pas encore terminée. Réessayez dans ~30 s.";
        } else if (reason === 'missing-ai-key') {
          friendly = "Clé IA manquante côté serveur. Contactez l'administrateur.";
        } else {
          friendly = `Transcription indisponible: ${reason || 'erreur inconnue'}${fetchTxt ? ` — ${fetchTxt.slice(0, 160)}` : ''}`;
        }
        throw new Error(friendly);
      }

      setAiStage('analyzing');
      await mobileApi.analyzeCall(id);
      if (key !== requestKeyRef.current) return;
      // Poll once for the freshly written transcript/insights
      await new Promise((r) => setTimeout(r, 1500));
      if (key !== requestKeyRef.current) return;
      load();
      setAiStage('done');
      showMobileToast('AI analysis: déjà traité et mis en cache.', 'success');
    } catch (e: any) {
      if (key !== requestKeyRef.current) return;
      const msg = e?.message || 'Transcription failed';
      setTranscribeError(msg);
      setAiStage('error');
      showMobileToast(`Transcription/scoring failed — tap to view error`, 'error', () => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } finally {
      if (key === requestKeyRef.current) setTranscribing(false);
    }
  }, [id, transcribing, load, dataKey, requestKey]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * dur;
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  const hasTranscript = (data?.transcript?.length || 0) > 0;
  const aiDone = hasTranscript && !!data?.summary;

  // --- Transcription badge state (visible at the top of the AI section) ---
  const liveStatus: 'processing' | 'done' | 'failed' | 'missing' =
    transcribing ? 'processing'
    : (data?.transcriptionStatus as any) || (hasTranscript ? 'done' : (transcribeError ? 'failed' : 'missing'));
  const provider = data?.transcriptionProvider || null;
  const badgeLabel = liveStatus === 'processing' ? (fr ? '⏳ Transcription en cours' : '⏳ Transcribing')
    : liveStatus === 'done' ? (fr ? '✅ Transcription terminée' : '✅ Transcription complete')
    : liveStatus === 'failed' ? (fr ? '❌ Transcription échouée' : '❌ Transcription failed')
    : (fr ? '• Transcription non lancée' : '• Not transcribed');
  const badgeTone: 'cyan' | 'success' | 'danger' | 'silver' =
    liveStatus === 'processing' ? 'cyan' : liveStatus === 'done' ? 'success' : liveStatus === 'failed' ? 'danger' : 'silver';
  const badgeColor = badgeTone === 'success' ? '#10b981' : badgeTone === 'danger' ? colors.danger : badgeTone === 'cyan' ? colors.avaCyan : colors.mutedSilver;

  const statusText = transcribing
    ? aiStage === 'analyzing' ? (fr ? 'Analyse IA : en cours — scoring/coaching' : 'AI analysis: in progress — scoring/coaching') : (fr ? 'Analyse IA : transcription en cours' : 'AI analysis: transcribing')
    : aiDone || data?.aiCached ? (fr ? 'Analyse IA : déjà traité — cache réutilisé' : 'AI analysis: cached')
    : transcribeError || data?.aiError ? (fr ? 'Analyse IA : échec' : 'AI analysis: failed')
    : (fr ? 'Analyse IA : non traité' : 'AI analysis: not processed');

  if (debugOpen) return <RecordingDebugScreen callId={id} onBack={() => setDebugOpen(false)} />;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 14px 20px' }}>


      <button onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 12px', marginBottom: 12,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${colors.border}`,
        borderRadius: 999, color: colors.textIce, fontSize: font.sm, cursor: 'pointer',
      }}>← {fr ? 'Retour' : 'Back'}</button>

      {!data && <Skeleton w="60%" h={22} />}
      {data && (
        <>
          <div style={{ marginBottom: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: colors.signalGold, textTransform: 'uppercase' }}>
            {data.direction === 'in' ? (fr ? 'Appel entrant' : 'Inbound call') : (fr ? 'Appel sortant' : 'Outbound call')}
          </div>
          <h1 style={{ fontSize: font.xxl, color: colors.textIce, margin: '2px 0 6px', fontWeight: 800, letterSpacing: -0.3 }}>
            {data.customer || data.from}
          </h1>
          <div style={{ fontSize: font.sm, color: colors.mutedSilver, marginBottom: 14 }}>
            {new Date(data.startedAt).toLocaleString()} · {fmt(data.durationSec)}
          </div>

          {/* Recording player */}
          {data.hasRecording && (
            <Card style={{ marginBottom: 14 }} accent="gold">
              {/* Progress bar / scrubber */}
              <div
                onClick={seek}
                style={{
                  height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)',
                  position: 'relative', cursor: dur ? 'pointer' : 'default',
                  border: `1px solid ${colors.border}`, overflow: 'hidden',
                }}
              >
                <div style={{
                  position: 'absolute', inset: 0,
                  width: `${dur ? (cur / dur) * 100 : 0}%`,
                  background: gradients.call, transition: 'width .15s linear',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10 }}>
                <span style={{ fontSize: 11, color: colors.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmt(cur)}</span>
                <button onClick={togglePlay} disabled={loadingAudio} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 999, border: 'none',
                  background: gradients.call, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  opacity: loadingAudio ? 0.6 : 1,
                }}>
                  {loadingAudio ? <Loader2 size={14} className="spin" /> : playing ? <Pause size={14} /> : <Play size={14} />}
                  {loadingAudio ? (fr ? 'Chargement' : 'Loading') : playing ? (fr ? 'Pause' : 'Pause') : (fr ? 'Lire' : 'Play')}
                </button>
                <span style={{ fontSize: 11, color: colors.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmt(dur || data.durationSec)}</span>
              </div>
              {audioError && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: `1px solid ${colors.danger}55`, fontSize: 12, color: colors.danger, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>⚠ {audioError}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={retry} style={{ background: 'transparent', border: `1px solid ${colors.danger}`, color: colors.danger, borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <RefreshCw size={11} /> {fr ? 'Réessayer' : 'Retry'}
                    </button>
                    <button onClick={() => setDebugOpen(true)} style={{ background: 'transparent', border: `1px solid ${colors.mutedSilver}`, color: colors.mutedSilver, borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Stethoscope size={11} /> {fr ? 'Diagnostic' : 'Debug'}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Transcription status badge (always visible when recording exists) */}
          {data.hasRecording && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              padding: '8px 12px', borderRadius: 999,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${badgeColor}55`,
              fontSize: 12, fontWeight: 700, color: badgeColor,
            }}>
              {liveStatus === 'processing' && <Loader2 size={13} className="spin" />}
              <span>{badgeLabel}</span>
              {provider && liveStatus !== 'missing' && (
                <span style={{ color: colors.mutedSilver, fontWeight: 500, marginLeft: 4 }}>
                  · {fr ? 'Fournisseur' : 'Provider'}: {provider}
                </span>
              )}
              {liveStatus === 'failed' && data.transcriptionError && (
                <span style={{ color: colors.mutedSilver, fontWeight: 500, marginLeft: 4, fontSize: 11 }}>
                  — {String(data.transcriptionError).slice(0, 80)}
                </span>
              )}
            </div>
          )}

          {/* Transcribe CTA when missing */}
          {data.hasRecording && !hasTranscript && (
            <Card style={{ marginBottom: 14 }} accent="violet">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Sparkles size={18} color={colors.avaViolet} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: font.base, fontWeight: 700, color: colors.textIce }}>{fr ? 'Aucune transcription' : 'No transcript yet'}</div>
                  <div style={{ fontSize: font.xs, color: colors.mutedSilver, marginTop: 2 }}>
                    {statusText}
                  </div>
                </div>
                <button onClick={transcribe} disabled={transcribing} style={{
                  padding: '8px 14px', borderRadius: 999, border: 'none',
                  background: `linear-gradient(135deg, ${colors.avaViolet}, ${colors.avaCyan})`,
                  color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  opacity: transcribing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {transcribing ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                  {transcribing ? (fr ? 'Traitement…' : 'Working…') : (fr ? 'Transcrire' : 'Transcribe')}
                </button>
              </div>
              {transcribeError && (
                <div ref={errorRef} id="ai-error" style={{ marginTop: 8, fontSize: 11, color: colors.danger }}>⚠ {transcribeError}</div>
              )}
            </Card>
          )}

          {data.hasRecording && hasTranscript && (
            <Card style={{ marginBottom: 14 }} accent={transcribeError || data.aiError ? 'gold' : 'violet'}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: colors.avaViolet, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 800 }}>{statusText}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Chip tone="success" size="xs">{fr ? 'Transcription en cache' : 'Transcript cached'}</Chip>
                    {provider && <Chip tone={provider.includes('Whisper') ? 'cyan' : 'violet'} size="xs">{provider}</Chip>}
                    {data.summary && <Chip tone="violet" size="xs">{fr ? 'Aperçu en cache' : 'Insight cached'}</Chip>}
                    {data.qualityScore > 0 && <Chip tone="gold" size="xs">{fr ? 'Score' : 'Score'} {data.qualityScore}/100</Chip>}
                    {data.coachingScore != null && <Chip tone="cyan" size="xs">{fr ? 'Coaching' : 'Coaching'} {data.coachingScore}/5</Chip>}
                  </div>
                </div>
                <button onClick={transcribe} disabled={transcribing} style={{
                  padding: '7px 11px', borderRadius: 999, border: `1px solid ${colors.borderAI}`,
                  background: transcribing ? 'rgba(255,255,255,0.06)' : gradients.ai,
                  color: colors.textIce, fontSize: 11, fontWeight: 800, cursor: transcribing ? 'wait' : 'pointer',
                }}>{transcribing ? (fr ? 'En cours…' : 'Running…') : (fr ? 'Relancer' : 'Re-launch')}</button>
              </div>
              {(transcribeError || data.aiError) && (
                <div ref={errorRef} id="ai-error" style={{ marginTop: 10, padding: 8, borderRadius: radius.md, border: `1px solid ${colors.danger}55`, color: colors.danger, fontSize: 11 }}>
                  ⚠ {transcribeError || data.aiError}
                </div>
              )}
            </Card>
          )}

          {/* AI Summary */}
          {data.summary && (
            <AIPanel title={fr ? 'Résumé Lemtel AI' : 'Lemtel AI summary'} accent={colors.avaViolet}>
              <p style={{ fontSize: font.base, lineHeight: 1.55, color: colors.textIce, margin: 0 }}>{data.summary}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {data.qualityScore > 0 && <Chip tone="gold">{fr ? 'Qualité' : 'Quality'} {data.qualityScore}/100</Chip>}
                {data.coachingScore != null && <Chip tone="cyan">Coaching {data.coachingScore}/5</Chip>}
                {data.sentiment && <Chip tone={data.sentiment === 'positive' ? 'success' : data.sentiment === 'negative' ? 'danger' : 'neutral'}>{data.sentiment}</Chip>}
                {data.intent && <Chip tone="cyan">{data.intent}</Chip>}
              </div>
            </AIPanel>
          )}

          {data.coachingNotes && data.coachingNotes.length > 0 && (
            <AIPanel title={fr ? 'Notes de coaching' : 'Coaching notes'} accent={colors.avaCyan}>
              {data.coachingNotes.map((note, i) => (
                <div key={i} style={{ fontSize: font.base, color: colors.textIce, lineHeight: 1.45, padding: '5px 0' }}>✦ {note}</div>
              ))}
            </AIPanel>
          )}

          {/* Action items */}
          {data.actionItems?.length > 0 && (
            <AIPanel title={fr ? 'Actions à faire' : 'Action items'} accent={colors.success}>
              {data.actionItems.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: i === data.actionItems.length - 1 ? 'none' : `1px solid ${colors.border}` }}>
                  <span style={{ color: colors.success }}>→</span>
                  <span style={{ fontSize: font.base, color: colors.textIce, lineHeight: 1.45 }}>{a}</span>
                </div>
              ))}
            </AIPanel>
          )}

          {/* Topics */}
          {data.topics?.length > 0 && (
            <AIPanel title={fr ? 'Sujets' : 'Topics'} accent={colors.avaCyan}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {data.topics.map((t) => <Chip key={t} tone="cyan">{t}</Chip>)}
              </div>
            </AIPanel>
          )}

          {/* Transcript */}
          {hasTranscript && (
            <AIPanel title={fr ? 'Transcription' : 'Transcript'} accent={colors.signalGold}>
              {data.transcript.map((line, i) => (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: line.speaker === 'agent' ? 'flex-end' : 'flex-start',
                  marginBottom: 8,
                }}>
                  <div style={{
                    maxWidth: '85%', padding: '8px 12px', borderRadius: 14,
                    background: line.speaker === 'agent' ? gradients.call : colors.graphite2,
                    color: colors.textIce, fontSize: font.base, lineHeight: 1.5,
                    borderBottomRightRadius: line.speaker === 'agent' ? 4 : 14,
                    borderBottomLeftRadius:  line.speaker === 'agent' ? 14 : 4,
                  }}>{line.text}</div>
                  <div style={{ fontSize: 9.5, color: colors.mutedSilver, marginTop: 3, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 }}>
                    {line.speaker} · {fmt(line.t)}
                  </div>
                </div>
              ))}
            </AIPanel>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <GhostButton tone="gold" style={{ flex: 1 }}>{fr ? 'Étiqueter' : 'Tag'}</GhostButton>
            <GhostButton tone="cyan" style={{ flex: 1 }}>{fr ? 'Partager' : 'Share'}</GhostButton>
            <GhostButton tone="violet" style={{ flex: 1 }} onClick={transcribe}>{fr ? 'Ré-analyser' : 'Re-analyze'}</GhostButton>
          </div>

          <div style={{ height: 60 }} />
        </>
      )}
      <style>{`@keyframes spinrot { from { transform: rotate(0deg);} to { transform: rotate(360deg);} } .spin { animation: spinrot 1s linear infinite; }`}</style>
    </div>
  );
}
