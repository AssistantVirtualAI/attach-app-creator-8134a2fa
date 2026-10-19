import { useCallback, useEffect, useRef, useState } from 'react';
import { SB_KEY, SB_URL } from '../lib/supabaseClient';
import { LEGACY_BACKEND_URL } from '../lib/backendOrigin';
import { fetchLemtelProvisioning, LemtelProvisioningError, type LemtelProvisioningStatus } from '../lib/lemtelSoftphoneProvisioning';

export type DesktopProvisioningState =
  | { status: 'idle' | 'checking' }
  | { status: LemtelProvisioningStatus; extension: string | null }
  | { status: 'error'; code: string };

/**
 * Reads the portal's telephony decision for this user (lemtel-softphone-provisioning, same contract as Mobile).
 * Only on the Lemtel self-hosted origin and only after the session bootstrap accepted the member.
 * The password is NOT kept here: useSoftphone fetches it again right before the SIP stack starts.
 */
export function useLemtelDesktopProvisioning(sessionToken: string | null | undefined, enabled: boolean) {
  const [state, setState] = useState<DesktopProvisioningState>({ status: 'idle' });
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++seq.current;
    if (!enabled || !sessionToken || SB_URL === LEGACY_BACKEND_URL) { setState({ status: 'idle' }); return; }
    setState({ status: 'checking' });
    try {
      const p = await fetchLemtelProvisioning(SB_URL, SB_KEY, sessionToken, 'desktop');
      if (id !== seq.current) return;
      setState({ status: p.status, extension: p.telephony?.extension ?? null });
    } catch (e) {
      if (id !== seq.current) return;
      setState({ status: 'error', code: e instanceof LemtelProvisioningError ? e.code : 'provisioning_failed' });
    }
  }, [enabled, sessionToken]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, refresh };
}
