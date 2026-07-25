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
  loadPersistedStatus, loadSipLog, savePersistedError, savePersistedStatus, SipLogEntry, PersistedSipError,
} from '../lib/sip/sipPersistence';
import { EMPTY_QUALITY, CallQuality } from '../lib/sip/callQuality';
import { AudioProfile, loadAudioProfile, saveAudioProfile } from '../lib/sip/audioProfile';
import { attachRemoteStream, toggleSpeaker } from '../lib/sip/audioOutput';
import { initVerto, getVertoClient, VertoDialog, VertoEvent } from '../lib/sip/vertoProvider';
import { normalizePhone } from '../lib/phoneNormalize';
import { attachNativeAutoReconnect } from '../lib/sip/nativeAutoReconnect';
import {
  getAndroidSipServiceStatus,
  onAndroidSipServiceStatus,
  answerAndroidNativeCall,
  hangupAndroidNativeCall,
  requestAndroidBatteryOptimizationExemption,
  startAndroidSipService,
  type AndroidSipServiceStatus,
} from '../lib/sip/nativeSipProvider';

const VERTO_HOST = 'pbxnode.lemtel.tel';
const VERTO_PORT = 8082;

export function useSoftphoneVerto(config: SIPConfig | null): UseSoftphoneReturn {
  // Restore the last known status from storage so the UI never flashes 'idle'
  // on first render while hydration / Verto connect is still in progress.
  // 'registered' will be re-confirmed by initVerto; 'connecting'/'retrying'
  // are safe to show while reconnecting.
  const [sipStatus, setSipStatusState] = useState<SIPStatus>(() => {
    const persisted = loadPersistedStatus() as SIPStatus | null;
    if (persisted && persisted !== 'idle' && persisted !== 'error') return persisted;
    return 'idle';
  });
  const [sipError, setSipError] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callTimer, setCallTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [activeCallNumber, setActiveCallNumber] = useState('');
  const [lastPersistedError, setLastPersistedError] = useState<PersistedSipError | null>(() => loadPersistedError());
  const [sipLog, setSipLog] = useState<SipLogEntry[]>(() => loadSipLog());
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [audioProfile, setAudioProfileState] = useState<AudioProfile>(() => loadAudioProfile() || 'auto');
  const [androidSipServiceStatus, setAndroidSipServiceStatus] = useState<AndroidSipServiceStatus | null>(null);

  const activeDialogRef = useRef<VertoDialog | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef<SIPConfig | null>(config);
  const nativeInviteCallIdRef = useRef<string | null>(null);
  const nativeAnswerRequestedCallIdRef = useRef<string | null>(null);
  configRef.current = config;

  const log = useCallback((event: string, details?: any) => {
    const entry: SipLogEntry = {
      event,
      time: Date.now(),
      level: 'info',
      detail: details ? JSON.stringify(details) : undefined,
    };
    const next = appendSipLog(entry);
    setSipLog(next);
  }, []);

  const setStatus = useCallback((next: SIPStatus, err?: string) => {
    setSipStatusState(next);
    savePersistedStatus(next);
    if (err !== undefined) setSipError(err);
    if (next === 'error' && err) {
      const cfg = configRef.current;
      const persisted: PersistedSipError = {
        error: err,
        extension: cfg?.extension || '',
        domain: cfg?.domain || '',
        time: Date.now(),
      };
      savePersistedError(persisted);
      setLastPersistedError(persisted);
    }
    if (next === 'registered') {
      setSipError('');
    }
  }, []);

  const applyNativeStatus = useCallback((native: AndroidSipServiceStatus | null, source = 'event') => {
    if (!native) return;
    setAndroidSipServiceStatus(native);
    log(source === 'poll' ? 'verto.native.poll' : 'verto.native.status', {
      status: native.status,
      reason: native.reason,
      loggedIn: native.loggedIn,
      wake: native.wakeLockHeld,
      wifi: native.wifiLockHeld,
      attempt: native.reconnectAttempt,
    });

    const nativeStatus = String(native.status || '').toLowerCase();
    if (nativeStatus === 'incoming') {
      const caller = native.callerNumber || native.callerName || native.reason || '';
      setStatus('registered');
      if (caller) setActiveCallNumber(caller);
      setCallState('ringing-in');
      const rawInvite = native.inviteParams;
      const inviteParams = typeof rawInvite === 'string'
        ? (() => { try { return rawInvite ? JSON.parse(rawInvite) : null; } catch { return null; } })()
        : rawInvite;
      const callID = inviteParams?.callID || native.callId;
      const shouldAnswer = native.reason === 'answer_requested' && callID && nativeAnswerRequestedCallIdRef.current !== callID;
      console.log('[verto] native incoming inviteParams present:', !!inviteParams?.sdp, 'callId:', callID, 'reason:', native.reason);
      if (inviteParams?.sdp && callID && nativeInviteCallIdRef.current !== callID) {
        nativeInviteCallIdRef.current = callID;
        getVertoClient().adoptNativeInboundInvite(
          inviteParams,
          async (sdp, dialogParams) => { await answerAndroidNativeCall(sdp, dialogParams); },
          async () => { await hangupAndroidNativeCall(); },
        ).then((dialog) => {
          if (!dialog) return;
          activeDialogRef.current = dialog;
          if (shouldAnswer) {
            nativeAnswerRequestedCallIdRef.current = callID;
            dialog.answer();
          }
        }).catch((e) => log('verto.native.adopt.error', { message: e?.message || String(e) }));
      } else if (shouldAnswer && activeDialogRef.current) {
        nativeAnswerRequestedCallIdRef.current = callID;
        activeDialogRef.current.answer();
      }
      return;
    }
    if (nativeStatus !== 'incoming') {
      nativeInviteCallIdRef.current = null;
      nativeAnswerRequestedCallIdRef.current = null;
    }
    if (nativeStatus === 'active') {
      setStatus('registered');
      setCallState((prev) => (prev === 'idle' ? 'active' : prev === 'ringing-in' ? 'active' : prev));
      return;
    }
    if (nativeStatus === 'idle') {
      setCallState((prev) => {
        if (prev === 'active' || prev === 'ringing-in' || prev === 'ringing-out') {
          console.log('[verto] native idle received — resetting call state');
          setActiveCallNumber('');
          setIsMuted(false);
          setIsOnHold(false);
          activeDialogRef.current = null;
          nativeInviteCallIdRef.current = null;
          return 'idle';
        }
        return prev;
      });
    }
    if (native.loggedIn || nativeStatus === 'registered' || nativeStatus === 'incoming') {
      setStatus('registered');
      return;
    }
    if (nativeStatus === 'connecting') {
      setStatus('connecting', native.reason || undefined);
      return;
    }
    if (nativeStatus === 'reconnecting' || nativeStatus === 'disconnected') {
      setStatus('retrying', native.reason || 'Native Verto reconnecting');
      return;
    }
    if (nativeStatus === 'error') {
      setStatus('error', native.reason || 'Native Verto service error');
    }
  }, [log, setStatus]);

  // ── Connect / register lifecycle ────────────────────────────────────────
  useEffect(() => {
    if (!config?.extension || !config?.password) {
      // Don't override a meaningful persisted status (e.g. 'connecting') while
      // hydration is still in progress — only reset to idle if we were already idle.
      if (sipStatus === 'idle') {
        console.log('[Verto] no config — staying idle');
      } else {
        console.log('[Verto] no config yet — keeping status:', sipStatus);
      }
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    console.log('[Verto] connecting to', VERTO_HOST + ':' + VERTO_PORT, 'ext=', config.extension);
    log('verto.connecting', { host: VERTO_HOST, port: VERTO_PORT, ext: config.extension });

    // Start the Android foreground service BEFORE opening the WebSocket so
    // WakeLock + WifiLock are held throughout register (and beyond). Keep it
    // running for the full lifetime of the hook — stopping it releases the
    // WakeLock and lets Doze mode kill the socket, which is exactly why the
    // app went 'unregistered' when the screen locked.
    startAndroidSipService({
      host: VERTO_HOST,
      port: VERTO_PORT,
      login: config.extension,
      password: config.password,
      domain: config.domain || 'lemtel.lemtel.tel',
      displayName: config.displayName || config.extension,
    }).then((native) => applyNativeStatus(native, 'start')).catch(() => { /* ignore on non-Android */ });

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
        // Start foreground service with native Kotlin WebSocket that maintains
        // Verto registration independently of the WebView — survives screen-off,
        // background throttling, and JS timer suspension on Android.
        startAndroidSipService({
          host: VERTO_HOST,
          port: VERTO_PORT,
          login: config.extension,
          password: config.password,
          domain: config.domain || 'lemtel.lemtel.tel',
          displayName: config.displayName || config.extension,
        }).then((native) => applyNativeStatus(native, 'start')).catch(() => { /* ignore on non-Android */ });
        requestAndroidBatteryOptimizationExemption().catch(() => { /* ignore on non-Android */ });
      } catch (e: any) {

        if (cancelled) return;
        const msg = e?.message || 'Verto connection failed';
        console.error('[Verto] connection error:', msg);
        log('verto.error', { message: msg });
        setStatus('error', msg);
        // Auto-retry with exponential backoff: 5s → 10s → 20s → 30s (max).
        // This ensures ALL users register reliably even on slow/flaky networks
        // or when the server is temporarily overloaded (SQLite BUSY).
        setRetryAttempt((prev) => {
          const attempt = prev + 1;
          const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          console.log(`[Verto] auto-retry in ${delay}ms (attempt ${attempt})`);
          setTimeout(() => {
            if (!cancelled) reconnect();
          }, delay);
          return attempt;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config?.extension, config?.password, config?.refreshNonce, log, setStatus]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    onAndroidSipServiceStatus((native) => {
      if (!cancelled) applyNativeStatus(native, 'event');
    }).then((fn) => { cleanup = fn; }).catch(() => {});

    const poll = setInterval(() => {
      getAndroidSipServiceStatus()
        .then((native) => { if (!cancelled && native) applyNativeStatus(native, 'poll'); })
        .catch((e) => log('verto.native.error', { message: e?.message || String(e) }));
    }, 15000);

    getAndroidSipServiceStatus()
      .then((native) => { if (!cancelled && native) applyNativeStatus(native, 'poll'); })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(poll);
      cleanup?.();
    };
  }, [applyNativeStatus, log]);

  // Ask the OS for battery-optimization exemption as soon as the hook mounts
  // (not only after a successful JS connect). Without this, Doze can kill the
  // foreground service before the first REGISTER even completes, and incoming
  // calls silently go to voicemail.
  useEffect(() => {
    requestAndroidBatteryOptimizationExemption().catch(() => {});
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', (state) => {
      if (cancelled) return;
      if (state.isActive) {
        log('verto.app.foreground.sync');
        getAndroidSipServiceStatus().then((native) => applyNativeStatus(native, 'poll')).catch(() => {});
      } else {
        log('verto.app.background.native-hold');
      }
    })).then((handle) => { cleanup = () => { handle.remove().catch(() => {}); }; }).catch(() => {});
    return () => { cancelled = true; cleanup?.(); };
  }, [applyNativeStatus, log]);

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
          if (androidSipServiceStatus?.loggedIn || androidSipServiceStatus?.status === 'registered') {
            log('verto.disconnected.native-held', { reason: e.reason });
            setStatus('registered');
          } else {
            setStatus('retrying', 'WebSocket disconnected');
          }
          // Keep the foreground service RUNNING so WakeLock/WifiLock stay
          // held while the Verto client auto-reconnects. Stopping the
          // service here was letting Android Doze mode kill the socket and
          // block reconnection until the app was re-opened.
          break;

        case 'error':
          log('verto.error', { message: e.error });
          setStatus('error', e.error);
          break;
        case 'incoming':
          activeDialogRef.current = e.dialog;
          setActiveCallNumber(e.from);
          setCallState('ringing-in');
          log('verto.incoming', { from: e.from });
          break;
        case 'progress':
          setCallState((prev) => prev === 'ringing-in' ? prev : 'ringing-out');
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
  }, [androidSipServiceStatus, log, setStatus]);

  // ── Actions ────────────────────────────────────────────────────────────
  const call = useCallback((number: string): boolean => {
    const cfg = configRef.current;
    if (!cfg?.extension) return false;
    // Only normalize external PSTN numbers (10+ digits or +E.164).
    // Internal extensions (3-4 digits) and star feature codes (*97, *72, *0…)
    // must be passed through untouched — normalizePhone would strip `*` and
    // return null for short numbers, breaking feature codes entirely.
    const digitsOnly = number.replace(/\D/g, '');
    const isExternal = /^\+/.test(number) || digitsOnly.length >= 10;
    const normalized = isExternal ? (normalizePhone(number) || number) : number;
    console.log('[verto][DIAG] call() normalizing:', number, '->', normalized, 'external=', isExternal);
    // vertoProvider.call() handles getUserMedia internally with a silent-track
    // fallback for emulators. A pre-flight getUserMedia here would cause a
    // double mic acquisition which corrupts the WebRTC audio send stream
    // (min_bitrate_bps=-1 / max_bitrate_bps=-1) and causes immediate hang-up.
    getVertoClient().call(normalized, cfg.displayName || cfg.extension, cfg.extension)
      .then((d) => {
        if (d) {
          activeDialogRef.current = d;
          setActiveCallNumber(number);
          setCallState('ringing-out');
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
    activeDialogRef.current = null;

    // Immediately reset local call state so the UI doesn't freeze waiting
    // for a server-side hangup event that may never arrive on flaky networks.
    setCallState('ended');
    setIsMuted(false);
    setIsOnHold(false);
    setActiveCallNumber('');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setTimeout(() => setCallState('idle'), 800);

    // Safety watchdog: if for any reason callState is still active/ringing
    // 5s after hangup was requested, force it to idle so the ActiveCallSheet
    // never gets stuck on flaky networks.
    setTimeout(() => {
      setCallState((prev) => (prev === 'active' || prev === 'ringing' || prev === 'ringing-in' || prev === 'ringing-out') ? 'idle' : prev);
    }, 5000);
  }, []);

  const answer = useCallback(() => {
    activeDialogRef.current?.answer();
  }, []);

  const mute = useCallback(() => {
    const d = activeDialogRef.current;
    if (d) { try { d.mute(); } catch { /* ignore */ } }
    setIsMuted(true);
  }, []);
  const unmute = useCallback(() => {
    const d = activeDialogRef.current;
    if (d) { try { d.unmute(); } catch { /* ignore */ } }
    setIsMuted(false);
  }, []);
  const hold = useCallback(() => { activeDialogRef.current?.hold(); setIsOnHold(true); }, []);
  const unhold = useCallback(() => { activeDialogRef.current?.unhold(); setIsOnHold(false); }, []);
  const sendDTMF = useCallback((k: string) => { activeDialogRef.current?.dtmf(k); }, []);

  const transfer = useCallback((target: string) => {
    const d = activeDialogRef.current;
    if (d) { try { d.transfer(target); } catch { /* ignore */ } }
  }, []);

  const toggleSpeakerFn = useCallback(async () => {
    try { await toggleSpeaker(); } catch (e) { console.warn('[verto] toggleSpeaker failed', e); }
  }, []);

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

  // ── WiFi ↔ LTE handover: re-register Verto when network changes ────────────
  // nativeAutoReconnect listens to @capacitor/network networkStatusChange and
  // App appStateChange events. When the network changes (e.g. WiFi → LTE),
  // it calls reconnect() after a debounce so the Verto WebSocket is re-opened
  // on the new interface. This prevents silent call drops on network handover.
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    attachNativeAutoReconnect(() => {
      console.log('[Verto] network/app-state change → reconnecting');
      reconnectRef.current();
    }).then((fn) => { cleanup = fn; }).catch(() => {});
    return () => { cleanup?.(); };
  }, []); // run once on mount

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
    transfer,
    transferCall: transfer,
    addCall: toggleSpeakerFn, // speaker toggle exposed via addCall slot for Android
    androidSipServiceStatus,
  }), [
    sipStatus, sipError, callState, callTimer, isMuted, isOnHold, activeCallNumber,
    call, hangup, answer, mute, unmute, hold, unhold, sendDTMF, setStatusPresence, reconnect,
    lastPersistedError, sipLog, clearSipLog, clearSipState, retryAttempt,
    audioProfile, setAudioProfile, transfer, toggleSpeakerFn, androidSipServiceStatus,
  ]);
}
