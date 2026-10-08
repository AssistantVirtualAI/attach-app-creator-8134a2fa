import React, { useEffect, useState } from 'react';
import { colors, font, radius, gradients } from '../lib/theme';
import type { Creds } from '../lib/creds';
import { mobileApi, MeResponse } from '../lib/mobileApi';
import { Card, Chip, SectionTitle, SettingsRow, StatusDot } from '../components/ui/Primitives';
import { LemtelMark, LemtelBadge } from '../components/Brand';
import { checkAllPermissions, openAppSettings, type AllPermissions, type PermissionStatus } from '../lib/permissions';
import { getAnnounceConsent, setAnnounceConsent } from '../lib/recordingConsent';
import { useTheme } from '../lib/ThemeContext';
import { useT } from '../lib/i18n';
import PoweredByAva from '../components/PoweredByAva';
import SegmentedChoice from '../components/SegmentedChoice';
import type { Tab } from '../components/BottomTabs';
import { setRoute as setAudioRoute, type AudioRoute } from '../lib/sip/audioOutput';
import { audioPrefs, type NCMode } from '../lib/audioPrefs';
import { showMobileToast as toast } from '../lib/mobileToast';

const PORTAL_URL = 'https://avastatistic.ca';

// Lemtel Phase 22B — read-only view of the four validated portal policy labels.
export type PortalTelephonyPolicy = {
  dndState: 'enabled' | 'disabled';
  forwardingState: 'enabled' | 'disabled';
  recordingPolicy: string;
  voicemailPolicy: string;
};

const POLICY_LABELS = {
  fr: {
    dnd: { enabled: 'Ne pas déranger : activé', disabled: 'Ne pas déranger : désactivé' },
    fwd: { enabled: 'Transfert d’appels : activé', disabled: 'Transfert d’appels : désactivé' },
    rec: { not_allowed: 'Enregistrement : non autorisé', user_allowed: 'Enregistrement : autorisé à l’utilisateur', portal_managed: 'Enregistrement : géré par le portail' },
    vm: { enabled: 'Boîte vocale : activée', disabled: 'Boîte vocale : désactivée' },
    title: 'Politique du portail',
    note: 'Les réglages téléphoniques sont appliqués par le portail. Modifiez-les dans le portail Lemtel.',
  },
  en: {
    dnd: { enabled: 'Do not disturb: enabled', disabled: 'Do not disturb: disabled' },
    fwd: { enabled: 'Call forwarding: enabled', disabled: 'Call forwarding: disabled' },
    rec: { not_allowed: 'Recording: not allowed', user_allowed: 'Recording: user allowed', portal_managed: 'Recording: portal managed' },
    vm: { enabled: 'Voicemail: enabled', disabled: 'Voicemail: disabled' },
    title: 'Portal policy',
    note: 'Telephony settings are applied by the portal. Change them in the Lemtel portal.',
  },
} as const;

function PortalPolicyCard({ policy, lang }: { policy: PortalTelephonyPolicy; lang: string }) {
  const L = lang === 'fr' ? POLICY_LABELS.fr : POLICY_LABELS.en;
  const pick = (m: Record<string, string>, k: string) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null);
  const lines = [pick(L.dnd, policy.dndState), pick(L.fwd, policy.forwardingState), pick(L.rec, policy.recordingPolicy), pick(L.vm, policy.voicemailPolicy)].filter((x): x is string => !!x);
  return (
    <section data-testid="portal-policy" aria-label={L.title}>
      <SectionTitle eyebrow="PORTAL" title={L.title} />
      <Card padded={true}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lines.map((l) => <li key={l} style={{ padding: '4px 0', fontSize: font.sm, color: colors.textIce }}>{l}</li>)}
        </ul>
      </Card>
      <p style={{ fontSize: font.xs, color: colors.mutedSilver, margin: '6px 4px 14px' }}>{L.note}</p>
    </section>
  );
}

export default function SettingsScreen({
  creds, sp, onSignOut, onNavigate, preferClickToCall = false, togglePreferC2C = () => {}, portalTelephonyPolicy = null,
}: { creds: Creds; sp: any; onSignOut: () => void; onNavigate?: (t: Tab) => void; preferClickToCall?: boolean; togglePreferC2C?: () => void; portalTelephonyPolicy?: PortalTelephonyPolicy | null }) {
  const { t, lang, setLang } = useT();
  const { mode, setMode } = useTheme();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [perms, setPerms] = useState<AllPermissions | null>(null);
  const [haptics, setHaptics] = useState<boolean>(() => localStorage.getItem('ava.haptics') !== 'off');
  const [autoAnswer, setAutoAnswer] = useState<boolean>(() => localStorage.getItem('ava.autoAnswer') === 'on');
  const [announceRec, setAnnounceRec] = useState<boolean>(() => getAnnounceConsent());

  const [ringtone, setRingtone] = useState<string>(() => {
    const stored = localStorage.getItem('ava.ringtone');
    return stored === 'AVA Default' ? 'Lemtel Default' : stored || 'Lemtel Default';
  });
  const [audioOut, setAudioOut] = useState<AudioRoute | 'default'>(() => (localStorage.getItem('ava.audioOut') as AudioRoute) || 'default');

  // Audio quality / network prefs
  const [ncEnabled, setNcEnabled] = useState<boolean>(() => audioPrefs.ncEnabled());
  const [ncMode, setNcMode] = useState<NCMode>(() => audioPrefs.ncMode());
  const [autoHandover, setAutoHandover] = useState<boolean>(() => audioPrefs.autoHandover());
  const [preferWifi, setPreferWifi] = useState<boolean>(() => audioPrefs.preferWifi());
  const [bgCalls, setBgCalls] = useState<boolean>(() => audioPrefs.backgroundCalls());
  const [netType, setNetType] = useState<string>('unknown');
  const [netConnected, setNetConnected] = useState<boolean>(true);

  // In-app sheets (Capacitor WebView-safe replacements for prompt/confirm)
  const [sheet, setSheet] = useState<null | 'ringtone' | 'audioOut' | 'clearCache'>(null);

  useEffect(() => {
    mobileApi.me().then((next) => {
      setMe(next);
    });
  }, []);
  useEffect(() => { checkAllPermissions().then(setPerms); }, []);

  // Live network status — Capacitor listener on native, navigator fallback on web
  useEffect(() => {
    let sub: any = null; let mounted = true;
    const apply = (connected: boolean, type: string) => {
      if (!mounted) return;
      setNetConnected(connected);
      setNetType(type || 'unknown');
      console.info('[Settings] network', { connected, type });
    };
    const readNav = () => {
      const conn: any = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      const t = conn?.type || (conn?.effectiveType ? 'cellular' : (navigator.onLine ? 'wifi' : 'none'));
      apply(!!navigator.onLine, t);
    };
    (async () => {
      try {
        const { Network } = await import('@capacitor/network');
        const cur = await Network.getStatus();
        apply(!!cur.connected, cur.connectionType || 'unknown');
        sub = await Network.addListener('networkStatusChange', (s) => {
          apply(!!s.connected, s.connectionType || 'unknown');
        });
      } catch {
        readNav();
      }
    })();
    const onOnline = () => readNav();
    const onOffline = () => apply(false, 'none');
    const conn: any = (navigator as any).connection;
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    conn?.addEventListener?.('change', readNav);
    return () => {
      mounted = false;
      sub?.remove?.().catch?.(() => {});
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      conn?.removeEventListener?.('change', readNav);
    };
  }, []);


  const applyPref = (key: string, next: boolean, apply: (v: boolean) => void, labelFr: string, labelEn: string) => {
    try {
      apply(next);
      console.info('[Settings] pref changed', { key, next });
      toast(`${lang==='fr'?labelFr:labelEn} — ${next ? (lang==='fr'?'activé':'on') : (lang==='fr'?'désactivé':'off')}`, 'success');
    } catch (e) {
      console.error('[Settings] pref failed', { key, next, error: e });
      toast(lang==='fr'?'Échec de la sauvegarde':'Failed to save', 'error');
    }
  };
  const toggleHaptics = () => { const n = !haptics; setHaptics(n); applyPref('haptics', n, (v)=>localStorage.setItem('ava.haptics', v?'on':'off'), 'Vibrations', 'Haptics'); };
  const toggleAutoAnswer = () => { const n = !autoAnswer; setAutoAnswer(n); applyPref('autoAnswer', n, (v)=>localStorage.setItem('ava.autoAnswer', v?'on':'off'), 'Réponse auto', 'Auto answer'); };

  const pickRingtoneChoice = (choice: string) => {
    setRingtone(choice);
    localStorage.setItem('ava.ringtone', choice);
    setSheet(null);
    console.info('[Settings] ringtone', choice);
    toast(lang==='fr'?'Sonnerie enregistrée':'Ringtone saved', 'success');
  };
  const pickAudioOutChoice = async (choice: AudioRoute | 'default') => {
    setAudioOut(choice);
    localStorage.setItem('ava.audioOut', choice);
    setSheet(null);
    if (choice !== 'default') {
      try { await setAudioRoute(choice); console.info('[Settings] audio route set', choice); }
      catch (e) { console.error('[Settings] setRoute failed', e); toast(lang==='fr'?'Échec sortie audio':'Audio route failed', 'error'); return; }
    }
    toast(lang==='fr'?'Sortie audio mise à jour':'Audio output updated', 'success');
  };
  const doClearCache = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ava.cache.'))
      .forEach((k) => localStorage.removeItem(k));
    setSheet(null);
    console.info('[Settings] cache cleared');
    toast(lang === 'fr' ? 'Cache vidé' : 'Cache cleared', 'success');
  };
  const openPortal = (path = '') => window.open(`${PORTAL_URL}${path}`, '_blank', 'noopener');

  const toggleNc = () => { const n = !ncEnabled; setNcEnabled(n); applyPref('nc', n, audioPrefs.setNcEnabled, 'Réduction de bruit', 'Noise cancellation'); };
  const changeNcMode = (m: NCMode) => { setNcMode(m); audioPrefs.setNcMode(m); console.info('[Settings] nc mode', m); toast(lang==='fr'?`Mode ${m}`:`Mode ${m}`, 'success'); };
  const toggleAutoHandover = () => { const n = !autoHandover; setAutoHandover(n); applyPref('autoHandover', n, audioPrefs.setAutoHandover, 'Basculement auto Wi-Fi/LTE', 'Auto Wi-Fi/LTE handover'); };
  const togglePreferWifi = () => { const n = !preferWifi; setPreferWifi(n); applyPref('preferWifi', n, audioPrefs.setPreferWifi, 'Préférer le Wi-Fi', 'Prefer Wi-Fi'); };
  const toggleBgCalls = () => { const n = !bgCalls; setBgCalls(n); applyPref('bgCalls', n, audioPrefs.setBackgroundCalls, 'Appels en arrière-plan', 'Background calls'); };




  const s = sp?.snap?.status || sp?.sipStatus;
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
            <LemtelBadge compact />
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
      <Card padded={true}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0 14px', borderBottom: `1px solid ${colors.border}` }}>
          <div>
            <div style={{ color: colors.textIce, fontSize: font.base, fontWeight: 800 }}>{t('settings.theme')}</div>
            <div style={{ color: colors.textSub, fontSize: font.xs, marginTop: 3 }}>{mode === 'dark' ? t('settings.themeDark') : t('settings.themeDaylight')}</div>
          </div>
          <SegmentedChoice
            ariaLabel={t('settings.theme')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeDaylight') },
            ]}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 14 }}>
          <div>
            <div style={{ color: colors.textIce, fontSize: font.base, fontWeight: 800 }}>{t('settings.language')}</div>
            <div style={{ color: colors.textSub, fontSize: font.xs, marginTop: 3 }}>{lang === 'fr' ? 'Français' : 'English'}</div>
          </div>
          <SegmentedChoice
            ariaLabel={t('settings.language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'fr', label: 'Français' },
            ]}
          />
        </div>
      </Card>

      {portalTelephonyPolicy && <PortalPolicyCard policy={portalTelephonyPolicy} lang={lang} />}

      {/* Calling */}
      <SectionTitle eyebrow={t('settings.calling')} title={t('settings.availability')} />
      <Card padded={false}>
        <SettingsRow
          label={lang === 'fr' ? 'Utiliser Click-to-Call' : 'Use Click-to-Call'}
          icon="📞"
          value={lang === 'fr'
            ? 'FusionPBX connecte l\'appel via votre extension physique'
            : 'FusionPBX bridges the call via your physical extension'}
          right={<Switch on={preferClickToCall} />}
          onPress={togglePreferC2C}
        />
        <SettingsRow label={t('settings.voicemailGreeting')} icon="🎙" value={t('settings.defaultGreeting')} onPress={() => onNavigate?.('voicemail' as Tab)} />
        <SettingsRow label={t('settings.autoAnswer')} icon="⚡" right={<Switch on={autoAnswer} />} onPress={toggleAutoAnswer} />
        <SettingsRow label={t('settings.ringtone')} icon="🎵" value={ringtone} onPress={() => setSheet('ringtone')} />
        <SettingsRow label={t('settings.audioOutput')} icon="🔊" value={audioOutLabel(audioOut, lang)} onPress={() => setSheet('audioOut')} />
        <SettingsRow label={t('settings.haptics')} icon="📳" right={<Switch on={haptics} />} onPress={toggleHaptics} />
      </Card>

      {/* Audio quality — noise cancellation */}
      <SectionTitle eyebrow="AUDIO" title={t('settings.audioQuality')} />
      <Card padded={false}>
        <SettingsRow
          label={t('settings.noiseCancel')} icon="🎧"
          value={ncEnabled ? t('common.on') : t('common.off')}
          right={<Switch on={ncEnabled} />}
          onPress={toggleNc}
        />
        {ncEnabled && (
          <div style={{ padding: '10px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {(['standard','office','phone'] as NCMode[]).map((m) => {
              const active = ncMode === m;
              const label = m === 'standard' ? t('settings.ncStandard') : m === 'office' ? t('settings.ncOffice') : t('settings.ncPhone');
              const desc  = m === 'standard' ? t('settings.ncStandardDesc') : m === 'office' ? t('settings.ncOfficeDesc') : t('settings.ncPhoneDesc');
              return (
                <button key={m} onClick={() => changeNcMode(m)} style={{
                  padding: '10px 8px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                  background: active ? 'rgba(46,155,220,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? colors.avaCyan : colors.border}`,
                  color: colors.textIce,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3, lineHeight: 1.3 }}>{desc}</div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Network — auto Wi-Fi / LTE handover */}
      <SectionTitle eyebrow="NET" title={t('settings.network')} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 8px' }}>
        <Chip tone={netConnected ? (netType === 'wifi' ? 'cyan' : 'gold') : 'red' as any}>
          {!netConnected ? (lang==='fr'?'Hors ligne':'Offline') : netType === 'wifi' ? 'Wi-Fi' : netType === 'cellular' ? 'LTE / Cellular' : netType.toUpperCase()}
        </Chip>
        <Chip tone={autoHandover ? 'cyan' : 'gold' as any}>
          {autoHandover ? (lang==='fr'?'Basculement auto ON':'Auto handover ON') : (lang==='fr'?'Basculement auto OFF':'Auto handover OFF')}
        </Chip>
        <Chip tone={preferWifi ? 'cyan' : 'gold' as any}>
          {preferWifi ? (lang==='fr'?'Préf. Wi-Fi':'Prefer Wi-Fi') : (lang==='fr'?'Préf. LTE':'Prefer LTE')}
        </Chip>
      </div>
      <Card padded={false}>
        <SettingsRow
          label={t('settings.autoHandover')} icon="🔀"
          value={autoHandover ? t('settings.autoHandoverSub') : t('common.off')}
          right={<Switch on={autoHandover} />}
          onPress={toggleAutoHandover}
        />
        <SettingsRow
          label={t('settings.preferWifi')} icon="📶"
          right={<Switch on={preferWifi} />}
          onPress={togglePreferWifi}
        />
        <SettingsRow
          label={t('settings.backgroundCalls')} icon="🌙"
          right={<Switch on={bgCalls} />}
          onPress={toggleBgCalls}
        />
        <SettingsRow
          label={t('settings.currentNetwork')} icon={netConnected ? '🟢' : '🔴'}
          value={
            !netConnected ? t('settings.netOffline') :
            netType === 'wifi' ? t('settings.netWifi') :
            netType === 'cellular' ? t('settings.netCellular') :
            netType
          }
        />
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
        <SettingsRow
          label={lang === 'fr' ? 'Statut' : 'Status'}
          icon={s === 'registered' ? '🟢' : s === 'error' ? '🔴' : (s === 'connecting' || s === 'retrying') ? '🟠' : '⚪'}
          value={s || (lang === 'fr' ? 'inactif' : 'idle')}
        />
        <SettingsRow label={lang === 'fr' ? 'Provider' : 'Provider'} icon="⇄" value={`${sp?.sipProvider || 'jssip-wss'} · ${sp?.platform || 'unknown'}`} />
        <SettingsRow label="WSS" icon="↔" value={sp?.sipConfig?.wssUrl || '—'} />
        {sp?.platform === 'android' && <SettingsRow label={lang === 'fr' ? 'Service natif' : 'Native service'} icon="◆" value={`${sp?.androidSipServiceStatus?.status || 'unknown'} · ${sp?.androidSipServiceStatus?.wakeLockHeld ? 'WakeLock' : 'no WakeLock'}`} />}
        {sp?.platform === 'android' && <SettingsRow label={lang === 'fr' ? 'Raison native' : 'Native reason'} icon="!" value={sp?.androidSipServiceStatus?.reason || '—'} />}
        <SettingsRow label={lang === 'fr' ? 'Dernière erreur' : 'Last error'} icon="!" value={sp?.snap?.error || sp?.lastPersistedError?.error || t('common.none')} />
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
        <SettingsRow label={t('settings.clearCache')} icon="🧹" onPress={() => setSheet('clearCache')} />
        <SettingsRow label={t('settings.deleteAccount')} icon="⚠" onPress={() => openPortal('/account/delete')} />
      </Card>

      {/* Support & about */}
      <SectionTitle eyebrow={t('settings.about')} title={t('settings.helpSupport')} />
      <Card padded={false}>
        <SettingsRow label={t('settings.helpSupport')} icon="❓" onPress={() => window.open('mailto:support@lemtel.tel?subject=Lemtel%20support', '_blank')} />
        <SettingsRow label={t('settings.about')} icon="ⓘ" value={`${t('settings.version')} 1.1 (3)`} onPress={() => alert('Lemtel v1.0.0\nLemtel Communications')} />
      </Card>

      <Card padded={true} accent="cyan">
        <p style={{ fontSize: font.sm, color: colors.textIce, margin: 0, lineHeight: 1.55 }}>
          {lang === 'fr'
            ? "Toutes les données téléphoniques sont limitées à l'organisation Lemtel authentifiée. Les utilisateurs standard accèdent uniquement à leur extension; les admins gèrent ce que leur rôle permet."
            : 'All telephony data is scoped by the authenticated Lemtel organization. Standard users access only their own extension; domain admins manage what their role allows.'}
        </p>
      </Card>

      <button onClick={onSignOut} style={{
        marginTop: 16, width: '100%', height: 48, borderRadius: radius.md,
        background: 'rgba(255,77,103,0.12)', border: `1px solid ${colors.danger}55`,
        color: colors.danger, fontSize: font.base, fontWeight: 700, cursor: 'pointer',
      }}>
        {t('settings.signOut')}
      </button>

      <div style={{ display: 'grid', justifyItems: 'center', gap: 8, marginTop: 18, fontSize: 10, color: colors.mutedSilver, letterSpacing: 0.4 }}>
        <span>Lemtel · Secure communications</span>
        <PoweredByAva />
      </div>
      <div style={{ height: 80 }} />

      {/* Bottom sheets — WebView-safe replacements for prompt/confirm */}
      {sheet === 'ringtone' && (
        <Sheet title={lang==='fr'?'Sonnerie':'Ringtone'} onClose={() => setSheet(null)}>
          {['Lemtel Default','Classic','Pulse','Marimba','Silent'].map((r) => (
            <SheetItem key={r} active={ringtone===r} onPress={() => pickRingtoneChoice(r)} label={r} />
          ))}
        </Sheet>
      )}
      {sheet === 'audioOut' && (
        <Sheet title={lang==='fr'?'Sortie audio':'Audio output'} onClose={() => setSheet(null)}>
          {([
            ['default', lang==='fr'?'Par défaut système':'System default'],
            ['earpiece', lang==='fr'?'Écouteur':'Earpiece'],
            ['speaker', lang==='fr'?'Haut-parleur':'Speaker'],
            ['bluetooth', 'Bluetooth'],
          ] as [AudioRoute|'default', string][]).map(([k,l]) => (
            <SheetItem key={k} active={audioOut===k} onPress={() => pickAudioOutChoice(k)} label={l} />
          ))}
        </Sheet>
      )}
      {sheet === 'clearCache' && (
        <Sheet title={lang==='fr'?"Vider le cache ?":'Clear app cache?'} onClose={() => setSheet(null)}>
          <p style={{ fontSize: 13, color: colors.mutedSilver, margin: '0 0 14px' }}>
            {lang==='fr'?"Les résumés IA et caches locaux seront supprimés.":'AI summaries and local caches will be removed.'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSheet(null)} style={sheetBtnStyle(false)}>{t('common.cancel')}</button>
            <button onClick={doClearCache} style={sheetBtnStyle(true)}>{t('common.clear')}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function audioOutLabel(v: AudioRoute | 'default', lang: 'en'|'fr') {
  if (v === 'speaker') return lang==='fr'?'Haut-parleur':'Speaker';
  if (v === 'earpiece') return lang==='fr'?'Écouteur':'Earpiece';
  if (v === 'bluetooth') return 'Bluetooth';
  return lang==='fr'?'Par défaut':'System default';
}

function sheetBtnStyle(primary: boolean): React.CSSProperties {
  return {
    flex: 1, height: 44, borderRadius: 10, cursor: 'pointer',
    background: primary ? gradients.call : 'rgba(255,255,255,0.06)',
    color: primary ? '#fff' : colors.textIce,
    border: `1px solid ${primary ? colors.signalGold : colors.border}`,
    fontWeight: 700, fontSize: 14,
  };
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: colors.graphite,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '16px 16px 28px', borderTop: `1px solid ${colors.border}`,
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: colors.border, margin: '0 auto 14px' }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: colors.textIce, marginBottom: 10 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function SheetItem({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <button onClick={onPress} style={{
      width: '100%', textAlign: 'left', padding: '14px 12px', borderRadius: 10,
      background: active ? 'rgba(46,155,220,0.18)' : 'transparent',
      border: `1px solid ${active ? colors.avaCyan : 'transparent'}`,
      color: colors.textIce, fontSize: 14, marginBottom: 6, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span>{label}</span>
      {active && <span style={{ color: colors.avaCyan }}>✓</span>}
    </button>
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
