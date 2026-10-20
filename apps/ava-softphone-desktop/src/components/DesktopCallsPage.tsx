import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Loader2, Mic, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, RefreshCw, Trash2, Voicemail } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { desktopPbx, desktopPbxWrites, LemtelPbxError, type GatewayCdr, type GatewaySelf } from '../lib/lemtelPbxDesktop';

type Sub = 'recent' | 'missed' | 'voicemail' | 'recordings';

const ERR: Record<string, [string, string]> = {
  pbx_not_configured: ['Telephony is not connected for your organization yet.', 'La téléphonie n’est pas encore connectée pour votre organisation.'],
  extension_not_assigned: ['No extension is assigned to you yet.', 'Aucun poste ne vous est encore attribué.'],
  management_not_ready: ['Your administrator is finishing the telephony setup.', 'Votre administrateur termine la configuration téléphonique.'],
  function_not_deployed: ['This feature is not available on the server yet.', 'Cette fonction n’est pas encore disponible sur le serveur.'],
  network: ['Network unavailable. Check your connection.', 'Réseau indisponible. Vérifiez votre connexion.'],
  unauthorized: ['Your session expired. Sign in again.', 'Votre session a expiré. Reconnectez-vous.'],
  forbidden: ['You do not have access to this information.', 'Vous n’avez pas accès à ces informations.'],
};
const msg = (lang: 'en' | 'fr', e: unknown) => {
  const code = e instanceof LemtelPbxError ? e.code : 'server_error';
  const pair = ERR[code] ?? ['Telephony data is temporarily unavailable.', 'Les données téléphoniques sont temporairement indisponibles.'];
  return lang === 'fr' ? pair[1] : pair[0];
};
const fmtDur = (s: number | null | undefined) => { const v = Math.max(0, Math.round(s ?? 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** Real call history, voicemail and recordings for the signed-in user's own extension (server-scoped). */
export default function DesktopCallsPage({ organizationId }: { organizationId: string }) {
  const { lang } = useTranslation();
  const L = (en: string, fr: string) => (lang === 'fr' ? fr : en);
  const [sub, setSub] = useState<Sub>('recent');
  const [calls, setCalls] = useState<GatewayCdr[] | null>(null);
  const [me, setMe] = useState<GatewaySelf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (sub === 'voicemail') setMe(await desktopPbx.me(organizationId));
      else setCalls((await desktopPbx.calls(organizationId, { missedOnly: sub === 'missed', recordedOnly: sub === 'recordings' })).records);
    } catch (e) { setError(msg(lang, e)); } finally { setLoading(false); }
  }, [lang, organizationId, sub]);
  useEffect(() => { void load(); }, [load]);

  const play = async (id: string, fetcher: () => Promise<Blob>) => {
    setBusy(id);
    try { const blob = await fetcher(); setAudio({ id, url: URL.createObjectURL(blob) }); } catch (e) { setError(msg(lang, e)); } finally { setBusy(null); }
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const tabs = useMemo(() => ([
    ['recent', L('Recent', 'Récents'), History], ['missed', L('Missed', 'Manqués'), PhoneMissed],
    ['voicemail', L('Voicemail', 'Messagerie'), Voicemail], ['recordings', L('Recordings', 'Enregistrements'), Mic],
  ] as const), [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="desktop-readonly-section desktop-calls" data-testid="lemtel-desktop-calls-page" aria-live="polite">
      <style>{`
        .desktop-calls { display: grid; gap: 14px; }
        .desktop-calls-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .desktop-calls-bar [role=tab] { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--ava-border, rgba(180,200,255,.18)); background: transparent; color: var(--ava-text, #f6f9ff); font: 700 12px inherit; cursor: pointer; }
        .desktop-calls-bar [role=tab][aria-selected=true] { border-color: rgba(128,173,255,.55); background: linear-gradient(100deg, rgba(55,97,255,.56), rgba(34,212,253,.16)); }
        .desktop-calls-refresh { margin-left: auto; }
        .desktop-calls-list { list-style: none; margin: 0; padding: 6px 18px; }
        .desktop-calls-row { display: grid; grid-template-columns: 34px minmax(0,1fr) auto auto; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--ava-border, rgba(180,200,255,.12)); }
        .desktop-calls-row:first-child { border-top: 0; }
        .desktop-calls-icon { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: rgba(102,128,255,.18); color: #8fa6ff; }
        .desktop-calls-icon[data-missed=true] { background: rgba(255,92,108,.16); color: #ff7b8a; }
        .desktop-calls-name { font-weight: 760; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .desktop-calls-sub { color: var(--ava-text-subtle, #8a9bc4); font-size: 11px; margin-top: 2px; }
        .desktop-calls-meta { color: var(--ava-text-subtle, #8a9bc4); font-size: 11px; text-align: right; }
        .desktop-calls-actions { display: flex; gap: 6px; }
        .desktop-calls-actions button, .desktop-calls-refresh { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--ava-border, rgba(180,200,255,.18)); background: transparent; color: var(--ava-text, #f6f9ff); cursor: pointer; font: 700 11px inherit; }
        .desktop-calls-actions button:disabled { opacity: .45; cursor: default; }
        .desktop-calls-empty { padding: 26px 18px; color: var(--ava-text-subtle, #8a9bc4); font-size: 13px; text-align: center; }
        .desktop-calls audio { width: 100%; }
        .desktop-calls-transcript { grid-column: 2 / -1; font-size: 12px; color: var(--ava-text, #f6f9ff); opacity: .85; }
      `}</style>
      <div className="desktop-calls-bar" role="tablist" aria-label={L('Call views', 'Vues des appels')}>
        {tabs.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} onClick={() => { setSub(id); setAudio(null); }}><Icon size={14} />{label}</button>
        ))}
        <button type="button" className="desktop-calls-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}{L('Refresh', 'Actualiser')}
        </button>
      </div>

      {audio && <audio controls autoPlay src={audio.url} aria-label={L('Playback', 'Lecture')} />}

      <div className="desktop-readonly-card">
        {error ? <div className="desktop-calls-empty" role="alert">{error}</div>
          : sub === 'voicemail' ? (
            !me ? <div className="desktop-calls-empty">{L('Loading…', 'Chargement…')}</div>
              : !me.voicemail ? <div className="desktop-calls-empty">{L('No mailbox for your extension.', 'Aucune boîte vocale pour votre poste.')}</div>
                : me.voicemail.messages.length === 0 ? <div className="desktop-calls-empty">{L('No voicemail.', 'Aucun message vocal.')}</div>
                  : <ul className="desktop-calls-list">{me.voicemail.messages.map((m) => (
                    <li key={m.uuid} className="desktop-calls-row">
                      <span className="desktop-calls-icon" data-missed={m.status !== 'saved'}><Voicemail size={16} /></span>
                      <div><div className="desktop-calls-name">{m.callerName || m.callerNumber || L('Unknown', 'Inconnu')}</div><div className="desktop-calls-sub">{m.callerNumber} · {when(m.createdAt)}</div></div>
                      <div className="desktop-calls-meta">{fmtDur(m.seconds)}</div>
                      <div className="desktop-calls-actions">
                        <button type="button" aria-label={L('Play', 'Écouter')} disabled={busy !== null} onClick={() => void play(m.uuid, () => desktopPbx.voicemailAudio(organizationId, m.uuid))}>{busy === m.uuid ? <Loader2 size={13} /> : <Play size={13} />}</button>
                        <button type="button" aria-label={L('Delete', 'Supprimer')} disabled={!me.writesEnabled || busy !== null} onClick={() => {
                          setBusy(m.uuid);
                          desktopPbxWrites.deleteVoicemail(organizationId, m.uuid).then(load).catch((e) => setError(msg(lang, e))).finally(() => setBusy(null));
                        }}><Trash2 size={13} /></button>
                      </div>
                      {m.transcription && <p className="desktop-calls-transcript">{m.transcription}</p>}
                    </li>))}</ul>
          ) : calls === null ? <div className="desktop-calls-empty">{L('Loading…', 'Chargement…')}</div>
            : calls.length === 0 ? <div className="desktop-calls-empty">{sub === 'recordings' ? L('No recording in the last 30 days.', 'Aucun enregistrement depuis 30 jours.') : sub === 'missed' ? L('No missed call in the last 30 days.', 'Aucun appel manqué depuis 30 jours.') : L('No call in the last 30 days.', 'Aucun appel depuis 30 jours.')}</div>
              : <ul className="desktop-calls-list">{calls.map((c) => {
                const inbound = c.direction === 'inbound' || c.direction === 'local';
                const Icon = c.missed ? PhoneMissed : inbound ? PhoneIncoming : PhoneOutgoing;
                const party = inbound ? (c.callerName || c.callerNumber) : c.destination;
                return (
                  <li key={c.id} className="desktop-calls-row">
                    <span className="desktop-calls-icon" data-missed={c.missed}><Icon size={16} /></span>
                    <div><div className="desktop-calls-name">{party || L('Unknown', 'Inconnu')}</div><div className="desktop-calls-sub">{inbound ? c.callerNumber : c.destination} · {when(c.startAt)}</div></div>
                    <div className="desktop-calls-meta">{c.missed ? L('Missed', 'Manqué') : fmtDur(c.billsec)}</div>
                    <div className="desktop-calls-actions">
                      {c.hasRecording && <button type="button" aria-label={L('Play recording', 'Écouter l’enregistrement')} disabled={busy !== null} onClick={() => void play(c.id, () => desktopPbx.recording(organizationId, c.id))}>{busy === c.id ? <Loader2 size={13} /> : <Play size={13} />}</button>}
                    </div>
                  </li>);
              })}</ul>}
      </div>
    </section>
  );
}
