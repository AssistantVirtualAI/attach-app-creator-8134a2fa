import { useEffect, useState, useCallback } from 'react';
import { sipProvider, SoftphoneSnapshot, SoftphoneConfig } from '@/lib/sip/jssipProvider';
import { ringtone } from '@/lib/sip/ringtonePlayer';
import { supabase, SB_URL, SB_KEY } from '@/lib/supabaseClient';

interface UseSoftphoneArgs {
  extension: string;
  displayName?: string;
  sipDomain?: string;
  wssUrl?: string;
  accessToken?: string;
  refreshToken?: string;
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
  fallbackArgs?: { extension?: string; sipDomain?: string; wssUrl?: string },
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
        // Mobile parity: SIP password == account password. When the backend has
        // no separate SIP secret (HTTP 424 / NO_SIP_PASSWORD), fall back to the
        // account password captured at sign-in.
        if (res.status === 424 || data?.code === 'NO_SIP_PASSWORD') {
          const local = localStorage.getItem('lemtel.sip_password');
          if (local) {
            // 424 body does NOT include sip_domain/wss_url — use fallbackArgs from creds
            return {
              extension: data?.extension || fallbackArgs?.extension || '',
              display_name: data?.display_name || fallbackArgs?.extension || '',
              sip_domain: data?.sip_domain || fallbackArgs?.sipDomain || 'lemtel.lemtel.tel',
              wss_url: data?.wss_url || fallbackArgs?.wssUrl || 'wss://voice.ava-telecom.ca:9002',
              password: local,
              auth_username: data?.auth_username || fallbackArgs?.extension,
              password_source: 'local_account_password',
            } as FetchedCreds;
          }
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
  const [healedKey, setHealedKey] = useState<string>('');

  // Auto-heal: if PBX rejects registration (401/403/auth), force local password
  // into PBX once per (cause) so the saved password becomes the source of truth.
  useEffect(() => {
    if (snap.status !== 'error') return;
    const cause = snap.errorCause || '';
    if (!/401|403|forbidden|unauth|reject|auth/i.test(cause)) return;
    const key = `${args.extension}:${cause}`;
    if (healedKey === key) return;
    setHealedKey(key);
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token || args.accessToken;
        if (!token) return;
        const res = await fetch(`${SB_URL}/functions/v1/softphone-sync-password`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SB_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ force_local_to_pbx: true }),
        });
        if (!res.ok) return;
        // Re-fetch creds and re-init SIP with the now-aligned password.
        setRetryTick((n) => n + 1);
      } catch { /* noop */ }
    })();
  }, [snap.status, snap.errorCause, args.extension, args.accessToken, healedKey]);

  useEffect(() => {
    const unsub = sipProvider.subscribe(setSnap);
    return () => { unsub(); };
  }, []);

  // Restore Supabase session from stored tokens, then fetch SIP password.
  useEffect(() => {
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
        }
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token || args.accessToken;
        if (!token) {
          setCredError('No session token. Re-sign-in.');
          return;
        }
        const fetched = await fetchSoftphoneCredentials(token, {
          extension: args.extension,
          sipDomain: args.sipDomain,
          wssUrl: args.wssUrl,
        });
        if (cancelled) return;
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
        setConfig(cfg);
        await sipProvider.init(cfg);
      } catch (e: any) {
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
    blindTransfer: useCallback((t: string) => sipProvider.blindTransfer(t), []),
    startAttendedConsult: useCallback((t: string) => sipProvider.startAttendedConsult(t), []),
    completeAttendedTransfer: useCallback(() => sipProvider.completeAttendedTransfer(), []),
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
    toggleRecording: useCallback(() => {
      sipProvider.sendDTMF('*2');
      setRecording((r) => !r);
    }, []),
    /** Fast, safe recovery: single-flight re-registration without a full teardown. */
    retryNow: useCallback(() => {
      setSipNotice(null);
      setCredError(null);
      const ok = sipProvider.retryNow();
      // No UA at all → we need fresh credentials + full init.
      if (!ok) setRetryTick((n) => n + 1);
    }, []),
    restart: useCallback(async () => {
      setCredError(null);
      setSipNotice(null);
      await sipProvider.restart();
      setRetryTick((n) => n + 1);
    }, []),
  };
}

