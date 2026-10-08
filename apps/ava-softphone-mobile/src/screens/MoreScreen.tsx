import React, { useState, Suspense, lazy } from 'react';
import type { ImpactStyle } from '@capacitor/haptics';
import { colors, font } from '../lib/theme';
import { deleteServerContacts, revokeConsent } from '../lib/contactsConsent';
import { deleteLemtelDeviceContactsAndRevoke } from '../lib/lemtelPrivateContactsConsent';
import { LEGACY_CONTACTS_ENABLED, LEMTEL_PRIVATE_CONTACTS_UI_ENABLED } from '../lib/contactScope';
import type { Creds } from '../lib/creds';
import { Card, SectionTitle, SettingsRow } from '../components/ui/Primitives';
import { LemtelMark, LemtelBadge } from '../components/Brand';
import VoicemailScreen from './VoicemailScreen';
import MessagesScreen from './MessagesScreen';
import ContactsScreen from './ContactsScreen';
import SettingsScreen, { type PortalTelephonyPolicy } from './SettingsScreen';
import DeleteAccountScreen from './DeleteAccountScreen';
import PrivacyScreen from './PrivacyScreen';
import DataSafetyScreen from './DataSafetyScreen';
import PermissionsScreen from './PermissionsScreen';
import SupportScreen from './SupportScreen';
// Heavy/rare subpages — lazy-loaded so they don't bloat the main bundle.
const QueuesScreen  = lazy(() => import('./QueuesScreen'));
const FeaturesScreen = lazy(() => import('./FeaturesScreen'));
const SipDebugScreen = lazy(() => import('./SipDebugScreen'));
import ScreenSkeleton from '../components/ScreenSkeleton';
import { useTr, useT } from '../lib/i18n';


type Sub = null | 'voicemail' | 'messages' | 'contacts' | 'settings' | 'delete' | 'privacy' | 'datasafety' | 'permissions' | 'support' | 'queues' | 'features' | 'sipdebug';

export default function MoreScreen({
  creds, sp, onSignOut, haptic, portalTelephonyPolicy = null, voicemailPolicy,
}: { creds: Creds; sp: any; onSignOut: () => void; haptic: (s?: ImpactStyle) => Promise<void>; portalTelephonyPolicy?: PortalTelephonyPolicy | null; voicemailPolicy: 'enabled' | 'disabled' }) {
  const { tr } = useTr();
  const { tx } = useT();
  const [sub, setSub] = useState<Sub>(null);


  if (sub === 'voicemail')   return <SubPage onBack={() => setSub(null)} title={tr.more.voicemail}><VoicemailScreen haptic={haptic} voicemailPolicy={voicemailPolicy} /></SubPage>;
  if (sub === 'messages')    return <SubPage onBack={() => setSub(null)} title={tr.more.messages}><MessagesScreen haptic={haptic} /></SubPage>;
  if (sub === 'contacts')    return <SubPage onBack={() => setSub(null)} title={tr.more.contacts}><ContactsScreen sp={sp} /></SubPage>;
  if (sub === 'settings')    return <SubPage onBack={() => setSub(null)} title={tr.more.settings}><SettingsScreen creds={creds} sp={sp} onSignOut={onSignOut} portalTelephonyPolicy={portalTelephonyPolicy} /></SubPage>;
  if (sub === 'delete')      return <SubPage onBack={() => setSub(null)} title={tr.more.deleteAccount}><DeleteAccountScreen onDone={onSignOut} /></SubPage>;
  if (sub === 'privacy')     return <SubPage onBack={() => setSub(null)} title={tr.more.privacy}><PrivacyScreen /></SubPage>;
  if (sub === 'datasafety')  return <SubPage onBack={() => setSub(null)} title={tr.more.dataSafety}><DataSafetyScreen /></SubPage>;
  if (sub === 'permissions') return <SubPage onBack={() => setSub(null)} title={tr.more.permissions}><PermissionsScreen /></SubPage>;
  if (sub === 'support')     return <SubPage onBack={() => setSub(null)} title={tr.more.support}><SupportScreen /></SubPage>;
  if (sub === 'queues')      return <SubPage onBack={() => setSub(null)} title={tr.more.queues}><Suspense fallback={<ScreenSkeleton />}><QueuesScreen /></Suspense></SubPage>;
  if (sub === 'features')    return <SubPage onBack={() => setSub(null)} title={tr.more.callingFeatures}><Suspense fallback={<ScreenSkeleton />}><FeaturesScreen sp={sp} /></Suspense></SubPage>;
  if (sub === 'sipdebug')    return <SubPage onBack={() => setSub(null)} title="SIP Debug"><Suspense fallback={<ScreenSkeleton />}><SipDebugScreen sp={sp} /></Suspense></SubPage>;


  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 14px 20px' }}>
      <Card padded={true} accent="gold" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LemtelMark size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: font.md, fontWeight: 800, color: colors.textIce }}>{creds.displayName || creds.email}</span>
              <LemtelBadge compact />
            </div>
            <div style={{ fontSize: font.xs, color: colors.mutedSilver, marginTop: 3, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {creds.email} · Lemtel
            </div>
          </div>
        </div>
      </Card>

      <SectionTitle eyebrow={tr.more.eyebrowComms} title={tr.more.moreFeatures} />
      <Card padded={false}>
        <SettingsRow label={tr.more.callingFeatures} icon="☎" value={tr.more.callingFeaturesHint} onPress={() => setSub('features')} />
        <SettingsRow label={tr.more.voicemail} icon="✉" value={tr.more.voicemailHint} onPress={() => setSub('voicemail')} />
        <SettingsRow label={tr.more.messages} icon="💬" value={tr.more.messagesHint} onPress={() => setSub('messages')} />
        <SettingsRow label={tr.more.queues} icon="⇉" value={tr.more.queuesHint} onPress={() => setSub('queues')} />
        <SettingsRow label={tr.more.contacts} icon="👥" value={tr.more.contactsHint} onPress={() => setSub('contacts')} />
      </Card>

      <SectionTitle eyebrow={tr.more.eyebrowAccount} title={tr.more.settingsPrivacy} />
      <Card padded={false}>
        <SettingsRow label={tr.more.settings} icon="⚙" onPress={() => setSub('settings')} />
        <SettingsRow label={tr.more.permissions} icon="🔐" value={tr.more.permissionsHint} onPress={() => setSub('permissions')} />
        <SettingsRow label={tr.more.privacy} icon="🛡" value={tr.more.privacyHint} onPress={() => setSub('privacy')} />
        <SettingsRow label={tr.more.dataSafety} icon="🗂" value={tr.more.dataSafetyHint} onPress={() => setSub('datasafety')} />
        <SettingsRow
          label="SIP Debug"
          icon="🛰"
          value={sp?.snap?.status ? `● ${sp.snap.status}` : '—'}
          onPress={() => setSub('sipdebug')}
        />
        <SettingsRow label={tr.more.terms} icon="📄" onPress={() => openExternal('https://avastatistic.ca/terms')} />
        <SettingsRow label={tr.more.support} icon="❔" value="support@avastatistic.ca" onPress={() => setSub('support')} />
      </Card>

      <SectionTitle eyebrow={tr.more.eyebrowDanger} title={tr.more.accountControl} />
      <Card padded={false}>
        <SettingsRow label={tr.more.signOut} icon="⎋" onPress={onSignOut} />
        <SettingsRow label={tr.more.deleteAccount} icon="🗑" onPress={() => setSub('delete')} />
        {LEGACY_CONTACTS_ENABLED && (
        <SettingsRow
          label={tx('Supprimer mes contacts du serveur', 'Delete my contacts from server')}
          icon="🧹"
          value={tx('Retire vos contacts téléversés', 'Removes your uploaded contacts')}
          onPress={async () => {
            const ok = window.confirm(tx(
              'Ceci supprimera tous vos contacts téléversés de nos serveurs. L\'identification des appelants ne sera plus disponible. Continuer ?',
              'This will delete all your uploaded contacts from our servers. Caller ID matching will no longer be available. Continue?'
            ));
            if (!ok) return;
            const res = await deleteServerContacts(creds.userId);
            await revokeConsent();
            window.alert(res.ok
              ? tx('✅ Vos contacts ont été supprimés de nos serveurs.', '✅ Your contacts have been deleted from our servers.')
              : tx('Erreur : ', 'Error: ') + (res.error || 'unknown')
            );
          }}
        />
        )}
        {LEMTEL_PRIVATE_CONTACTS_UI_ENABLED && creds.userId && (
        <SettingsRow
          label={tx('Supprimer mes contacts privés Lemtel', 'Delete my Lemtel private contacts')}
          icon="🧹"
          value={tx('Retire vos contacts appareil et votre consentement', 'Removes device contacts and your consent')}
          onPress={async () => {
            const ok = window.confirm(tx(
              'Ceci supprimera uniquement les contacts appareil liés à votre compte Lemtel et retirera votre consentement. Continuer ?',
              'This deletes only device contacts linked to your Lemtel account and removes consent. Continue?'
            ));
            if (!ok) return;
            const res = await deleteLemtelDeviceContactsAndRevoke(creds.userId);
            window.alert(res.ok
              ? tx(`✅ ${res.deleted ?? 0} contacts privés supprimés.`, `✅ ${res.deleted ?? 0} private contacts deleted.`)
              : tx('Erreur : ', 'Error: ') + (res.error || 'unknown')
            );
          }}
        />
        )}
      </Card>


      <div style={{ textAlign: 'center', marginTop: 18, fontSize: 10, color: colors.mutedSilver }}>
        Lemtel Mobile
      </div>
      <div style={{ height: 80 }} />
    </div>
  );
}

function openExternal(url: string) {
  try { window.open(url, '_blank'); } catch {}
}

function SubPage({ onBack, title, children }: { onBack: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px 6px', borderBottom: `1px solid ${colors.border}`,
        background: colors.navSurface, backdropFilter: 'blur(14px)',
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', color: colors.lemtelBlue,
          fontSize: 18, fontWeight: 800, cursor: 'pointer', padding: '6px 8px',
        }}>‹</button>
        <span style={{ fontSize: font.md, fontWeight: 800, color: colors.textIce }}>{title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
