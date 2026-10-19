import { useEffect, useState, useCallback, useRef } from 'react';
import { sipProvider, SoftphoneSnapshot, SoftphoneConfig } from '@/lib/sip/jssipProvider';
import { ringtone } from '@/lib/sip/ringtonePlayer';
import { supabase, SB_URL, SB_KEY } from '@/lib/supabaseClient';
import { LEGACY_BACKEND_URL } from '@/lib/backendOrigin';
import { fetchLemtelProvisioning, lemtelProvisioningMessage, LemtelProvisioningError, toLemtelSipSettings } from '@/lib/lemtelSoftphoneProvisioning';

/** Lemtel self-hosted origin (cutover build): the portal is the only telephony authority. */
export const LEMTEL_PROVISIONED_ORIGIN = SB_URL !== LEGACY_BACKEND_URL;
import type { RecordingPolicy } from '../lib/lemtelTelephonyPolicy';

interface UseSoftphoneArgs {
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Phase 21B: when false, new telephony actions (call, retry, restart, auto-heal, credential re-init) are refused. Existing call controls stay available. */
  allowNewActions?: boolean;
  /** Phase 24B: validated portal recording policy. Only the exact 'user_allowed' grants manual recording. */
  recordingPolicy?: RecordingPolicy;
}

interface FetchedCreds {
  extension: string;
  display_name: string;
  sip_domain: string;
  wss_url: string;
  password: string;
  auth_username?: string;
  authUsername?: string;
  password_source?: string;
}

async function fetchSoftphoneCredentials(
  accessToken: string,
): Promise<FetchedCreds | null> {
  // Retry transient DB / network errors before giving up.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${SB_URL}/functions/v1/softphone-credentials`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SB_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platform: 'desktop' }),
      });
      if (res.status === 503 || res.status === 502 || res.status === 504) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        // Inspect body — backend may flag retryable transient errors.
        const data = await res.json().catch(() => null);
        if (data?.retryable) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      const data = await res.json();
      if (data.error) {
        if (data.retryable) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      return data as FetchedCreds;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

export type ManualStatus = 'auto' | 'available' | 'dnd' | 'away';

export function useSoftphone(args: UseSoftphoneArgs) {
  const [snap, setSnap] = useState<SoftphoneSnapshot>(() => sipProvider.getSnapshot());
  const [config, setConfig] = useState<SoftphoneConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [credError, setCredError] = useState<string | null>(null);
  const [manualStatus, setManualStatus] = useState<ManualStatus>('auto');
  const [retryTick, setRetryTick] = useState(0);
  const [recording, setRecording] = useState(false);
  const allowNewActions = args.allowNewActions !== false;
  const allowRef = useRef(allowNewActions);
  allowRef.current = allowNewActions;
  const recordingPolicy: RecordingPolicy =
    args.recordingPolicy === 'user_allowed' || args.recordingPolicy === 'portal_managed' ? args.recordingPolicy : 'not_allowed';
  const manualRecordingAllowed = recordingPolicy === 'user_allowed';
  const manualRecRef = useRef(manualRecordingAllowed);
  manualRecRef.current = manualRecordingAllowed;

  useEffect(() => {
    const unsub = sipProvider.subscribe(setSnap);
    return () => { unsub(); };
  }, []);

  // Restore Supabase session from stored tokens, then fetch SIP password.
  // GUARD: if extension is empty, this is a dummy/passthrough instance created by
  // SoftphonePane when the shared SipKeepAlive context is already managing SIP.
  // Skip init entirely to prevent a second sipProvider.init() that destroys the UA.
  useEffect(() => {
    if (!args.extension) {
      setLoading(false);
      return;
    }
    // Phase 21B: no credential re-init / re-registration while new actions are refused.
    if (!allowRef.current) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setCredError(null);
      try {
        if (args.accessToken) {
          await supabase.auth.setSession({
            access_token: args.accessToken,
            refresh_token: args.refreshToken || '',
          }).catch(() => { /* noop */ });
          if (cancelled || !allowRef.current) return;
        }
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled || !allowRef.current) return;
        const token = sess.session?.access_token || args.accessToken;
        if (!token) {
          setCredError('No session token. Re-sign-in.');
          return;
        }
        if (LEMTEL_PROVISIONED_ORIGIN) {
          // Same contract as Mobile: lemtel-softphone-provisioning (portal "Connexion FusionPBX").
          let provisioning;
          try {
            provisioning = await fetchLemtelProvisioning(SB_URL, SB_KEY, token, 'desktop');
          } catch (e) {
            if (cancelled || !allowRef.current) return;
            setCredError(lemtelProvisioningMessage(e instanceof LemtelProvisioningError ? e.code : 'provisioning_failed'));
            return;
          }
          if (cancelled || !allowRef.current) return;
          if (provisioning.status !== 'ready') { setCredError(lemtelProvisioningMessage(provisioning.status)); return; }
          const s = toLemtelSipSettings(provisioning);
          const cfg: SoftphoneConfig = {
            extension: s.extension, displayName: s.displayName, sipDomain: s.sipDomain, wssUrl: s.wssUrl, wssUrls: s.wssUrls,
            password: s.password, authUsername: s.authUsername, iceServers: s.iceServers, iceTransportPolicy: s.iceTransportPolicy,
            registerExpires: s.registerExpires, provisioned: true,
          };
          setConfig(cfg);
          await sipProvider.init(cfg);
          return;
        }
        const fetched = await fetchSoftphoneCredentials(token);
        // Phase 21B.1: re-check after the async credential fetch.
        if (cancelled || !allowRef.current) return;
        if (!fetched || !fetched.password) {
          setCredError(fetched ? 'No SIP password on file. Contact your admin.' : 'Failed to load SIP credentials.');
          return;
        }
        const cfg: SoftphoneConfig = {
          extension: fetched.extension || args.extension,
          displayName: fetched.display_name || args.displayName || args.extension,
          sipDomain: fetched.sip_domain || args.sipDomain || 'lemtel.lemtel.tel',
          wssUrl: fetched.wss_url || args.wssUrl || 'wss://node.lemtelcloud.net:7443',
          password: fetched.password,
          authUsername: fetched.auth_username || fetched.authUsername || fetched.extension || args.extension,
        };
        if (cancelled || !allowRef.current) return;
        setConfig(cfg);
        await sipProvider.init(cfg);
      } catch (e: any) {
        if (cancelled || !allowRef.current) return;
        setCredError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [args.accessToken, args.refreshToken, args.extension, retryTick]);

  // Ringtone + system notification on incoming.
  useEffect(() => {
    if (snap.callState === 'ringing-in') {
      ringtone.start();
      window.electronAPI?.showNotification?.(
        'Incoming call — Lemtel',
        snap.remoteIdentity || snap.remoteNumber || 'Unknown',
      );
    } else {
      ringtone.stop();
    }
  }, [snap.callState, snap.remoteIdentity, snap.remoteNumber]);

  // Tray status reflects SIP state (or manual override)
  useEffect(() => {
    const autoState =
      snap.callState === 'active' || snap.callState === 'held' ? 'oncall' :
      snap.status === 'registered' ? 'available' : 'offline';
    const trayState = manualStatus === 'auto' ? autoState : manualStatus;
    window.electronAPI?.updateTrayStatus?.(trayState);

    (async () => {
      // Legacy presence table only exists on the historical backend; Lemtel presence is server-side.
      if (LEMTEL_PROVISIONED_ORIGIN) return;
      try {
        await supabase
          .from('pbx_softphone_users')
          .update({ status: trayState, last_seen_at: new Date().toISOString() })
          .eq('extension', args.extension);
      } catch { /* noop */ }
    })();
  }, [snap.status, snap.callState, args.extension, manualStatus]);

  useEffect(() => {
    if (snap.callState !== 'active' && snap.callState !== 'held') setRecording(false);
  }, [snap.callState]);

  // Allow external UI (tray menu, profile menu) to change manual status
  useEffect(() => {
    const onSet = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === 'auto' || v === 'available' || v === 'dnd' || v === 'away') {
        setManualStatus(v as ManualStatus);
      }
    };
    window.addEventListener('lemtel:set-status', onSet as EventListener);
    return () => window.removeEventListener('lemtel:set-status', onSet as EventListener);
  }, []);

  // Last user-facing SIP problem (call blocked, registration lost, etc.)
  const [sipNotice, setSipNotice] = useState<string | null>(null);
  useEffect(() => {
    if (snap.status === 'registered') setSipNotice(null);
  }, [snap.status]);

  const sipAvailable = snap.status === 'registered';

  return {
    snap,
    config,
    loading,
    credError,
    sipAvailable,
    sipNotice,
    dismissSipNotice: useCallback(() => setSipNotice(null), []),
    sipUnavailableReason: sipProvider.unavailableReason(),
    call: useCallback(async (n: string) => {
      if (!allowRef.current) return 'Desktop access unavailable';
      const err = await sipProvider.call(n);
      if (err) setSipNotice(err);
      return err;
    }, []),
    answer: useCallback(() => sipProvider.answer(), []),
    hangup: useCallback(() => sipProvider.hangup(), []),
    mute: useCallback(() => sipProvider.mute(), []),
    unmute: useCallback(() => sipProvider.unmute(), []),
    hold: useCallback(() => sipProvider.hold(), []),
    unhold: useCallback(() => sipProvider.unhold(), []),
    sendDTMF: useCallback((k: string) => sipProvider.sendDTMF(k), []),
    blindTransfer: useCallback((t: string) => { if (!allowRef.current) return; sipProvider.blindTransfer(t); }, []),
    startAttendedConsult: useCallback((t: string) => { if (!allowRef.current) return; sipProvider.startAttendedConsult(t); }, []),
    completeAttendedTransfer: useCallback(() => { if (!allowRef.current) return; sipProvider.completeAttendedTransfer(); }, []),
    cancelAttendedConsult: useCallback(() => sipProvider.cancelAttendedConsult(), []),
    hasConsult: useCallback(() => sipProvider.hasConsult(), []),
    setAudioEl: useCallback((el: HTMLAudioElement | null) => { sipProvider.audioEl = el; }, []),
    setOutputDevice: useCallback((id: string | null) => { sipProvider.outputDeviceId = id; }, []),
    setInputDevice: useCallback((id: string | null) => { sipProvider.inputDeviceId = id; }, []),
    testAudioDevices: useCallback(() => sipProvider.testAudioDevices(), []),
    downloadDebugReport: useCallback(() => sipProvider.downloadDebugReport(), []),
    getBoundDevices: useCallback(() => ({
      input: sipProvider.boundInputLabel,
      output: sipProvider.boundOutputLabel,
    }), []),
    manualStatus,
    setManualStatus,
    recording,
    recordingPolicy,
    manualRecordingAllowed,
    toggleRecording: useCallback(async () => {
      if (!manualRecRef.current) return;
      const isRec = recording;
      setRecording(!isRec);
      // Always send DTMF *2 as primary signal to FusionPBX
      sipProvider.sendDTMF('*2');
      // Server-side fallback: invoke uuid_record via fusionpbx-proxy
      try {
        const callUuid = snap.callUuid || '';
        if (!callUuid) {
          console.warn('[Record] No callUuid in snap — DTMF only, no PBX fallback');
          return;
        }
        const { data, error } = await supabase.functions.invoke('fusionpbx-proxy', {
          body: { action: isRec ? 'stop-record' : 'start-record', uuid: callUuid },
        });
        if (error || !(data as any)?.ok) {
          console.warn('[Record] PBX fallback failed', error?.message || (data as any)?.error);
        } else {
          console.log('[Record] PBX', isRec ? 'stopped' : 'started', { recPath: (data as any)?.recPath });
        }
      } catch (e: any) {
        console.warn('[Record] fusionpbx-proxy error', e?.message || e);
      }
    }, [recording, snap.callUuid]),
    /** Fast, safe recovery: single-flight re-registration without a full teardown. */
    retryNow: useCallback(() => {
      if (!allowRef.current) return;
      setSipNotice(null);
      setCredError(null);
      const ok = sipProvider.retryNow();
      // No UA at all → we need fresh credentials + full init.
      if (!ok) setRetryTick((n) => n + 1);
    }, []),
    restart: useCallback(async () => {
      if (!allowRef.current) return;
      setCredError(null);
      setSipNotice(null);
      await sipProvider.restart();
      setRetryTick((n) => n + 1);
    }, []),
  };
}
