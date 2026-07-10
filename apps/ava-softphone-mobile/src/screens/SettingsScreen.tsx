import React, { useEffect, useState } from 'react';
import { colors, font, radius, gradients } from '../lib/theme';
import type { Creds } from '../lib/creds';
import { mobileApi, MeResponse } from '../lib/mobileApi';
import { Card, Chip, SectionTitle, SettingsRow, StatusDot, AIPanel } from '../components/ui/Primitives';
import { LemtelMark, AvaBadge } from '../components/Brand';
import { checkAllPermissions, openAppSettings, type AllPermissions, type PermissionStatus } from '../lib/permissions';
import { getAnnounceConsent, setAnnounceConsent } from '../lib/recordingConsent';
import { useTheme } from '../lib/ThemeContext';
import { useT } from '../lib/i18n';
import type { Tab } from '../components/BottomTabs';
import { setRoute as setAudioRoute, type AudioRoute } from '../lib/sip/audioOutput';
import { audioPrefs, type NCMode } from '../lib/audioPrefs';
import { showMobileToast as toast } from '../lib/mobileToast';

const PORTAL_URL = 'https://avastatistic.ca';

export default function SettingsScreen({
  creds, sp, onSignOut, onNavigate, preferClickToCall = false, togglePreferC2C = () => {},
}: { creds: Creds; sp: any; onSignOut: () => void; onNavigate?: (t: Tab) => void; preferClickToCall?: boolean; togglePreferC2C?: () => void }) {
  const { t, lang, setLang } = useT();
  const { mode, toggle: toggleTheme } = useTheme();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [dnd, setDnd] = useState(false);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [perms, setPerms] = useState<AllPermissions | null>(null);
  const [haptics, setHaptics] = useState<boolean>(() => localStorage.getItem('ava.haptics') !== 'off');
  const [autoAnswer, setAutoAnswer] = useState<boolean>(() => localStorage.getItem('ava.autoAnswer') === 'on');
  const [announceRec, setAnnounceRec] = useState<boolean>(() => getAnnounceConsent());
  const [claudeFallback, setClaudeFallback] = useState<boolean>(() => localStorage.getItem('ava.claudeFallback') !== 'off');
  const [lastTranscriber, setLastTranscriber] = useState<string>(() => localStorage.getItem('ava.lastTranscriber') || '—');
  
  const [ringtone, setRingtone] = useState<string>(() => localStorage.getItem('ava.ringtone') || 'AVA Default');
  const [audioOut, setAudioOut] = useState<string>(() => localStorage.getItem('ava.audioOut') || 'System default');

  useEffect(() => {
    mobileApi.me().then((next) => {
      setMe(next);
      setDnd(!!next.status?.doNotDisturb);
      setForwarding(next.status?.forwarding || null);
    });
  }, []);
  useEffect(() => { checkAllPermissions().then(setPerms); }, []);

  const toggleDnd = async () => { const next = !dnd; setDnd(next); try { await mobileApi.setDnd(next); } catch {} };
  const toggleFwd = async () => {
    const cur = forwarding;
    const next = cur ? null : prompt(lang === 'fr' ? 'Numéro de transfert (E.164):' : 'Forwarding number (E.164):', '+1');
    if (next === undefined) return;
    setForwarding(next || null);
    try { await mobileApi.setForwarding(next || null); } catch {}
  };
  const toggleHaptics = () => { const next = !haptics; setHaptics(next); localStorage.setItem('ava.haptics', next ? 'on' : 'off'); };
  const toggleAutoAnswer = () => { const next = !autoAnswer; setAutoAnswer(next); localStorage.setItem('ava.autoAnswer', next ? 'on' : 'off'); };
  
  const pickRingtone = () => {
    const opts = ['AVA Default', 'Classic', 'Pulse', 'Marimba', 'Silent'];
    const choice = prompt((lang === 'fr' ? 'Sonnerie' : 'Ringtone') + ` (${opts.join(', ')}):`, ringtone);
    if (choice && opts.includes(choice)) { setRingtone(choice); localStorage.setItem('ava.ringtone', choice); }
  };
  const pickAudioOut = () => {
    const opts = ['System default', 'Speaker', 'Earpiece', 'Bluetooth'];
    const choice = prompt((lang === 'fr' ? 'Sortie audio' : 'Audio output') + ` (${opts.join(', ')}):`, audioOut);
    if (choice && opts.includes(choice)) { setAudioOut(choice); localStorage.setItem('ava.audioOut', choice); }
  };
  const clearCache = () => {
    if (!confirm(lang === 'fr' ? 'Vider le cache de l\'application ?' : 'Clear app cache?')) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ava.aisummary.') || k.startsWith('ava.cache.'))
      .forEach((k) => localStorage.removeItem(k));
    alert(lang === 'fr' ? 'Cache vidé.' : 'Cache cleared.');
  };
  const openPortal = (path = '') => window.open(`${PORTAL_URL}${path}`, '_blank', 'noopener');

  const s = sp?.snap?.status;
  const sipState: 'registered' | 'connecting' | 'retrying' | 'offline' =
    s === 'registered' ? 'registered' :
    s === 'retrying'   ? 'retrying' :
    s === 'connecting' ? 'connecting' :
                         'offline';

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 14px 20px' }}>
      {/* Profile */}
      <Card padded={true} accent="gold" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <LemtelMark size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: font.md, fontWeight: 800, color: colors.textIce }}>{me?.user.name || creds.displayName || creds.email}</span>
              <AvaBadge compact />
            </div>
            <div style={{ fontSize: font.xs, color: colors.mutedSilver, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
              Ext {creds.extension} · {me?.client?.name ? `${me.client.name} · ` : ''}{me?.domain.sipDomain || me?.organization.name || creds.sipDomain || 'lemtel.tel'}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusDot state={sipState} />
              <Chip tone={me?.permissions.admin ? 'gold' : 'cyan'}>{me?.permissions.admin ? t('settings.admin') : t('settings.user')}</Chip>
            </div>
          </div>
        </div>
      </Card>

      {/* Appearance & language */}
      <SectionTitle eyebrow={t('settings.appearance')} title={t('settings.appearance')} />
      <Card padded={false}>
        <SettingsRow
          label={t('settings.theme')} icon="🌓"
          value={mode === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
          right={<Switch on={mode === 'dark'} />}
          onPress={toggleTheme}
        />
        <SettingsRow
          label={t('settings.language')} icon="🌐"
          value={lang === 'fr' ? 'Français' : 'English'}
          right={<LangPill lang={lang} />}
          onPress={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        />
      </Card>

      {/* Calling */}
      <SectionTitle eyebrow={t('settings.calling')} title={t('settings.availability')} />
      <Card padded={false}>
        <SettingsRow label={t('settings.dnd')} icon="🔕" onPress={toggleDnd} right={<Switch on={dnd} />} />
        <SettingsRow
          label={lang === 'fr' ? 'Utiliser Click-to-Call' : 'Use Click-to-Call'}
          icon="📞"
          value={lang === 'fr'
            ? 'FusionPBX connecte l\'appel via votre extension physique'
            : 'FusionPBX bridges the call via your physical extension'}
          right={<Switch on={preferClickToCall} />}
          onPress={togglePreferC2C}
        />
        <SettingsRow label={t('settings.callForwarding')} icon="↪" onPress={toggleFwd} value={forwarding || t('common.off')} right={<Switch on={!!forwarding} />} />
        <SettingsRow label={t('settings.voicemailGreeting')} icon="🎙" value={t('settings.defaultGreeting')} onPress={() => onNavigate?.('voicemail' as Tab)} />
        <SettingsRow label={t('settings.autoAnswer')} icon="⚡" right={<Switch on={autoAnswer} />} onPress={toggleAutoAnswer} />
        <SettingsRow label={t('settings.ringtone')} icon="🎵" value={ringtone} onPress={pickRingtone} />
        <SettingsRow label={t('settings.audioOutput')} icon="🔊" value={audioOut} onPress={pickAudioOut} />
        <SettingsRow label={t('settings.haptics')} icon="📳" right={<Switch on={haptics} />} onPress={toggleHaptics} />
      </Card>

      {/* Account */}
      <SectionTitle eyebrow={t('settings.account')} title={t('settings.extDevices')} />
      <Card padded={false}>
        <SettingsRow label={t('settings.extension')} icon="☎" value={me?.extension.number || creds.extension} />
        <SettingsRow label={t('settings.sipDomain')} icon="🌐" value={me?.domain.sipDomain || me?.extension.sipDomain || creds.sipDomain || '—'} />
        {me?.client && <SettingsRow label={t('settings.client')} icon="◈" value={me.client.name} />}
        <SettingsRow label={t('settings.dataScope')} icon="⌁" value={me?.dataScope === 'domain_admin' ? t('settings.scopeDomain') : t('settings.scopeOwn')} />
        <SettingsRow label={t('settings.role')} icon="◎" value={me?.role || creds.role || 'agent'} />
        <SettingsRow label={t('settings.devices')} icon="📱" value={lang === 'fr' ? 'Cet appareil · WebRTC' : 'This device · WebRTC'} onPress={() => onNavigate?.('permissions' as Tab)} />
        <SettingsRow label={t('settings.notifications')} icon="🔔" value={t('settings.pushEnabled')} onPress={() => openAppSettings()} />
        <SettingsRow label={lang === 'fr' ? 'Diagnostic audio / RTP' : 'Audio / RTP diagnostics'} icon="🩺" value={lang === 'fr' ? 'Test ton, route, stats' : 'Tone test, route, stats'} onPress={() => onNavigate?.('audiodiag' as Tab)} />
      </Card>

      {/* Admin */}
      {me?.permissions.admin && (
        <>
          <SectionTitle eyebrow={t('settings.workspace')} title={t('settings.adminTitle')} />
          <Card padded={false}>
            {me.permissions.canManageUsers && <SettingsRow label={t('settings.usersExt')} icon="👥" value={me.domain.sipDomain} onPress={() => openPortal('/dashboard/team')} />}
            {me.permissions.canManageNumbers && <SettingsRow label={t('settings.phoneNumbers')} icon="#" value={t('settings.openPortal')} onPress={() => openPortal('/dashboard/phone-numbers')} />}
            {me.permissions.canManageRouting && <SettingsRow label={t('settings.ivrs')} icon="🎛" value={t('settings.openPortal')} onPress={() => openPortal('/dashboard/routing')} />}
            {me.permissions.canManageAgents && <SettingsRow label={t('settings.voiceAgents')} icon="🤖" value={t('settings.openPortal')} onPress={() => openPortal('/dashboard/agents')} />}
            <SettingsRow label={t('settings.syncStatus')} icon="↻" value={s || (lang === 'fr' ? 'inactif' : 'idle')} onPress={() => sp?.reconnect?.()} />
          </Card>
        </>
      )}

      {/* SIP debug — collapsible */}
      <SectionTitle eyebrow="SIP" title={t('settings.diagnostics')} />
      <Card padded={false}>
        <SettingsRow label={lang === 'fr' ? 'Statut' : 'Status'} icon="●" value={sp?.snap?.status || (lang === 'fr' ? 'inactif' : 'idle')} />
        <SettingsRow label="WSS" icon="↔" value={sp?.sipConfig?.wssUrl || '—'} />
        <SettingsRow label={lang === 'fr' ? 'Dernière erreur' : 'Last error'} icon="!" value={sp?.snap?.error || t('common.none')} />
        <SettingsRow label={lang === 'fr' ? "Relancer l'enregistrement" : 'Retry Registration'} icon="↻" onPress={() => sp?.reconnect?.()} />
        <SettingsRow label={lang === 'fr' ? "Vider l'état SIP" : 'Clear SIP status'} icon="✕" onPress={() => sp?.clearSipState?.()} />
        <SettingsRow label={lang === 'fr' ? 'Copier le journal SIP' : 'Copy SIP log'} icon="⧉" onPress={async () => {
          const text = (sp?.sipLog || []).map((e: any) => `${new Date(e.time).toISOString()} [${e.level}] ${e.event}${e.detail ? ' — ' + e.detail : ''}`).join('\n');
          try { await navigator.clipboard.writeText(text || ''); alert(lang === 'fr' ? 'Copié.' : 'Copied.'); } catch { alert(lang === 'fr' ? 'Échec de la copie' : 'Copy failed'); }
        }} />
      </Card>


      {/* Permissions */}
      <SectionTitle eyebrow={t('settings.privacy')} title={t('settings.permissions')} />
      <Card padded={false}>
        {PERMISSION_ITEMS.map((item) => (
          <SettingsRow
            key={item.key}
            label={lang === 'fr' ? PERMISSION_FR[item.key].label : item.label}
            icon={item.icon}
            value={lang === 'fr' ? PERMISSION_FR[item.key].sublabel : item.sublabel}
            right={<PermBadge status={perms?.[item.key as keyof AllPermissions] ?? 'prompt'} lang={lang} />}
            onPress={() => openAppSettings()}
          />
        ))}
        <SettingsRow label={t('common.openSettings')} icon="⚙" onPress={() => openAppSettings()} />
      </Card>

      {/* Security & data */}
      <SectionTitle eyebrow={t('settings.privacy')} title={t('settings.security')} />
      <Card padded={false}>
        <SettingsRow label={t('settings.dataSafety')} icon="🛡" onPress={() => openPortal('/data-safety')} />
        <SettingsRow label={t('settings.privacyPolicy')} icon="📄" onPress={() => openPortal('/privacy')} />
        <SettingsRow label={t('settings.termsOfService')} icon="📜" onPress={() => openPortal('/terms')} />
        <SettingsRow
          label={lang === 'fr' ? "Annoncer l'enregistrement d'appel" : 'Announce call recording'}
          icon="🔔"
          value={announceRec ? (lang === 'fr' ? 'Activé (recommandé)' : 'On (recommended)') : (lang === 'fr' ? 'Désactivé' : 'Off')}
          onPress={() => { const next = !announceRec; setAnnounceRec(next); setAnnounceConsent(next); }}
        />
        <SettingsRow label={t('settings.clearCache')} icon="🧹" onPress={clearCache} />
        <SettingsRow label={t('settings.deleteAccount')} icon="⚠" onPress={() => openPortal('/account/delete')} />
      </Card>

      {/* Transcription */}
      <SectionTitle eyebrow="AI" title={lang === 'fr' ? 'Transcription' : 'Transcription'} />
      <Card padded={false}>
        <SettingsRow
          label={lang === 'fr' ? 'Fournisseur actif (dernier appel)' : 'Active provider (last call)'}
          icon="🧠"
          value={lastTranscriber}
          onPress={() => setLastTranscriber(localStorage.getItem('ava.lastTranscriber') || '—')}
        />
        <SettingsRow
          label={lang === 'fr' ? 'Repli Claude (Anthropic)' : 'Claude fallback (Anthropic)'}
          icon="🛟"
          value={claudeFallback
            ? (lang === 'fr' ? 'Activé — utilisé si Gemini & GPT échouent' : 'On — used if Gemini & GPT fail')
            : (lang === 'fr' ? 'Désactivé' : 'Off')}
          onPress={() => { const next = !claudeFallback; setClaudeFallback(next); localStorage.setItem('ava.claudeFallback', next ? 'on' : 'off'); }}
        />
      </Card>

      {/* Support & about */}
      <SectionTitle eyebrow={t('settings.about')} title={t('settings.helpSupport')} />
      <Card padded={false}>
        <SettingsRow label={t('settings.helpSupport')} icon="❓" onPress={() => window.open('mailto:support@lemtel.tel?subject=AVA%20Softphone%20support', '_blank')} />
        <SettingsRow label={t('settings.about')} icon="ⓘ" value={`${t('settings.version')} 1.0.0`} onPress={() => alert('AVA Softphone v1.0.0\nPowered by Lemtel · AVA AI')} />
      </Card>

      <AIPanel title="AVA" accent={colors.avaCyan}>
        <p style={{ fontSize: font.sm, color: colors.textIce, margin: 0, lineHeight: 1.55 }}>
          {lang === 'fr'
            ? "Toutes les données téléphoniques sont limitées à l'organisation/domaine AVA authentifié. Les utilisateurs standard accèdent uniquement à leur extension; les admins gèrent ce que leur rôle permet."
            : 'All telephony data is scoped by the authenticated AVA organization/domain. Standard users access only their own extension; domain admins manage what their role allows.'}
        </p>
      </AIPanel>

      <button onClick={onSignOut} style={{
        marginTop: 16, width: '100%', height: 48, borderRadius: radius.md,
        background: 'rgba(255,77,103,0.12)', border: `1px solid ${colors.danger}55`,
        color: colors.danger, fontSize: font.base, fontWeight: 700, cursor: 'pointer',
      }}>
        {t('settings.signOut')}
      </button>

      <div style={{ textAlign: 'center', marginTop: 18, fontSize: 10, color: colors.mutedSilver, letterSpacing: 0.4 }}>
        AVA Softphone · Powered by AVA AI
      </div>
      <div style={{ height: 80 }} />
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 36, height: 22, borderRadius: 999,
      background: on ? gradients.call : 'rgba(255,255,255,0.08)',
      border: `1px solid ${on ? colors.signalGold : colors.border}`,
      position: 'relative', display: 'inline-block',
      transition: 'background .2s ease',
    }}>
      <span style={{
        position: 'absolute', top: 1.5, left: on ? 16 : 2,
        width: 17, height: 17, borderRadius: '50%',
        background: '#fff', transition: 'left .2s ease',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      }} />
    </span>
  );
}

function LangPill({ lang }: { lang: 'en' | 'fr' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 999,
      background: `linear-gradient(135deg, ${colors.lemtelBlue}, ${colors.avaCyan})`,
      color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
    }}>{lang.toUpperCase()}</span>
  );
}

const PERMISSION_ITEMS = [
  { key: 'microphone',    icon: '🎤', label: 'Microphone',    sublabel: 'Required for calls' },
  { key: 'speaker',       icon: '🔊', label: 'Speaker',       sublabel: 'For call audio' },
  { key: 'contacts',      icon: '👥', label: 'Contacts',      sublabel: 'For caller ID' },
  { key: 'notifications', icon: '🔔', label: 'Notifications', sublabel: 'For incoming calls' },
] as const;

const PERMISSION_FR: Record<string, { label: string; sublabel: string }> = {
  microphone:    { label: 'Microphone',    sublabel: 'Requis pour les appels' },
  speaker:       { label: 'Haut-parleur',  sublabel: 'Pour le son des appels' },
  contacts:      { label: 'Contacts',      sublabel: 'Pour l\'identification' },
  notifications: { label: 'Notifications', sublabel: 'Pour les appels entrants' },
};

function PermBadge({ status, lang }: { status: PermissionStatus; lang: 'en' | 'fr' }) {
  const fr = lang === 'fr';
  const cfg =
    status === 'granted' ? { dot: '#10B981', label: fr ? 'Accordé' : 'Granted' } :
    status === 'denied'  ? { dot: colors.danger, label: fr ? 'Refusé' : 'Denied' } :
    status === 'unsupported' ? { dot: colors.mutedSilver, label: 'N/A' } :
                           { dot: colors.mutedSilver, label: fr ? 'Demander' : 'Ask' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, color: colors.textIce, fontWeight: 600,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}
