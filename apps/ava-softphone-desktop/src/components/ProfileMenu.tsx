import React, { useEffect, useRef, useState } from 'react';
import { theme } from '../lib/theme';
import { supabase } from '../lib/supabaseClient';
import { setAuthToken } from '../lib/avaApi';
import { useCallBus } from '../hooks/useCallBus';


const { colors: c } = theme;

type Status =
  | 'available'
  | 'busy'
  | 'meeting'
  | 'dnd'
  | 'lunch'
  | 'break'
  | 'training'
  | 'travel'
  | 'vacation'
  | 'sick'
  | 'remote'
  | 'away';

const STATUS_META: Record<Status, { label: string; icon: string; color: string; manual: 'available' | 'dnd' | 'away' }> = {
  available: { label: 'Available',         icon: '🟢', color: '#22c55e', manual: 'available' },
  busy:      { label: 'Busy',              icon: '🔴', color: '#ef4444', manual: 'dnd' },
  meeting:   { label: 'In a meeting',      icon: '📅', color: '#f59e0b', manual: 'dnd' },
  dnd:       { label: 'Do not disturb',    icon: '⛔', color: '#dc2626', manual: 'dnd' },
  lunch:     { label: 'Lunch break',       icon: '🍽️', color: '#fb923c', manual: 'away' },
  break:     { label: 'On a break',        icon: '☕', color: '#a78bfa', manual: 'away' },
  training:  { label: 'Training',          icon: '🎓', color: '#38bdf8', manual: 'dnd' },
  travel:    { label: 'On travel',         icon: '✈️', color: '#06b6d4', manual: 'away' },
  vacation:  { label: 'On vacation',       icon: '🏖️', color: '#0ea5e9', manual: 'away' },
  sick:      { label: 'Sick leave',        icon: '🤒', color: '#f43f5e', manual: 'away' },
  remote:    { label: 'Working remotely',  icon: '🏠', color: '#8b5cf6', manual: 'available' },
  away:      { label: 'Not available',     icon: '⚪', color: '#94a3b8', manual: 'away' },
};

const AVATAR_KEY = 'lemtel:user-avatar';
const STATUS_KEY = 'lemtel:user-status';
const EXPIRY_KEY = 'lemtel:user-status-expiry';
const MEETING_NOTE_KEY = 'lemtel:meeting-note';

// Statuses that auto-revert to "available" after a chosen duration.
const TEMP_STATUSES: Status[] = ['busy', 'meeting', 'dnd', 'lunch', 'break', 'training', 'sick', 'remote'];
const LONG_STATUSES: Status[] = ['travel', 'vacation'];
const DURATION_PRESETS: Array<{ label: string; mins: number }> = [
  { label: '15 min', mins: 15 },
  { label: '30 min', mins: 30 },
  { label: '1 h',    mins: 60 },
  { label: '2 h',    mins: 120 },
  { label: '4 h',    mins: 240 },
  { label: 'End of day', mins: -1 },
];
const LONG_PRESETS: Array<{ label: string; mins: number }> = [
  { label: 'Today',   mins: -1 },
  { label: '1 day',   mins: 60 * 24 },
  { label: '3 days',  mins: 60 * 24 * 3 },
  { label: '1 week',  mins: 60 * 24 * 7 },
  { label: '2 weeks', mins: 60 * 24 * 14 },
];

function computeExpiry(mins: number): number {
  if (mins === -1) {
    const d = new Date();
    d.setHours(18, 0, 0, 0); // end of day = 18:00 local
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return Date.now() + mins * 60_000;
}

export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(() => {
    const s = localStorage.getItem(STATUS_KEY) as Status;
    return s && STATUS_META[s] ? s : 'available';
  });
  const [avatar, setAvatar] = useState<string | null>(() => localStorage.getItem(AVATAR_KEY));
  const [email, setEmail] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [meetingNote, setMeetingNote] = useState<string>(() => localStorage.getItem(MEETING_NOTE_KEY) || '');
  const [lockMsg, setLockMsg] = useState<string>('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [expiryAt, setExpiryAt] = useState<number | null>(() => {
    const raw = localStorage.getItem(EXPIRY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > Date.now() ? n : null;
  });
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null);
  const { call } = useCallBus();
  const inCall = !!call && call.status !== 'ended' && call.status !== 'idle';
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const meetingInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<Status>(status);
  const openRef = useRef<boolean>(open);
  const inCallRef = useRef<boolean>(inCall);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  statusRef.current = status;
  openRef.current = open;
  inCallRef.current = inCall;


  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      if (!u) return;
      setEmail(u.email || '');
      setName((u.user_metadata as any)?.full_name || (u.user_metadata as any)?.name || (u.email?.split('@')[0] || ''));
      const remoteAvatar = (u.user_metadata as any)?.avatar_url;
      if (remoteAvatar && !localStorage.getItem(AVATAR_KEY)) setAvatar(remoteAvatar);
    });
  }, []);

  // On mount: load presence from backend (cross-device source of truth) and push SIP state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      const localSaved = (localStorage.getItem(STATUS_KEY) as Status) || 'available';
      let saved: Status = STATUS_META[localSaved] ? localSaved : 'available';
      if (uid) {
        const { data: pres } = await supabase
          .from('user_presence')
          .select('status')
          .eq('user_id', uid)
          .maybeSingle();
        const remote = pres?.status as Status | undefined;
        if (remote && STATUS_META[remote]) {
          saved = remote;
          if (!cancelled) {
            setStatus(remote);
            try { localStorage.setItem(STATUS_KEY, remote); } catch { /* noop */ }
          }
        }
      }
      const m = STATUS_META[saved] || STATUS_META.available;
      const dispatch = () => window.dispatchEvent(
        new CustomEvent('lemtel:set-status', { detail: m.manual })
      );
      dispatch();
      setTimeout(dispatch, 1500);
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: sync status changes from other devices (mobile / web).
  useEffect(() => {
    let channel: any;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      channel = supabase
        .channel(`user-presence-${uid}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_presence', filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const next = (payload.new?.status || payload.old?.status) as Status | undefined;
            if (!next || !STATUS_META[next]) return;
            // Conflict detection: a remote write arrives <5s after our last local write with a DIFFERENT status.
            const localW = lastLocalWriteRef.current;
            const isNearSimultaneous = !!localW && (Date.now() - localW.at) < 5000;
            const conflict = isNearSimultaneous && localW!.status !== next;
            if (next === statusRef.current && !conflict) return;
            if (conflict) {
              // Remote wins (server is the source of truth). Surface to user via badge.
              const remoteLabel = STATUS_META[next].label;
              setSyncState('conflict');
              setSyncDetail(`Another device set "${remoteLabel}" — keeping the latest.`);
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSyncState('idle'), 4000);
            } else {
              // Plain remote update from another device — just confirm sync.
              flashSaved('Synced from another device');
            }
            if (expiryTimerRef.current) { clearTimeout(expiryTimerRef.current); expiryTimerRef.current = null; }
            setExpiryAt(null);
            setPendingStatus(null);
            try { localStorage.removeItem(EXPIRY_KEY); } catch { /* noop */ }
            const msg = payload.new?.status_message as string | undefined;
            if (msg && msg.startsWith('until:')) {
              const ts = Date.parse(msg.slice(6));
              if (Number.isFinite(ts) && ts > Date.now()) {
                setExpiryAt(ts);
                try { localStorage.setItem(EXPIRY_KEY, String(ts)); } catch { /* noop */ }
                scheduleAutoRevert(ts);
              }
            }
            // Adopt remote write as our new local baseline so we don't immediately re-flag it.
            lastLocalWriteRef.current = { at: Date.now(), status: next, note: msg ?? null };
            setStatus(next);
            try { localStorage.setItem(STATUS_KEY, next); } catch { /* noop */ }
            window.dispatchEvent(new CustomEvent('lemtel:set-status', { detail: STATUS_META[next].manual }));
          }
        )
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // Listen to global shortcuts / tray status changes from the main process
  useEffect(() => {
    const cb = (s: any) => {
      if (STATUS_META[s as Status]) {
        applyStatus(s as Status);
      }
    };
    window.electronAPI?.onSetUiStatus?.(cb);
  }, []);

  // Global shortcut: focus / toggle meeting note field
  useEffect(() => {
    const cb = () => {
      if (statusRef.current !== 'meeting') {
        applyStatus('meeting');
      }
      setTimeout(() => {
        if (openRef.current && meetingInputRef.current === document.activeElement) {
          setOpen(false);
        } else {
          setOpen(true);
          meetingInputRef.current?.focus();
          meetingInputRef.current?.select();
        }
      }, 10);
    };
    window.electronAPI?.onFocusMeetingNote?.(cb);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const meta = STATUS_META[status];
  const initials = (name || email || '?').slice(0, 2).toUpperCase();

  // ---- Sync indicator & conflict handling ----
  type SyncState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline';
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncDetail, setSyncDetail] = useState<string>('');
  const lastLocalWriteRef = useRef<{ at: number; status: Status; note?: string | null } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = (label = 'Synced') => {
    setSyncState('saved'); setSyncDetail(label);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSyncState('idle'), 2500);
  };

  // Online/offline indicator (and retry pending writes)
  useEffect(() => {
    const on = () => { if (syncState === 'offline') setSyncState('idle'); };
    const off = () => { setSyncState('offline'); setSyncDetail('Offline — changes will sync when back online'); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (!navigator.onLine) off();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [syncState]);

  const withSync = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setSyncState('saving'); setSyncDetail(label);
    try {
      const out = await fn();
      flashSaved(label);
      return out;
    } catch (e: any) {
      setSyncState('error');
      setSyncDetail(e?.message?.slice(0, 80) || 'Sync failed — will retry');
      return undefined;
    }
  };

  const persistPresence = async (s: Status, note?: string, untilTs?: number | null) => {
    const m = STATUS_META[s];
    const noteVal = s === 'meeting'
      ? (note ?? meetingNote ?? null)
      : (untilTs ? `until:${new Date(untilTs).toISOString()}` : null);
    lastLocalWriteRef.current = { at: Date.now(), status: s, note: noteVal };
    await withSync('Status', async () => {
      const { error } = await supabase.rpc('upsert_user_presence', {
        _status: s,
        _message: noteVal,
        _emoji: m.icon,
        _call_state: 'idle',
        _platform: 'desktop',
      });
      if (error) throw error;
    });
  };


  const clearExpiryTimer = () => {
    if (expiryTimerRef.current) { clearTimeout(expiryTimerRef.current); expiryTimerRef.current = null; }
  };

  const scheduleAutoRevert = (ts: number) => {
    clearExpiryTimer();
    const delay = Math.max(0, ts - Date.now());
    // setTimeout caps at ~24.8d; clamp and re-arm if needed.
    const armed = Math.min(delay, 2_000_000_000);
    expiryTimerRef.current = setTimeout(() => {
      if (Date.now() >= ts) {
        applyStatus('available');
      } else {
        scheduleAutoRevert(ts);
      }
    }, armed);
  };

  const applyStatus = (s: Status, durationMins?: number) => {
    if (inCallRef.current) {
      const msg = "Vous êtes en appel — votre statut est verrouillé jusqu'à la fin de l'appel.";
      setLockMsg(msg);
      setOpen(true);
      try { window.electronAPI?.showNotification?.('Statut verrouillé', msg, { tag: 'lemtel-status-lock' }); } catch { /* noop */ }
      setTimeout(() => setLockMsg(''), 4000);
      return;
    }
    // New status overrides any previous one — always clear pending picker + timer first.
    setPendingStatus(null);
    clearExpiryTimer();

    const until = typeof durationMins === 'number' ? computeExpiry(durationMins) : null;
    setStatus(s);
    localStorage.setItem(STATUS_KEY, s);
    if (until) {
      setExpiryAt(until);
      try { localStorage.setItem(EXPIRY_KEY, String(until)); } catch { /* noop */ }
      scheduleAutoRevert(until);
    } else {
      setExpiryAt(null);
      try { localStorage.removeItem(EXPIRY_KEY); } catch { /* noop */ }
    }
    window.dispatchEvent(new CustomEvent('lemtel:set-status', { detail: STATUS_META[s].manual }));
    void persistPresence(s, undefined, until);
    if (s !== 'meeting') setOpen(false);
  };

  // Pick a status: if it's a temp/long status, show duration picker first.
  const pickStatus = (s: Status) => {
    if (inCallRef.current) { applyStatus(s); return; }
    if (s === status) { setPendingStatus(null); return; }
    if (TEMP_STATUSES.includes(s) || LONG_STATUSES.includes(s)) {
      setPendingStatus(s);
      return;
    }
    applyStatus(s);
  };

  // On mount: if a saved expiry has already passed, revert immediately; otherwise re-arm timer.
  useEffect(() => {
    if (expiryAt && expiryAt <= Date.now()) {
      applyStatus('available');
    } else if (expiryAt) {
      scheduleAutoRevert(expiryAt);
    }
    return () => clearExpiryTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const saveMeetingNote = (v: string) => {
    setMeetingNote(v);
    try { localStorage.setItem(MEETING_NOTE_KEY, v); } catch { /* noop */ }
    void persistPresence(statusRef.current, v);
  };


  const openSettings = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('lemtel:nav', { detail: 'settings' }));
  };

  const signOut = async () => {
    setOpen(false);
    try { setAuthToken(null); } catch { /* noop */ }
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    try {
      window.localStorage.removeItem('lemtel-desktop-auth');
      window.sessionStorage.removeItem('lemtel-desktop-auth');
    } catch { /* noop */ }
    await (window as any).electronAPI?.clearCredentials?.();
    window.location.reload();
  };

  const onPickPhoto = () => fileRef.current?.click();

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { alert('Image must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const url = String(reader.result || '');
      setAvatar(url);
      try { localStorage.setItem(AVATAR_KEY, url); } catch { /* noop */ }
      await withSync('Avatar', async () => {
        const { error } = await supabase.auth.updateUser({ data: { avatar_url: url } });
        if (error) throw error;
      });
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = async () => {
    setAvatar(null);
    try { localStorage.removeItem(AVATAR_KEY); } catch { /* noop */ }
    await withSync('Avatar', async () => {
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } });
      if (error) throw error;
    });
  };


  return (
    <div ref={rootRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' as any }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`${name || email} · ${meta.label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '3px 10px 3px 3px', borderRadius: 999,
          background: 'rgba(8,16,38,0.6)',
          border: `1px solid ${c.border}`,
          color: '#d8e6ff', cursor: 'pointer',
        }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); onPickPhoto(); }}
          title="Change photo"
          style={{
            position: 'relative', width: 26, height: 26, borderRadius: '50%',
            overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #0023e6, #7a4cff)',
            color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: 0.5, cursor: 'pointer',
          }}
        >
          {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
          <span style={{
            position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%',
            background: meta.color, border: '2px solid #ffffff',
          }} />
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); setProfileOpen(true); setOpen(false); }}
          title="Edit profile"
          style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        >
          {status === 'meeting' && meetingNote ? `Meeting · ${meetingNote}` : `${meta.icon} ${meta.label}`}
        </span>
        <SyncBadge state={syncState} detail={syncDetail} />
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 38, right: 0, width: 280,
          background: 'var(--ava-surface-elev, rgba(18,26,54,0.98))',
          border: `1px solid ${c.border}`, borderRadius: 12,
          boxShadow: '0 18px 48px -16px rgba(0,0,0,0.7)',
          padding: 10, zIndex: 200, backdropFilter: 'blur(14px)',
          maxHeight: '78vh', overflowY: 'auto',
        }}>
          {/* Profile header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 10px', borderBottom: `1px solid ${c.border}` }}>
            <button onClick={onPickPhoto} title="Change photo" style={{
              position: 'relative', width: 44, height: 44, borderRadius: '50%', overflow: 'hidden',
              border: `1px solid ${c.border}`, padding: 0, cursor: 'pointer',
              background: 'linear-gradient(135deg, #0023e6, #7a4cff)',
              color: '#fff', fontSize: 14, fontWeight: 800,
            }}>
              {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button onClick={() => { setProfileOpen(true); setOpen(false); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                <div style={{ fontSize: 12, color: c.textIce, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Account'}</div>
                <div style={{ fontSize: 10, color: c.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
              </button>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <button onClick={onPickPhoto} style={miniBtn}>Change photo</button>
                {avatar && <button onClick={removePhoto} style={miniBtn}>Remove</button>}
                <button onClick={() => { setProfileOpen(true); setOpen(false); }} style={miniBtn}>Edit profile</button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPhotoChange} style={{ display: 'none' }} />
          </div>

          {/* Status */}
          <div style={{ padding: '8px 4px 4px', fontSize: 9, fontWeight: 800, color: c.textSub, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Set status
          </div>
          {inCall && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              margin: '4px 2px 6px', padding: '7px 9px', borderRadius: 8,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#ff6b6b', fontSize: 10.5, lineHeight: 1.35,
            }}>
              <span aria-hidden style={{ fontSize: 13 }}>🔒</span>
              <span>Statut verrouillé pendant un appel actif. Terminez l'appel pour le modifier.</span>
            </div>
          )}
          {lockMsg && !inCall && (
            <div style={{
              margin: '4px 2px 6px', padding: '7px 9px', borderRadius: 8,
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
              color: '#fbbf24', fontSize: 10.5,
            }}>{lockMsg}</div>
          )}
          {(Object.keys(STATUS_META) as Status[]).map((s) => {
            const m = STATUS_META[s];
            const active = s === status;
            const isPending = pendingStatus === s;
            const presets = LONG_STATUSES.includes(s) ? LONG_PRESETS : DURATION_PRESETS;
            const needsDuration = TEMP_STATUSES.includes(s) || LONG_STATUSES.includes(s);
            return (
              <div key={s}>
                <button
                  onClick={() => pickStatus(s)}
                  disabled={inCall}
                  title={inCall ? "Indisponible pendant un appel actif" : ''}
                  style={{ ...menuItem(active), opacity: inCall ? 0.5 : 1, cursor: inCall ? 'not-allowed' : 'pointer' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
                  <span aria-hidden style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{m.icon}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{m.label}</span>
                  {active && expiryAt && (
                    <span style={{ fontSize: 9.5, color: c.textSub }}>
                      until {new Date(expiryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {active && <span style={{ fontSize: 11, color: m.color, marginLeft: 4 }}>✓</span>}
                </button>
                {isPending && needsDuration && (
                  <div style={{
                    margin: '2px 4px 8px', padding: '8px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', border: `1px dashed ${c.border}`,
                  }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: c.textSub, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
                      How long?
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {presets.map((p) => (
                        <button key={p.label} onClick={() => applyStatus(s, p.mins)} style={miniBtn}>
                          {p.label}
                        </button>
                      ))}
                      <button onClick={() => applyStatus(s)} style={miniBtn}>Until I change it</button>
                      <button onClick={() => setPendingStatus(null)} style={{ ...miniBtn, opacity: 0.7 }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}


          {status === 'meeting' && (
            <div style={{ padding: '8px 6px 4px' }}>
              <input
                ref={meetingInputRef}
                type="text"
                value={meetingNote}
                onChange={(e) => saveMeetingNote(e.target.value)}
                placeholder="Meeting note (e.g. Standup until 3pm)"
                maxLength={80}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.06)', color: c.textIce,
                  border: `1px solid ${c.border}`, borderRadius: 8,
                  padding: '7px 9px', fontSize: 11, outline: 'none',
                }}
              />
            </div>
          )}

          <div style={{ height: 1, background: c.border, margin: '8px 0' }} />


          <button onClick={() => { setProfileOpen(true); setOpen(false); }} style={menuItem(false)}>
            <span aria-hidden>👤</span>
            <span style={{ flex: 1, textAlign: 'left' }}>Manage profile</span>
          </button>
          <button onClick={openSettings} style={menuItem(false)}>
            <span aria-hidden>⚙</span>
            <span style={{ flex: 1, textAlign: 'left' }}>Settings</span>
          </button>
          <button onClick={signOut} style={{ ...menuItem(false), color: '#ef4444' }}>
            <span aria-hidden>⎋</span>
            <span style={{ flex: 1, textAlign: 'left' }}>Sign out</span>
          </button>
        </div>
      )}

      {profileOpen && (
        <ProfileEditor
          name={name}
          email={email}
          avatar={avatar}
          onClose={() => setProfileOpen(false)}
          onSaved={(newName, newAvatar) => { setName(newName); if (newAvatar !== undefined) setAvatar(newAvatar); flashSaved('Profile'); }}
          onSyncError={(label, err) => { setSyncState('error'); setSyncDetail(`${label}: ${err?.slice(0, 60) || 'failed'}`); }}
          onSyncStart={(label) => { setSyncState('saving'); setSyncDetail(label); }}
          onPickPhoto={onPickPhoto}
          onRemovePhoto={removePhoto}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  name: initialName, email, avatar, onClose, onSaved, onPickPhoto, onRemovePhoto,
  onSyncStart, onSyncError,
}: {
  name: string; email: string; avatar: string | null;
  onClose: () => void;
  onSaved: (name: string, avatar?: string | null) => void;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onSyncStart?: (label: string) => void;
  onSyncError?: (label: string, err: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Password flow state
  type PwStep = 'form' | 'confirm' | 'success';
  const [pwStep, setPwStep] = useState<PwStep>('form');
  const [currentPw, setCurrentPw] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; pw1?: string; pw2?: string }>({});

  // Email reset flow state
  type EmStep = 'idle' | 'confirm' | 'sent';
  const [emStep, setEmStep] = useState<EmStep>('idle');
  const [emError, setEmError] = useState<string | null>(null);

  const initials = (initialName || email || '?').slice(0, 2).toUpperCase();

  const save = async () => {
    setSaving(true); setMsg(null); onSyncStart?.('Profile');
    try {
      const { error } = await supabase.auth.updateUser({ data: { full_name: name, name } });
      if (error) throw error;
      onSaved(name);
      setMsg({ kind: 'ok', text: 'Profile updated.' });
    } catch (e: any) {
      const text = e?.message || 'Failed to update profile.';
      setMsg({ kind: 'err', text });
      onSyncError?.('Profile', text);
    } finally { setSaving(false); }
  };


  // ---- Password strength (0-4) ----
  const strength = (() => {
    let s = 0;
    if (pw1.length >= 8) s++;
    if (pw1.length >= 12) s++;
    if (/[A-Z]/.test(pw1) && /[a-z]/.test(pw1)) s++;
    if (/\d/.test(pw1) && /[^A-Za-z0-9]/.test(pw1)) s++;
    return s;
  })();
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong'][strength];
  const strengthColor = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'][strength];

  const validatePwForm = (): boolean => {
    const fe: typeof fieldErrors = {};
    if (!currentPw) fe.current = 'Enter your current password.';
    if (pw1.length < 8) fe.pw1 = 'At least 8 characters required.';
    else if (!/[A-Za-z]/.test(pw1) || !/\d/.test(pw1)) fe.pw1 = 'Use letters and at least one number.';
    else if (pw1 === currentPw) fe.pw1 = 'New password must differ from current.';
    if (pw2 !== pw1) fe.pw2 = 'Passwords do not match.';
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const mapAuthError = (e: any): string => {
    const m = (e?.message || '').toLowerCase();
    if (m.includes('invalid login') || m.includes('invalid credentials')) return 'Current password is incorrect.';
    if (m.includes('same') && m.includes('password')) return 'New password must differ from your current one.';
    if (m.includes('weak') || m.includes('pwned') || m.includes('compromised')) return 'This password has been found in a breach. Choose a different one.';
    if (m.includes('rate') || m.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
    if (m.includes('network') || m.includes('fetch')) return 'Network error. Check your connection and retry.';
    if (m.includes('session') || m.includes('jwt')) return 'Your session expired. Please sign in again.';
    return e?.message || 'Something went wrong. Please try again.';
  };

  const goToConfirm = () => {
    setPwError(null);
    if (!validatePwForm()) return;
    setPwStep('confirm');
  };

  const confirmPasswordChange = async () => {
    setSaving(true); setPwError(null);
    try {
      // 1. Re-auth with current password
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: currentPw });
      if (signErr) throw signErr;
      // 2. Apply new password
      const { error: updErr } = await supabase.auth.updateUser({ password: pw1 });
      if (updErr) throw updErr;
      setPwStep('success');
      setCurrentPw(''); setPw1(''); setPw2('');
    } catch (e: any) {
      setPwError(mapAuthError(e));
      setPwStep('form');
    } finally { setSaving(false); }
  };

  const resetPwFlow = () => {
    setPwStep('form'); setPwError(null); setFieldErrors({});
    setCurrentPw(''); setPw1(''); setPw2('');
  };

  const requestEmailReset = () => { setEmError(null); setEmStep('confirm'); };

  const confirmEmailReset = async () => {
    if (!email) { setEmError('No email on file.'); return; }
    setSaving(true); setEmError(null);
    try {
      // Reset links must open in a public browser, not the Electron app shell.
      const origin = window.location.origin;
      const isPublic = /^https?:\/\//i.test(origin) && !origin.includes('localhost') && !origin.startsWith('file:');
      const redirectTo = isPublic ? `${origin}/reset-password` : 'https://avastatistic.ca/reset-password';
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setEmStep('sent');
    } catch (e: any) {
      setEmError(mapAuthError(e));
      setEmStep('idle');
    } finally { setSaving(false); }
  };


  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 92vw)', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--ava-surface-elev, rgba(18,26,54,0.98))', border: `1px solid ${c.border}`, borderRadius: 14,
          boxShadow: '0 24px 60px -12px rgba(0,0,0,0.55)', padding: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: c.textIce }}>Manage profile</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: c.textDim }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <button onClick={onPickPhoto} style={{
            width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: `1px solid ${c.border}`,
            padding: 0, cursor: 'pointer', background: 'linear-gradient(135deg, #0023e6, #7a4cff)',
            color: '#fff', fontSize: 20, fontWeight: 800,
          }}>
            {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={onPickPhoto} style={primaryBtn}>Upload new photo</button>
            {avatar && <button onClick={onRemovePhoto} style={ghostBtn}>Remove photo</button>}
          </div>
        </div>

        <label style={lbl}>Full name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} />

        <label style={lbl}>Email</label>
        <input value={email} readOnly style={{ ...input, opacity: 0.7 }} />

        <button onClick={save} disabled={saving} style={{ ...primaryBtn, width: '100%', marginTop: 10 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>

        {msg && (
          <div style={{
            marginTop: 12, padding: '8px 10px', borderRadius: 8, fontSize: 11.5,
            background: msg.kind === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${msg.kind === 'ok' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: msg.kind === 'ok' ? '#22d39a' : '#ff6b6b',
          }}>{msg.text}</div>
        )}

        <div style={{ height: 1, background: c.border, margin: '18px 0' }} />

        <div style={{ fontSize: 11, fontWeight: 800, color: c.textSub, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          Password & Security
        </div>

        {/* ===== Password change flow ===== */}
        {pwStep === 'form' && (
          <div>
            <label style={lbl}>Current password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showCurrent ? 'text' : 'password'}
                value={currentPw}
                onChange={(e) => { setCurrentPw(e.target.value); setFieldErrors((f) => ({ ...f, current: undefined })); }}
                placeholder="Enter your current password"
                style={{ ...input, paddingRight: 56, borderColor: fieldErrors.current ? '#ef4444' : (input.borderColor as any) }}
              />
              <button type="button" onClick={() => setShowCurrent((v) => !v)} style={eyeBtn}>{showCurrent ? 'Hide' : 'Show'}</button>
            </div>
            {fieldErrors.current && <div style={fieldErr}>{fieldErrors.current}</div>}

            <label style={lbl}>New password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={pw1}
                onChange={(e) => { setPw1(e.target.value); setFieldErrors((f) => ({ ...f, pw1: undefined })); }}
                placeholder="At least 8 characters, with a number"
                style={{ ...input, paddingRight: 56, borderColor: fieldErrors.pw1 ? '#ef4444' : (input.borderColor as any) }}
              />
              <button type="button" onClick={() => setShowNew((v) => !v)} style={eyeBtn}>{showNew ? 'Hide' : 'Show'}</button>
            </div>
            {pw1 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{
                      flex: 1, height: 4, borderRadius: 2,
                      background: i < strength ? strengthColor : '#e2e8f0',
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 10, color: strengthColor, fontWeight: 700, marginTop: 4 }}>{strengthLabel}</div>
              </div>
            )}
            {fieldErrors.pw1 && <div style={fieldErr}>{fieldErrors.pw1}</div>}

            <label style={lbl}>Confirm new password</label>
            <input
              type={showNew ? 'text' : 'password'}
              value={pw2}
              onChange={(e) => { setPw2(e.target.value); setFieldErrors((f) => ({ ...f, pw2: undefined })); }}
              placeholder="Re-enter new password"
              style={{ ...input, borderColor: fieldErrors.pw2 ? '#ef4444' : (input.borderColor as any) }}
            />
            {fieldErrors.pw2 && <div style={fieldErr}>{fieldErrors.pw2}</div>}

            {pwError && (
              <div style={errBox}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Couldn't update password</strong>
                {pwError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={goToConfirm} disabled={saving} style={{ ...primaryBtn, flex: 1 }}>Continue</button>
              <button onClick={requestEmailReset} disabled={saving} style={{ ...ghostBtn, flex: 1 }}>Forgot? Email link</button>
            </div>
          </div>
        )}

        {pwStep === 'confirm' && (
          <div>
            <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#78350f', marginBottom: 4 }}>⚠ Confirm password change</div>
              <div style={{ fontSize: 11.5, color: '#78350f', lineHeight: 1.45 }}>
                You're about to change the password for <strong>{email}</strong>. You'll stay signed in on this device, but other sessions may be revoked. This action cannot be undone.
              </div>
            </div>
            {pwError && <div style={errBox}>{pwError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPwStep('form')} disabled={saving} style={{ ...ghostBtn, flex: 1 }}>Back</button>
              <button onClick={confirmPasswordChange} disabled={saving} style={{ ...primaryBtn, flex: 1 }}>
                {saving ? 'Updating…' : 'Yes, change password'}
              </button>
            </div>
          </div>
        )}

        {pwStep === 'success' && (
          <div style={{ textAlign: 'center', padding: '8px 4px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', margin: '0 auto 12px',
              background: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, color: '#16a34a',
            }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: c.textIce, marginBottom: 4 }}>Password updated</div>
            <div style={{ fontSize: 11.5, color: c.textDim, marginBottom: 14, lineHeight: 1.5 }}>

              Your password has been changed successfully. Use it next time you sign in.
            </div>
            <button onClick={resetPwFlow} style={{ ...primaryBtn, width: '100%' }}>Done</button>
          </div>
        )}

        {/* ===== Email reset confirmation ===== */}
        {emStep === 'confirm' && (
          <div style={{ marginTop: 14, padding: 12, background: '#f1f5f9', border: `1px solid ${c.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>Send reset link?</div>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 10, lineHeight: 1.45 }}>
              We'll email a one-time reset link to <strong>{email}</strong>. It expires in 1 hour.
            </div>
            {emError && <div style={{ ...errBox, marginTop: 0, marginBottom: 8 }}>{emError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEmStep('idle')} disabled={saving} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
              <button onClick={confirmEmailReset} disabled={saving} style={{ ...primaryBtn, flex: 1 }}>
                {saving ? 'Sending…' : 'Send link'}
              </button>
            </div>
          </div>
        )}

        {emStep === 'sent' && (
          <div style={{ marginTop: 14, padding: 12, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#15803d', marginBottom: 4 }}>✉ Check your inbox</div>
            <div style={{ fontSize: 11, color: '#166534', lineHeight: 1.45, marginBottom: 8 }}>
              A reset link was sent to <strong>{email}</strong>. If you don't see it within a minute, check your spam folder.
            </div>
            <button onClick={() => setEmStep('idle')} style={{ ...ghostBtn, width: '100%' }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  fontSize: 9, padding: '3px 7px', borderRadius: 6,
  background: 'rgba(255,255,255,0.08)', border: `1px solid ${c.border}`,
  color: c.textIce, cursor: 'pointer', letterSpacing: 0.4,
};

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, color: c.textDim,
  textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10, marginBottom: 4,
};

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)', color: c.textIce,
  border: `1px solid ${c.border}`, borderRadius: 8,
  padding: '9px 11px', fontSize: 12, outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg, #0023e6, #4d82ff)',
  color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8,
  background: 'transparent', border: `1px solid ${c.border}`,
  color: c.textIce, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
};

const eyeBtn: React.CSSProperties = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  fontSize: 10, padding: '4px 8px', borderRadius: 6,
  background: 'rgba(255,255,255,0.08)', border: `1px solid ${c.border}`,
  color: c.textIce, cursor: 'pointer', fontWeight: 700,
};

const fieldErr: React.CSSProperties = {
  fontSize: 10.5, color: '#ff6b6b', marginTop: 4, fontWeight: 600,
};

const errBox: React.CSSProperties = {
  marginTop: 10, padding: '9px 11px', borderRadius: 8, fontSize: 11.5,
  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)',
  color: '#ff6b6b', lineHeight: 1.45,
};

function menuItem(active: boolean): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', borderRadius: 8,
    background: active ? 'rgba(0,35,230,0.22)' : 'transparent',
    border: '1px solid transparent',
    color: c.textIce, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', textAlign: 'left',
  };
}

function SyncBadge({ state, detail }: { state: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline'; detail: string }) {
  if (state === 'idle') return null;
  const map: Record<typeof state, { icon: string; color: string; bg: string; label: string }> = {
    idle:     { icon: '',   color: '',         bg: '',                       label: '' },
    saving:   { icon: '⟳',  color: '#0ea5e9',  bg: 'rgba(14,165,233,0.18)',  label: 'Syncing' },
    saved:    { icon: '✓',  color: '#16a34a',  bg: 'rgba(34,197,94,0.18)',   label: 'Synced' },
    error:    { icon: '!',  color: '#dc2626',  bg: 'rgba(239,68,68,0.18)',   label: 'Sync error' },
    conflict: { icon: '⇄',  color: '#d97706',  bg: 'rgba(245,158,11,0.20)',  label: 'Updated elsewhere' },
    offline:  { icon: '○',  color: '#64748b',  bg: 'rgba(100,116,139,0.20)', label: 'Offline' },
  };
  const m = map[state];
  return (
    <span
      title={detail || m.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', borderRadius: 999,
        background: m.bg, color: m.color,
        fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
        animation: state === 'saving' ? 'lemtel-pulse 1.1s ease-in-out infinite' : undefined,
      }}
    >
      <span aria-hidden style={{ fontSize: 10, lineHeight: 1, display: state === 'saving' ? 'inline-block' : undefined, animation: state === 'saving' ? 'lemtel-spin 1s linear infinite' : undefined }}>{m.icon}</span>
      <span style={{ textTransform: 'uppercase' }}>{m.label}</span>
    </span>
  );
}

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('lemtel-sync-anim')) {
  const s = document.createElement('style');
  s.id = 'lemtel-sync-anim';
  s.textContent = `
    @keyframes lemtel-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes lemtel-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
  `;
  document.head.appendChild(s);
}
