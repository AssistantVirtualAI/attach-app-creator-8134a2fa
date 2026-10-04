import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { colors, font, radius, gradients } from '../lib/theme';
import { mobileApi, RecordingEntry } from '../lib/mobileApi';
import { Card, Chip, EmptyState, Skeleton, AIPanel } from '../components/ui/Primitives';
import type { Creds } from '../lib/creds';
import { downloadRecording, getCachedRecordingUrl, type RecordingScope } from '../lib/recordingCache';
import { showMobileToast } from '../lib/mobileToast';
import { useCallAi } from '../hooks/useCallAi';
import { useT } from '../lib/i18n';

export default function RecordingsScreen({
  creds,
  myExtension,
  rangeDays,
  onRangeDaysChange,
}: {
  creds?: Creds | null;
  myExtension: string | null;
  rangeDays: 7 | 30;
  onRangeDaysChange: (days: 7 | 30) => void;
}) {
  const [items, setItems] = useState<RecordingEntry[] | null>(null);
  const [loadedForScope, setLoadedForScope] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  const [playbackErrors, setPlaybackErrors] = useState<Record<string, { kind: string; code: string; ref: string; message: string; statuses: number[] }>>({});
  const [search, setSearch] = useState('');
  const { lang } = useT();
  const fr = lang === 'fr';
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track which recording is currently loaded in the <audio> element so the
  // onError handler can re-download it without needing closure state.
  const currentPlaybackRef = useRef<RecordingEntry | null>(null);
  const recoveringRef = useRef(false);
  const scope: RecordingScope | null = creds?.userId && creds?.organizationId && creds?.accessToken && myExtension
    ? { userId: creds.userId, organizationId: creds.organizationId, extension: myExtension }
    : null;
  const scopeId = scope ? `${scope.userId}|${scope.organizationId}|${scope.extension}|${creds?.accessToken}` : '';
  const activeScopeRef = useRef(scopeId);
  activeScopeRef.current = scopeId;
  const visibleItems = loadedForScope === scopeId ? items : null;
  const visibleError = loadedForScope === scopeId ? error : null;

  useEffect(() => {
    if (audioRef.current?.getAttribute('src')) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    currentPlaybackRef.current = null;
    recoveringRef.current = false;
    setError(null);
    setPlayingId(null); setLoadingId(null); setDownloadingId(null);
    setExpandedId(null); setCachedIds(new Set()); setPlaybackErrors({});
    setItems(scopeId ? null : []);
    setLoadedForScope(scopeId);
  }, [scopeId]);

  // Load recordings (real-time: refresh on focus + every 30s + after a call ends).
  const reload = React.useCallback(() => {
    let cancelled = false;
    // Phase 27A — own_extension_only: the server imposes the connected extension.
    if (!scope || !scopeId) return () => { cancelled = true; };
    mobileApi.recordings({ rangeDays })
      .then((rows) => {
        if (cancelled || activeScopeRef.current !== scopeId) return;
        setItems(rows.filter((r) => r.extension === scope.extension && r.organization_id === scope.organizationId));
        setLoadedForScope(scopeId);
      })
      .catch((e: any) => {
        if (!cancelled && activeScopeRef.current === scopeId) { setError(e?.message || 'Failed to load recordings'); setItems((prev) => prev ?? []); }
      });
    return () => { cancelled = true; };
  }, [scopeId, rangeDays]);

  useEffect(() => {
    setError(null);
    if (!scopeId) { setItems([]); setLoadedForScope(''); return; }
    setItems(null);
    const cancels: Array<() => void> = [reload()];
    // 30s polling removed — realtime subscriptions + focus + callEnded events handle refresh.
    const onFocus = () => { cancels.push(reload()); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onCallEnded = () => { timers.push(setTimeout(onFocus, 1500), setTimeout(onFocus, 8000)); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('ava:callEnded', onCallEnded as any);

    // Live realtime: channel scoped exactly to the connected extension.
    let ch: any = null;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import('../lib/mobileSupabase');
        if (cancelled) return;
        if (creds?.accessToken) { try { supabase.realtime.setAuth(creds.accessToken); } catch {} }
        const filter = `extension=eq.${myExtension}`;
        ch = supabase.channel(`recordings-ext-${myExtension}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pbx_call_recordings', filter } as any, () => reload())
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pbx_call_recordings', filter } as any, () => reload())
          .subscribe();
        if (cancelled) { await supabase.removeChannel(ch); ch = null; }
      } catch {}
    })();

    return () => {
      cancelled = true;
      cancels.forEach((cancel) => cancel());
      timers.forEach(clearTimeout);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('ava:callEnded', onCallEnded as any);
      (async () => { try { const { supabase } = await import('../lib/mobileSupabase'); ch && supabase.removeChannel(ch); } catch {} })();
    };
  }, [reload, scopeId]);

  // cachedIdsRef mirrors cachedIds state but is updated without triggering
  // re-renders, so background probes and prefetches can update it safely.
  const cachedIdsRef = useRef<Set<string>>(new Set());

  // Guard ref: tracks the items-ids+token key for which a probe+prefetch has
  // already run. Keyed on IDs only (not the array reference) so that the
  // 30-second polling reload() — which creates a new array with the same IDs
  // — does NOT re-trigger the expensive disk probe.
  const prefetchKeyRef = useRef<string | null>(null);

  // Stable key derived from the sorted list of recording IDs.
  // Changes only when the actual set of recordings changes, not on every poll.
  const itemsIdsKey = useMemo(
    () => (visibleItems ? visibleItems.slice(0, 50).map((r) => r.id).join(',') : ''),
    [visibleItems],
  );

  // Probe + prefetch — runs only when the set of recording IDs changes.
  useEffect(() => {
    if (!visibleItems || visibleItems.length === 0 || !itemsIdsKey || !scope) return;
    const accessToken = creds?.accessToken || null;
    const domainUuid = creds?.domainUuid || creds?.fusionpbxDomainUuid || null;
    const orgId = creds?.organizationId || null;

    // Full guard key: IDs + token. If neither changed, skip entirely.
    const key = `${scopeId}-${itemsIdsKey}`;
    if (prefetchKeyRef.current === key) return;
    prefetchKeyRef.current = key;

    let cancelled = false;

    const makeMeta = (r: RecordingEntry) => ({
      recording_path: r.record_path, recording_name: r.record_name,
      xml_cdr_uuid: r.xml_cdr_uuid || r.id, domain_uuid: r.domain_uuid,
      domain_name: r.domain_name, organization_id: r.organization_id,
      start_at: r.startedAt,
    });

    (async () => {
      // Step 1: probe disk for all items in the current set.
      const probeResults = await Promise.all(
        visibleItems.slice(0, 50).map(async (r) => ({ id: r.id, u: await getCachedRecordingUrl(r.id, scope) }))
      );
      if (cancelled || activeScopeRef.current !== scopeId) return;

      // Update cachedIds state ONCE from probe results (single re-render).
      const next = new Set<string>();
      probeResults.forEach(({ id, u }) => { if (u) next.add(id); });
      cachedIdsRef.current = next;
      setCachedIds(new Set(next));

      // Step 2: prefetch is intentionally disabled.
      // Downloading recordings in the background saturates the iOS WKWebView
      // JS thread (each recording requires 2–3 round-trips to Supabase + PBX)
      // and causes the app to freeze. Recordings are downloaded on demand
      // when the user taps the ► play button or the ⬇ download button.
    })();

    return () => { cancelled = true; };
  // itemsIdsKey is a stable memo derived from items — safe to use as dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsIdsKey, scopeId]);



  const recMeta = (rec: RecordingEntry) => ({
    xml_cdr_uuid: rec.xml_cdr_uuid || rec.pbx_uuid || rec.id,
    recording_name: rec.record_name,
  });

  const captureError = (rec: RecordingEntry, e: any, fallback: string) => {
    const msg = e?.message || fallback;
    setPlaybackErrors((prev) => ({
      ...prev,
      [rec.id]: {
        kind: String(e?.failure_kind || e?.code || 'unknown'),
        code: String(e?.code || ''),
        ref: String(e?.correlation_id || ''),
        message: msg,
        statuses: Array.isArray(e?.http_statuses) ? e.http_statuses : [],
      },
    }));
    showMobileToast(msg, 'error');
  };

  const play = async (rec: RecordingEntry) => {
    if (!scope || !scopeId || rec.extension !== scope.extension || rec.organization_id !== scope.organizationId) return;
    const requestScope = scopeId;
    if (playingId === rec.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    setLoadingId(rec.id);
    setPlaybackErrors((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
    try {
      // Phase 5: serve from local cache first; if missing, download (and cache) on the fly.
      let url = await getCachedRecordingUrl(rec.id, scope);
      if (activeScopeRef.current !== requestScope) return;
      if (!url) {
        url = await downloadRecording(
          rec.id, recMeta(rec),
          creds?.accessToken || null,
          creds?.organizationId || null,
          creds?.domainUuid || creds?.fusionpbxDomainUuid || null,
          { scope },
        );
        if (activeScopeRef.current !== requestScope) return;
        setCachedIds((prev) => new Set(prev).add(rec.id));
      }
      currentPlaybackRef.current = rec;
      recoveringRef.current = false;
      if (audioRef.current) {
        console.log('[RecordingsScreen] cid=' + rec.id + ' action=set-src', { url });
        audioRef.current.src = url;
        audioRef.current.load();
        audioRef.current.play().catch((err) => {
          console.warn('[RecordingsScreen] cid=' + rec.id + ' action=play-rejected', { message: err?.message });
        });
      }
      setPlayingId(rec.id);
    } catch (e: any) {
      if (activeScopeRef.current === requestScope) captureError(rec, e, fr ? 'Impossible de charger l\'enregistrement' : 'Unable to load recording');
    } finally {
      if (activeScopeRef.current === requestScope) setLoadingId(null);
    }
  };

  const download = async (rec: RecordingEntry) => {
    if (!scope || !scopeId || rec.extension !== scope.extension || rec.organization_id !== scope.organizationId) return;
    const requestScope = scopeId;
    setDownloadingId(rec.id);
    setPlaybackErrors((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
    try {
      await downloadRecording(
        rec.id, recMeta(rec),
        creds?.accessToken || null,
        creds?.organizationId || null,
        creds?.domainUuid || creds?.fusionpbxDomainUuid || null,
        { force: true, scope },
      );
      if (activeScopeRef.current !== requestScope) return;
      setCachedIds((prev) => new Set(prev).add(rec.id));
      showMobileToast(fr ? 'Enregistrement téléchargé pour écoute hors-ligne' : 'Recording downloaded for offline playback', 'success');
    } catch (e: any) {
      if (activeScopeRef.current === requestScope) captureError(rec, e, fr ? 'Téléchargement échoué' : 'Download failed');
    } finally {
      if (activeScopeRef.current === requestScope) setDownloadingId(null);
    }
  };



  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div>
      {myExtension && (
        <div data-testid="recordings-own-extension" style={{ fontSize: font.xs, color: colors.mutedSilver, margin: '6px 2px 10px' }}>
          {fr ? `Enregistrements de votre extension connectée ${myExtension}.` : `Showing recordings for your connected extension ${myExtension}.`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '0 2px 10px' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={fr ? 'Rechercher nom, numéro, extension…' : 'Search name, number, extension…'} style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.06)', color: colors.textIce, fontSize: 12, outline: 'none' }} />
        {([7, 30] as const).map((d) => <button key={d} onClick={() => onRangeDaysChange(d)} style={{ padding: '7px 9px', borderRadius: 10, border: `1px solid ${rangeDays === d ? colors.borderGold : colors.border}`, background: rangeDays === d ? colors.signalGold + '1a' : 'rgba(255,255,255,0.04)', color: rangeDays === d ? colors.signalGold : colors.mutedSilver, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{d}{fr ? 'j' : 'd'}</button>)}
      </div>

      <audio
        ref={audioRef}
        onEnded={() => {
          recoveringRef.current = false;
          currentPlaybackRef.current = null;
          setPlayingId(null);
        }}
        onError={async (e) => {
          const rec = currentPlaybackRef.current;
          const mediaErr = (e?.currentTarget as HTMLAudioElement | undefined)?.error;
          console.warn('[RecordingsScreen] cid=' + (rec?.id || 'none') + ' action=audio-error', {
            code: mediaErr?.code ?? null,
            message: mediaErr?.message ?? null,
            src: audioRef.current?.currentSrc || null,
          });
          if (!rec || !scope || !scopeId || rec.extension !== scope.extension || rec.organization_id !== scope.organizationId || recoveringRef.current) return;
          const requestScope = scopeId;
          recoveringRef.current = true;  // permanent lock — never reset in finally
          setLoadingId(rec.id);
          try {
            const freshUrl = await downloadRecording(
              rec.id, recMeta(rec),
              creds?.accessToken || null,
              creds?.organizationId || null,
              creds?.domainUuid || creds?.fusionpbxDomainUuid || null,
              { force: true, scope },
            );
            if (activeScopeRef.current !== requestScope) return;
            setPlaybackErrors((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setCachedIds((prev) => new Set(prev).add(rec.id));
            if (audioRef.current) {
              console.log('[RecordingsScreen] cid=' + rec.id + ' action=recover-set-src', { url: freshUrl });
              audioRef.current.src = freshUrl;
              audioRef.current.load();
              audioRef.current.play().catch((err) => {
                console.warn('[RecordingsScreen] cid=' + rec.id + ' action=recover-play-rejected', { message: err?.message });
              });
            }
          } catch (e: any) {
            if (activeScopeRef.current !== requestScope) return;
            recoveringRef.current = false;  // only reset on hard failure so user can retry
            captureError(rec, e, fr ? 'Impossible de recharger l\'enregistrement' : 'Unable to reload recording');
          } finally {
            if (activeScopeRef.current === requestScope) setLoadingId(null);
            // DO NOT reset recoveringRef.current here — see comment above.
          }
        }}
        style={{ width: '100%', marginBottom: 10 }}
        controls
      />

      {visibleError && (
        <Card accent="gold" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: font.sm, color: colors.danger, fontWeight: 700 }}>{fr ? 'Échec du chargement des enregistrements' : 'Failed to load recordings'}</div>
          <div style={{ fontSize: 11, color: colors.mutedSilver, marginTop: 4 }}>{visibleError}</div>
        </Card>
      )}

      {!visibleItems && <ListSkeleton rows={5} />}
      {visibleItems && visibleItems.filter((r) => !search.trim() || [r.customer, r.from, r.to, r.extension, r.summary].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase())).length === 0 && (
        <EmptyState icon="🎙" title={fr ? 'Aucun enregistrement' : 'No recordings yet'} hint={fr ? 'Les enregistrements de votre extension apparaîtront ici.' : 'Recordings for your extension will appear here.'} />
      )}
      {visibleItems && visibleItems.filter((r) => !search.trim() || [r.customer, r.from, r.to, r.extension, r.summary].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase())).map((r) => (
        <div key={r.id} style={{ marginBottom: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            borderRadius: radius.lg,
            background: gradients.card,
            border: `1px solid ${playingId === r.id || expandedId === r.id ? colors.signalGold : colors.border}`,
            color: colors.textIce,
          }}>
            <button onClick={() => play(r)} style={{
              width: 32, height: 32, borderRadius: 16, display: 'grid', placeItems: 'center',
              background: 'rgba(255,255,255,0.06)', color: colors.signalGold, fontSize: 14,
              border: 'none', cursor: 'pointer',
            }}>
              {loadingId === r.id ? '…' : playingId === r.id ? '❚❚' : '▶'}
            </button>
            <button onClick={() => toggleExpand(r.id)} style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'inherit',
              textAlign: 'left', cursor: 'pointer', padding: 0,
            }}>
              <div style={{ fontSize: font.base, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.customer || r.from || r.to || (fr ? 'Appelant inconnu' : 'Unknown caller')}
              </div>
              <div style={{ fontSize: font.xs, color: colors.mutedSilver, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                {r.from} → {r.to}{r.extension ? ` · ext ${r.extension}` : ''}
              </div>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: font.xs, color: colors.mutedSilver }}>
                {new Date(r.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Chip tone="gold" size="xs">{Math.max(1, Math.round(r.durationSec / 60))}m</Chip>
                {r.hasTranscript && <Chip tone="violet" size="xs">AI</Chip>}
                {cachedIds.has(r.id) && <Chip tone="success" size="xs">{fr ? 'Hors-ligne' : 'Offline'}</Chip>}
                <button
                  onClick={() => download(r)}
                  disabled={downloadingId === r.id}
                  title={fr ? 'Télécharger pour écoute hors-ligne' : 'Download for offline playback'}
                  style={{
                    background: 'transparent', border: `1px solid ${colors.border}`, color: colors.signalGold,
                    borderRadius: 8, padding: '2px 6px', fontSize: 10, fontWeight: 800,
                    cursor: downloadingId === r.id ? 'wait' : 'pointer',
                  }}>
                  {downloadingId === r.id ? '…' : cachedIds.has(r.id) ? '↻' : '⬇'}
                </button>
                <button onClick={() => toggleExpand(r.id)} style={{
                  background: 'transparent', border: `1px solid ${colors.borderAI}`, color: colors.avaViolet,
                  borderRadius: 8, padding: '2px 6px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <Sparkles size={10} /> {expandedId === r.id ? (fr ? 'Masquer' : 'Hide') : 'AI'}
                </button>
              </div>
            </div>
          </div>
          {playbackErrors[r.id] && (() => {
            const err = playbackErrors[r.id];
            const kindLabel = err.kind === 'login_failed' ? (fr ? 'Connexion PBX échouée' : 'PBX login failed')
              : err.kind === 'file_missing' ? (fr ? 'Fichier audio absent du PBX' : 'Audio file missing on PBX')
              : err.kind === 'missing_secret' ? (fr ? 'Configuration Vault manquante' : 'Vault config missing')
              : err.kind === 'http_error' ? (fr ? 'Erreur HTTP PBX' : 'PBX HTTP error')
              : err.kind === 'forbidden' ? (fr ? 'Accès refusé' : 'Access denied')
              : err.kind === 'internal' ? (fr ? 'Erreur interne du proxy' : 'Proxy internal error')
              : (fr ? 'Lecture impossible' : 'Playback failed');
            return (
              <div style={{ marginTop: 8, padding: 10, borderRadius: radius.md, border: `1px solid ${colors.danger}55`, background: `${colors.danger}10` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ color: colors.danger, fontSize: 11, fontWeight: 800 }}>⚠ {kindLabel}</div>
                  {err.statuses.length > 0 && <Chip tone="danger" size="xs">HTTP {err.statuses.join('/')}</Chip>}
                </div>
                <div style={{ color: colors.mutedSilver, fontSize: 11, lineHeight: 1.4, wordBreak: 'break-word' }}>{err.message}</div>
                {err.ref && (
                  <div style={{ marginTop: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, color: colors.mutedSilver, opacity: 0.8 }}>
                    {fr ? 'Réf. support' : 'Support ref'} : {err.ref}{err.code ? ` · ${err.code}` : ''}
                  </div>
                )}
              </div>
            );
          })()}
          {expandedId === r.id && (
            <RecordingAiPanel rec={r} />
          )}
        </div>
      ))}
    </div>
  );
}

function RecordingAiPanel({ rec }: { rec: RecordingEntry }) {
  const { lang } = useT();
  const fr = lang === 'fr';
  const { data, loading, running, stage, error, run } = useCallAi(rec.id);

  const hasTranscript = (data?.transcript?.length || 0) > 0;
  const hasAi = !!data?.summary || (data?.coachingNotes?.length || 0) > 0;

  // Auto-trigger AI on first expand if nothing is cached and no prior error.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (loading || running) return;
    if (hasTranscript || hasAi || error) return;
    autoStartedRef.current = true;
    run();
  }, [loading, running, hasTranscript, hasAi, error, run]);

  const statusText = running
    ? stage === 'analyzing' ? (fr ? 'Analyse · coaching et sentiment…' : 'Analyzing call · coaching & sentiment…') : (fr ? 'Transcription audio par IA…' : 'Transcribing audio with AI…')
    : error ? (fr ? 'Échec de l\'IA' : 'AI run failed')
    : hasAi ? (fr ? 'IA prête · en cache' : 'AI ready · cached')
    : hasTranscript ? (fr ? 'Transcription prête' : 'Transcript ready')
    : (fr ? 'Préparation de l\'IA…' : 'Preparing AI…');

  return (
    <div style={{ margin: '8px 0 0', padding: 12, borderRadius: radius.lg, border: `1px solid ${colors.borderAI}`, background: 'rgba(122,76,255,0.05)' }}>
      {loading && !data ? (
        <Skeleton w="60%" h={14} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: colors.avaViolet, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 800 }}>{statusText}</div>
            <button onClick={() => run()} disabled={running} style={{
              padding: '6px 10px', borderRadius: 999, border: 'none',
              background: running ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, ${colors.avaViolet}, ${colors.avaCyan})`,
              color: '#fff', fontSize: 11, fontWeight: 800, cursor: running ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {running ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
              {running ? (fr ? 'Traitement…' : 'Working…') : error ? (fr ? 'Réessayer' : 'Retry') : (hasTranscript || hasAi) ? (fr ? 'Relancer l\'IA' : 'Re-run AI') : (fr ? 'Transcrire et analyser' : 'Transcribe & analyze')}
            </button>
          </div>

          {/* Progress stepper */}
          {(running || (!hasAi && !error)) && (
            <ProgressStepper stage={running ? stage : (hasTranscript ? 'analyzing' : 'transcribing')} />
          )}

          {error && (
            <div style={{ marginBottom: 8, padding: 10, borderRadius: radius.md, border: `1px solid ${colors.danger}55`, background: `${colors.danger}10` }}>
              <div style={{ color: colors.danger, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>⚠ {fr ? 'Échec de la transcription' : 'Transcription failed'}</div>
              <div style={{ color: colors.mutedSilver, fontSize: 11, marginBottom: 8, wordBreak: 'break-word' }}>{error}</div>
              <button onClick={() => run()} disabled={running} style={{
                padding: '5px 10px', borderRadius: 8, border: `1px solid ${colors.danger}80`,
                background: 'transparent', color: colors.danger, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
              }}>↻ {fr ? 'Relancer l\'IA' : 'Retry AI run'}</button>
            </div>
          )}

          {data?.summary && (
            <AIPanel title={fr ? 'Résumé' : 'Summary'} accent={colors.avaViolet}>
              <p style={{ fontSize: font.sm, lineHeight: 1.5, color: colors.textIce, margin: 0 }}>{data.summary}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {data.coachingScore != null && <Chip tone="cyan" size="xs">Coaching {data.coachingScore}/5</Chip>}
                {data.qualityScore > 0 && <Chip tone="gold" size="xs">{fr ? 'Qualité' : 'Quality'} {data.qualityScore}/100</Chip>}
                {data.sentiment && <Chip tone={data.sentiment === 'positive' ? 'success' : data.sentiment === 'negative' ? 'danger' : 'neutral'} size="xs">{data.sentiment}</Chip>}
              </div>
            </AIPanel>
          )}

          {data?.coachingNotes && data.coachingNotes.length > 0 && (
            <AIPanel title={fr ? 'Notes de coaching' : 'Coaching notes'} accent={colors.avaCyan}>
              {data.coachingNotes.map((n, i) => (
                <div key={i} style={{ fontSize: font.sm, color: colors.textIce, lineHeight: 1.45, padding: '4px 0' }}>✦ {n}</div>
              ))}
            </AIPanel>
          )}

          {data?.actionItems && data.actionItems.length > 0 && (
            <AIPanel title={fr ? 'Actions à faire' : 'Action items'} accent={colors.success}>
              {data.actionItems.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: font.sm, color: colors.textIce }}>
                  <span style={{ color: colors.success }}>→</span><span>{a}</span>
                </div>
              ))}
            </AIPanel>
          )}

          {hasTranscript && (
            <AIPanel title={fr ? 'Transcription' : 'Transcript'} accent={colors.signalGold}>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {data!.transcript.map((line, i) => (
                  <div key={i} style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: line.speaker === 'agent' ? 'flex-end' : 'flex-start',
                    marginBottom: 6,
                  }}>
                    <div style={{ fontSize: 9, color: colors.mutedSilver, marginBottom: 2, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
                      {line.speaker === 'agent' ? 'Agent' : line.speaker === 'customer' ? (fr ? 'Appelant' : 'Caller') : (fr ? 'Interlocuteur' : 'Speaker')}
                    </div>
                    <div style={{
                      maxWidth: '88%', padding: '6px 10px', borderRadius: 12,
                      fontSize: font.sm, lineHeight: 1.4,
                      background: line.speaker === 'agent' ? 'rgba(106,225,255,0.12)' : 'rgba(255,255,255,0.05)',
                      color: colors.textIce,
                    }}>{line.text}</div>
                  </div>
                ))}
              </div>
            </AIPanel>
          )}
        </>
      )}
    </div>
  );
}

function ProgressStepper({ stage }: { stage: 'idle' | 'transcribing' | 'analyzing' | 'done' | 'error' }) {
  const { lang } = useT();
  const fr = lang === 'fr';
  const steps = [
    { id: 'transcribing', label: fr ? 'Transcrire' : 'Transcribe' },
    { id: 'analyzing', label: fr ? 'Analyser' : 'Analyze' },
    { id: 'done', label: fr ? 'Prêt' : 'Ready' },
  ];
  const activeIdx = stage === 'analyzing' ? 1 : stage === 'done' ? 2 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 10px' }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 999,
            background: i <= activeIdx ? `${colors.avaViolet}25` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${i <= activeIdx ? colors.avaViolet : colors.border}`,
            fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
            color: i <= activeIdx ? colors.avaViolet : colors.mutedSilver,
          }}>
            {i === activeIdx && stage !== 'done' ? <Loader2 size={10} className="spin" /> : i < activeIdx || stage === 'done' ? '✓' : i + 1}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, background: i < activeIdx ? colors.avaViolet : colors.border, borderRadius: 2 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '32px 1fr 60px',
          alignItems: 'center', gap: 12, padding: 14, marginBottom: 8,
          borderRadius: 12, background: gradients.card, border: `1px solid ${colors.border}`,
        }}>
          <Skeleton w={32} h={32} r={999} />
          <div>
            <Skeleton w="55%" h={12} />
            <div style={{ height: 6 }} />
            <Skeleton w="35%" h={10} />
          </div>
          <Skeleton w={40} h={10} />
        </div>
      ))}
    </div>
  );
}
