/**
 * useRealtimeRefresh — subscribe to Supabase Realtime INSERT/UPDATE events
 * on a public table, optionally filtered by `organization_id`, and call
 * `refresh()` (debounced) whenever a relevant change arrives.
 *
 * Used by Recents / Voicemail / SMS / Recordings list components so the
 * desktop app stays in sync with the portal without polling. Server-side
 * RLS is the source of truth for what the user is allowed to see; we only
 * trigger a refetch on broadcast events.
 */
import { useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

type Options = {
  table: string;
  organizationId?: string | null;
  /** Only react to these events. Defaults to INSERT + UPDATE. */
  events?: Array<'INSERT' | 'UPDATE' | 'DELETE'>;
  /** Debounce window (ms). Defaults to 5s to coalesce bursts without visible reload loops. */
  debounceMs?: number;
  /** Minimum time between refresh executions. Defaults to 10s to prevent sync feedback loops. */
  throttleMs?: number;
  shouldRefresh?: (payload: unknown) => boolean;
};

export function useRealtimeRefresh(opts: Options, refresh: () => void) {
  const { table, organizationId, events = ['INSERT', 'UPDATE'], debounceMs = 5_000, throttleMs = 10_000, shouldRefresh } = opts;
  const eventsKey = events.join(',');
  const refreshRef = useRef(refresh);
  const lastRefreshAtRef = useRef(0);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!organizationId) return; // wait until scope is known

    let pending: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        const now = Date.now();
        if (now - lastRefreshAtRef.current < throttleMs) return;
        lastRefreshAtRef.current = now;
        try { refreshRef.current(); } catch { /* noop */ }
      }, debounceMs);
    };

    const channel = supabase.channel(`rt-${table}-${organizationId}`);
    const activeEvents = eventsKey.split(',') as Array<'INSERT' | 'UPDATE' | 'DELETE'>;
    for (const ev of activeEvents) {
      channel.on(
        // @ts-ignore — supabase-js types for postgres_changes
        'postgres_changes',
        { event: ev, schema: 'public', table, filter: `organization_id=eq.${organizationId}` },
        (payload: unknown) => {
          if (!shouldRefresh || shouldRefresh(payload)) fire();
        },
      );
    }
    channel.subscribe();

    return () => {
      if (pending) clearTimeout(pending);
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [table, organizationId, debounceMs, throttleMs, shouldRefresh, eventsKey]);
}
