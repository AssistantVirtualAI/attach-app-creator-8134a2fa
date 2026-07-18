// Android SIP hook — uses FreeSWITCH Verto (port 8082) instead of JsSIP/WSS.
//
// Media flows through FreeSWITCH server-side, so no TURN is required — this
// unblocks calls on carriers (Bell Canada) that filter TURN DNS.
//
// Exposes the same UseSoftphoneReturn surface as useSoftphoneJsSip so the
// rest of the app (DialerScreen, ActiveCallSheet, SipDebugPanel, …) doesn't
// need to know which transport is active.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SIPConfig } from '../lib/sip/jssipProvider';
import type { UseSoftphoneReturn, SIPStatus, CallState } from './useSoftphone';
import {
  appendSipLog, clearSipLog as clearPersistedLog, clearPersistedStatus, loadPersistedError,
  loadSipLog, savePersistedError, savePersistedStatus, SipLogEntry, PersistedSipError,
} from '../lib/sip/sipPersistence';
import { EMPTY_QUALITY, CallQuality } from '../lib/sip/callQuality';
import { AudioProfile, loadAudioProfile, saveAudioProfile, PROFILE_OPUS } from '../lib/sip/audioProfile';
import { attachRemoteStream } from '../lib/sip/audioOutput';
import { initVerto, getVertoClient, VertoDialog, VertoEvent } from '../lib/sip/vertoProvider';

const VERTO_HOST = 'pbxnode.lemtel.tel';
const VERTO_PORT = 8082;

export function useSoftphoneVerto(config: SIPConfig | null): UseSoftphoneReturn {
  const [sipStatus, setSipStatusState] = useState<SIPStatus>('idle');
  const [sipError, setSipError] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callTimer, setCallTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [activeCallNumber, setActiveCallNumber] = useState('');
  const [lastPersistedError, setLastPersistedError] = useState<PersistedSipError | null>(() => loadPersistedError());
  const [sipLog, setSipLog] = useState<SipLogEntry[]>(() => loadSipLog());
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [audioProfile, setAudioProfileState] = useState<AudioProfile>(() => loadAudioProfile() || PROFILE_OPUS);

  const activeDialogRef = useRef<VertoDialog | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef<SIPConfig | null>(config);
  configRef.current = config;

  const log = useCallback((event: string, details?: any) => {
    const entry = appendSipLog({ event, at: Date.now(), details });
    setSipLog((prev) => [...prev, entry].slice(-200));
  }, []);

  const setStatus = useCallback((next: SIPStatus, err?: string) => {
    setSipStatusState(next);
    savePersistedStatus(next);
    if (err !== undefined) setSipError(err);
    if (next === 'error' && err) {
      const persisted: PersistedSipError = { message: err, at: Date.now() };
      savePersistedError(persisted);
      setLastPersistedError(persisted);
    }
    if (next === 'registered') {
      setSipError('');
    }
  }, []);

  // ── Connect / register lifecycle ────────────────────────────────────────
  useEffect(() => {
    if (!config?.extension || !config?.password) {
      console.log('[Verto] no config — staying idle');
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    console.log('[Verto] connecting to', VERTO_HOST + ':' + VERTO_PORT, 'ext=', config.extension);
    log('verto.connecting', { host: VERTO_HOST, port: VERTO_PORT, ext: config.extension });

    (async () => {
      try {
        await initVerto({
          host: VERTO_HOST,
          port: VERTO_PORT,
          login: config.extension,
          password: config.password,
          domain: config.domain,
          caller_id_name: config.displayName || config.extension,
          caller_id_number: config.extension,
        });
        if (cancelled) return;
        console.log('[Verto] registered ✅ ext=', config.extension);
        log('verto.registered');
        setStatus('registered');
        setRetryAttempt(0);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.message || 'Verto connection failed';
        console.error('[Verto] connection error:', msg);
        log('verto.error', { message: msg });
        setStatus('error', msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config?.extension, config?.password, config?.refreshNonce, log, setStatus]);

  // ── Verto event stream → local state ────────────────────────────────────
  useEffect(() => {
    const client = getVertoClient();
    const off = client.on((e: VertoEvent) => {
      switch (e.type) {
        case 'registered':
          setStatus('registered');
          break;
        case 'disconnected':
          log('verto.disconnected', { reason: e.reason });
          setStatus('retrying', 'WebSocket disconnected');
          break;
        case 'error':
          log('verto.error', { message: e.error });
          setStatus('error', e.error);
          break;
        case 'incoming':
          activeDialogRef.current = e.dialog;
          setActiveCallNumber(e.from);
          setCallState('ringing');
          log('verto.incoming', { from: e.from });
          break;
        case 'progress':
          setCallState('ringing');
          break;
        case 'answered':
          activeDialogRef.current = e.dialog;
          setCallState('active');
          setCallTimer(0);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => setCallTimer((t) => t + 1), 1000);
          log('verto.answered', { callID: e.dialog.callID });
          break;
        case 'media':
          try { attachRemoteStream(e.stream); } catch (err) { console.warn('[verto] attach remote stream failed', err); }
          break;
        case 'hangup':
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          activeDialogRef.current = null;
          setCallState('ended');
          setIsMuted(false);
          setIsOnHold(false);
          setActiveCallNumber('');
          log('verto.hangup', { cause: e.cause });
          setTimeout(() => setCallState('idle'), 800);
          break;
      }
    });
    return () => { off(); };
  }, [log, setStatus]);

  // ── Actions ────────────────────────────────────────────────────────────
  const call = useCallback((number: string): boolean => {
    const cfg = configRef.current;
    if (!cfg?.extension) return false;
    // vertoProvider.call() handles getUserMedia internally with a silent-track
    // fallback for emulators. A pre-flight getUserMedia here would cause a
    // double mic acquisition which corrupts the WebRTC audio send stream
    // (min_bitrate_bps=-1 / max_bitrate_bps=-1) and causes immediate hang-up.
    getVertoClient().call(number, cfg.displayName || cfg.extension, cfg.extension)
      .then((d) => {
        if (d) {
          activeDialogRef.current = d;
          setActiveCallNumber(number);
          setCallState('ringing');
          log('verto.call.out', { to: number, callID: d.callID });
        } else {
          setSipError('Verto refused to place the call');
        }
      })
      .catch((err: any) => {
        const msg = err?.message || 'Call failed';
        log('verto.call.error', { message: msg });
        setSipError(msg);
      });
    return true;
  }, [log]);

  const hangup = useCallback(() => {
    const d = activeDialogRef.current;
    if (d) { try { d.hangup(); } catch { /* ignore */ } }
    else { getVertoClient().hangupAll(); }
  }, []);

  const answer = useCallback(() => {
    activeDialogRef.current?.answer();
  }, []);

  const setMic = (on: boolean) => {
    const s = localStreamRef.current;
    if (s) s.getAudioTracks().forEach((t) => (t.enabled = on));
  };
  const mute = useCallback(() => { setMic(false); setIsMuted(true); }, []);
  const unmute = useCallback(() => { setMic(true); setIsMuted(false); }, []);
  const hold = useCallback(() => { activeDialogRef.current?.hold(); setIsOnHold(true); }, []);
  const unhold = useCallback(() => { activeDialogRef.current?.unhold(); setIsOnHold(false); }, []);
  const sendDTMF = useCallback((k: string) => { activeDialogRef.current?.dtmf(k); }, []);

  const setStatusPresence = useCallback((_s: string) => { /* presence not wired to Verto */ }, []);
  const reconnect = useCallback(() => {
    if (!configRef.current) return;
    log('verto.reconnect');
    setRetryAttempt((a) => a + 1);
    // Trigger re-connect by nudging status; the connect effect re-runs when
    // refreshNonce changes upstream. Here we simply try a fresh connect.
    getVertoClient().disconnect();
    setStatus('connecting');
    initVerto({
      host: VERTO_HOST,
      port: VERTO_PORT,
      login: configRef.current.extension,
      password: configRef.current.password,
      domain: configRef.current.domain,
      caller_id_name: configRef.current.displayName || configRef.current.extension,
      caller_id_number: configRef.current.extension,
    }).then(() => setStatus('registered')).catch((e) => setStatus('error', e?.message));
  }, [log, setStatus]);

  const clearSipLog = useCallback(() => { clearPersistedLog(); setSipLog([]); }, []);
  const clearSipState = useCallback(() => {
    clearPersistedStatus();
    setLastPersistedError(null);
    setSipError('');
  }, []);

  const setAudioProfile = useCallback((p: AudioProfile) => {
    setAudioProfileState(p);
    saveAudioProfile(p);
  }, []);

  return useMemo<UseSoftphoneReturn>(() => ({
    sipStatus, sipError, callState, callTimer, isMuted, isOnHold, activeCallNumber,
    call, hangup, answer, mute, unmute, hold, unhold, sendDTMF,
    setStatus: setStatusPresence, reconnect,
    lastPersistedError, sipLog, clearSipLog, clearSipState,
    retryAttempt, nextRetryAt: null, retryLimitReached: false,
    quality: EMPTY_QUALITY as CallQuality,
    audioProfile, setAudioProfile,
    offeredCodecs: ['opus/48000/2', 'PCMU/8000'],
    negotiatedCodec: callState === 'active' ? 'opus/48000/2' : null,
  }), [
    sipStatus, sipError, callState, callTimer, isMuted, isOnHold, activeCallNumber,
    call, hangup, answer, mute, unmute, hold, unhold, sendDTMF, setStatusPresence, reconnect,
    lastPersistedError, sipLog, clearSipLog, clearSipState, retryAttempt,
    audioProfile, setAudioProfile,
  ]);
}
