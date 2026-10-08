import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { colors, font, gradients, radius } from '../lib/theme';
import { mobileApi, CallDetail } from '../lib/mobileApi';
import { Card, Skeleton } from '../components/ui/Primitives';
import RecordingDebugScreen from './RecordingDebugScreen';
import { useMobileCredentials } from '../hooks/useMobileCredentials';
import { useT } from '../lib/i18n';
import { loadPbxRecordingAudioMobile } from '../lib/mobileSupabase';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestKey = `${id}:${mobile.userId || ''}:${mobile.organizationId || ''}:${mobile.extension || ''}:${mobile.accessToken || ''}`;
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const data = dataKey === requestKey ? storedData : null;

  const load = useCallback(() => {
    const key = requestKey;
    mobileApi.callDetail(id)
      .then((detail) => { if (key === requestKeyRef.current) { setData(detail); setDataKey(key); } })
      .catch(() => { if (key === requestKeyRef.current) { setData(null); setDataKey(key); } });
  }, [id, requestKey]);

  const fetchUrl = useCallback(async (): Promise<string | null> => {
    setAudioError(null);
    setLoadingAudio(true);
    const key = requestKey;
    try {
      const detail: any = data || {};
      const url = await loadPbxRecordingAudioMobile(
        { xml_cdr_uuid: detail.pbx_uuid || id, id },
        mobile.accessToken,
        mobile.organizationId,
        mobile.fusionpbxDomainUuid,
      );
      if (key !== requestKeyRef.current) {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        return null;
      }
      return url || null;
    } catch (error: any) {
      if (key !== requestKeyRef.current) return null;
      const raw = String(error?.code || error?.message || '');
      const denied = /forbidden|scope|403/i.test(raw) || error?.http_status === 403;
      setAudioError(denied
        ? (fr ? "Vous n’êtes pas autorisé à écouter cet appel." : 'You are not allowed to listen to this call (extension scope).')
        : (fr ? "Impossible de charger l’enregistrement." : 'Unable to load recording'));
      return null;
    } finally {
      if (key === requestKeyRef.current) setLoadingAudio(false);
    }
  }, [data, fr, id, mobile.accessToken, mobile.fusionpbxDomainUuid, mobile.organizationId, requestKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (dataKey === requestKey && data?.hasRecording && !audioUrl && !loadingAudio && !audioError) {
      void fetchUrl().then((url) => { if (url && requestKey === requestKeyRef.current) setAudioUrl(url); });
    }
  }, [audioError, audioUrl, data?.hasRecording, dataKey, fetchUrl, loadingAudio, requestKey]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, [requestKey]);

  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    setData(null); setDataKey(null); setAudioUrl(null); setAudioError(null); setLoadingAudio(false); setPlaying(false); setCur(0); setDur(0);
  }, [requestKey]);

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
      if (!url || requestKey !== requestKeyRef.current) return;
      setAudioUrl(url);
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audio.ontimeupdate = () => { if (requestKey === requestKeyRef.current) setCur(audio.currentTime); };
    audio.onloadedmetadata = () => { if (requestKey === requestKeyRef.current) setDur(audio.duration || data?.durationSec || 0); };
    audio.onended = () => { if (requestKey === requestKeyRef.current) { setPlaying(false); setCur(0); } };
    audio.onerror = () => { if (requestKey === requestKeyRef.current) { setAudioError(fr ? 'La lecture a échoué.' : 'Playback failed'); setPlaying(false); } };
    audioRef.current = audio;
    try {
      await audio.play();
      if (requestKey === requestKeyRef.current) setPlaying(true);
    } catch {
      if (requestKey === requestKeyRef.current) { setAudioError(fr ? 'La lecture a échoué — réessayez.' : 'Playback failed — tap retry'); setPlaying(false); }
    }
  }, [audioUrl, data?.durationSec, dataKey, fetchUrl, fr, playing, requestKey]);

  const retry = useCallback(async () => {
    setAudioUrl(null);
    setAudioError(null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await togglePlay();
  }, [togglePlay]);

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !dur) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = position * dur;
  };

  const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  if (debugOpen) return <RecordingDebugScreen callId={id} onBack={() => setDebugOpen(false)} />;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 14px 32px' }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', marginBottom: 12, background: `${colors.textIce}0a`, border: `1px solid ${colors.border}`, borderRadius: 999, color: colors.textIce, fontSize: font.sm, cursor: 'pointer' }}>← {fr ? 'Retour' : 'Back'}</button>
      {!data && <Skeleton w="60%" h={22} />}
      {data && (
        <>
          <div style={{ marginBottom: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: colors.signalGold, textTransform: 'uppercase' }}>{data.direction === 'in' ? (fr ? 'Appel entrant' : 'Inbound call') : (fr ? 'Appel sortant' : 'Outbound call')}</div>
          <h1 style={{ fontSize: font.xxl, color: colors.textIce, margin: '2px 0 6px', fontWeight: 800, letterSpacing: -0.3 }}>{data.customer || data.from}</h1>
          <div style={{ fontSize: font.sm, color: colors.mutedSilver, marginBottom: 14 }}>{new Date(data.startedAt).toLocaleString()} · {fmt(data.durationSec)}</div>

          {data.hasRecording ? (
            <Card style={{ marginBottom: 14 }} accent="gold">
              <div onClick={seek} style={{ height: 36, borderRadius: 8, background: `${colors.textIce}0d`, position: 'relative', cursor: dur ? 'pointer' : 'default', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${dur ? (cur / dur) * 100 : 0}%`, background: gradients.call, transition: 'width .15s linear' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10 }}>
                <span style={{ fontSize: 11, color: colors.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmt(cur)}</span>
                <button onClick={() => void togglePlay()} disabled={loadingAudio} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 999, border: 'none', background: gradients.call, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: loadingAudio ? 0.6 : 1 }}>
                  {loadingAudio ? <Loader2 size={14} className="spin" /> : playing ? <Pause size={14} /> : <Play size={14} />}
                  {loadingAudio ? (fr ? 'Chargement' : 'Loading') : playing ? (fr ? 'Pause' : 'Pause') : (fr ? 'Lire' : 'Play')}
                </button>
                <span style={{ fontSize: 11, color: colors.mutedSilver, fontFamily: 'JetBrains Mono, monospace' }}>{fmt(dur || data.durationSec)}</span>
              </div>
              {audioError && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: `${colors.danger}10`, border: `1px solid ${colors.danger}55`, fontSize: 12, color: colors.danger, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>⚠ {audioError}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => void retry()} style={{ background: 'transparent', border: `1px solid ${colors.danger}`, color: colors.danger, borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><RefreshCw size={11} /> {fr ? 'Réessayer' : 'Retry'}</button>
                    <button onClick={() => setDebugOpen(true)} style={{ background: 'transparent', border: `1px solid ${colors.mutedSilver}`, color: colors.mutedSilver, borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Stethoscope size={11} /> {fr ? 'Diagnostic' : 'Debug'}</button>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <Card style={{ marginBottom: 14 }}>
              <div style={{ color: colors.textIce, fontWeight: 700, fontSize: font.base }}>{fr ? 'Aucun enregistrement associé' : 'No recording attached'}</div>
              <div style={{ color: colors.textSub, marginTop: 4, fontSize: font.sm }}>{fr ? 'Cet appel reste présent dans votre historique privé.' : 'This call remains in your private history.'}</div>
            </Card>
          )}

          <Card style={{ marginBottom: 14, display: 'flex', gap: 10, background: `${colors.mint}0d`, border: `1px solid ${colors.mint}36` }}>
            <ShieldCheck size={19} color={colors.mint} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <div>
              <div style={{ color: colors.textIce, fontWeight: 800, fontSize: 13 }}>{fr ? 'Lecture privée et autorisée' : 'Private, authorized playback'}</div>
              <div style={{ color: colors.textSub, marginTop: 3, fontSize: 11, lineHeight: 1.45 }}>{fr ? 'La lecture est vérifiée à chaque demande selon votre organisation et votre extension.' : 'Playback is checked on every request against your organization and extension.'}</div>
            </div>
          </Card>
          <div style={{ height: 60 }} />
        </>
      )}
      <style>{`@keyframes spinrot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spinrot 1s linear infinite; }`}</style>
    </div>
  );
}
