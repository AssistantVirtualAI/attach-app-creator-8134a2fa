/**
 * Subscribes to own-extension realtime feeds and fires native on-device
 * banner/lock-screen notifications for missed calls and voicemails —
 * independent of the in-app NotificationsSheet.
 *
 * Phase 28A — notifications are own_extension_only. Only two channels exist:
 * CDR (missed calls) and voicemails, both filtered exactly by the connected
 * extension. SMS and new-recording local notifications are suspended until a
 * server feed explicitly bound to the extension exists.
 */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/mobileSupabase';
import type { Creds } from '../lib/creds';
import { ensureNotificationPermission, initNotificationChannels, showLocalNotification } from '../lib/localNotifications';
import { navigateTo } from '../lib/appRouter';

export function useDeviceNotifications(creds: Creds | null) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!creds?.accessToken) return;
    const ext = String(creds.extension || '').trim();
    if (!ext) return;
    let cancelled = false;
    let cdrCh: any = null;
    let vmCh: any = null;
    let actionSub: any = null;

    (async () => {
      await initNotificationChannels();
      await ensureNotificationPermission();
      if (cancelled) return;

      try { supabase.realtime.setAuth(creds.accessToken!); } catch {}

      const cdrFilter = `extension=eq.${ext}`;
      cdrCh = supabase.channel(`notif-cdr-${ext}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pbx_call_records', filter: cdrFilter }, (payload: any) => {
          const r: any = payload?.new;
          if (String(r?.extension ?? '') !== ext) return;
          const direction = r?.direction === 'outbound' ? 'out' : 'in';
          if (direction !== 'in') return;
          // Voicemail notifications come only from pbx_voicemails (no duplicate).
          if (r?.voicemail_message) return;
          const billsec = Number(r?.billsec ?? r?.duration_seconds ?? 0);
          const missed = r?.missed_call || r?.hangup_cause === 'NO_ANSWER' || billsec === 0;
          if (!missed) return;
          const from = r?.caller_name || r?.caller_number || 'Unknown';
          showLocalNotification({
            kind: 'missed_call',
            title: `Missed call from ${from}`,
            body: r?.caller_number || '',
            dedupeKey: `missed-${r.id}`,
            extra: { callId: r.id, route: 'missed', number: r?.caller_number },
          });
        })
        .subscribe();

      const vmFilter = `extension=eq.${ext}`;
      vmCh = supabase.channel(`notif-vm-${ext}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pbx_voicemails', filter: vmFilter }, (payload: any) => {
          const r: any = payload?.new;
          if (String(r?.extension ?? '') !== String(ext)) return;
          const from = r?.caller_id_name || r?.caller_id_number || 'Unknown';
          showLocalNotification({
            kind: 'voicemail',
            title: `New voicemail from ${from}`,
            body: 'Tap to listen',
            dedupeKey: `vm-${r?.id}`,
            extra: { voicemailId: r?.id, route: 'voicemail' },
          });
        })
        .subscribe();

      // Native tap on a local notification → in-app deep link.
      try {
        const { LocalNotifications } = await import(/* @vite-ignore */ '@capacitor/local-notifications');
        const sub = await LocalNotifications.addListener('localNotificationActionPerformed', (a: any) => {
          const extra = a?.notification?.extra || {};
          const route = extra.route;
          if (route === 'voicemail') navigateTo({ tab: 'voicemail' });
          else if (route === 'recordings') navigateTo({ tab: 'calls', sub: 'recordings' });
          else if (route === 'missed') navigateTo({ tab: 'calls', sub: 'recents', filter: 'missed' });
          else if (route === 'chats' || route === 'sms') navigateTo({ tab: 'sms' });
          else if (route === 'calls') navigateTo({ tab: 'calls', sub: 'recents' });
        });
        if (cancelled) { try { sub?.remove?.(); } catch {} } else actionSub = sub;
      } catch {}
    })();

    return () => {
      cancelled = true;
      try { cdrCh && supabase.removeChannel(cdrCh); } catch {}
      try { vmCh && supabase.removeChannel(vmCh); } catch {}
      try { actionSub?.remove?.(); } catch {}
    };
  }, [creds?.accessToken, creds?.extension]);
}
