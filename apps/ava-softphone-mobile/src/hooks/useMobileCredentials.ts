import { useEffect, useState } from 'react';
import { Store, Creds, hydrateSoftphoneCredentials } from '../lib/creds';
import { supabase } from '../lib/mobileSupabase';

/**
 * Shared mobile credentials hook. Returns the SIP domain context every screen
 * needs (extension, domainUuid, sipDomain, organizationId, wssUrl, tokens).
 *
 * Reads stored creds first, then falls back to hydrating from the
 * `softphone-credentials` edge function if extension/domainUuid are missing.
 * Persists the hydrated value so subsequent calls are instant.
 */
export function useMobileCredentials() {
  const [creds, setCreds] = useState<Creds | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await Store.get();
      if (cancelled) return;
      
      // Always get fresh token from Supabase session
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const session = sessionData?.session;
      if (!session?.user?.id || !stored?.userId || session.user.id !== stored.userId) {
        setCreds(null); setLoading(false); return;
      }
      const freshToken = session.access_token;
      const freshRefresh = session.refresh_token;
      
      if (stored?.extension && (stored.domainUuid || stored.fusionpbxDomainUuid) && stored.organizationId) {
        setCreds({ ...stored, accessToken: freshToken, refreshToken: freshRefresh });
        setLoading(false);
        return;
      }
      const hydrated = await hydrateSoftphoneCredentials('mobile').catch(() => null);
      if (cancelled) return;
      const { data: current } = await supabase.auth.getSession();
      if (cancelled || current.session?.user?.id !== session.user.id) return;
      const result = hydrated || stored || null;
      setCreds(result && result.userId === session.user.id ? { ...result, accessToken: freshToken, refreshToken: freshRefresh } : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    creds,
    loading,
    extension: creds?.extension || null,
    sipDomain: creds?.sipDomain || null,
    domainUuid: (creds?.domainUuid || creds?.fusionpbxDomainUuid) ?? null,
    fusionpbxDomainUuid: creds?.fusionpbxDomainUuid || creds?.domainUuid || null,
    organizationId: creds?.organizationId || null,
    wssUrl: creds?.wssUrl || null,
    userId: creds?.userId || null,
    accessToken: creds?.accessToken || null,
  };
}
