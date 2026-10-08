import React from 'react';
import { colors, font, radius } from '../lib/theme';
import { Card, SectionTitle } from '../components/ui/Primitives';
import { useT } from '../lib/i18n';

type Row = { type: string; purpose: string; retention: string; optional: boolean };

export default function DataSafetyScreen() {
  const { lang, tx } = useT();
  const fr = lang === 'fr';
  const rows: Row[] = fr ? [
    { type: 'Adresse courriel', purpose: 'Connexion et récupération du compte', retention: 'Durée du compte', optional: false },
    { type: 'Nom affiché', purpose: 'Identification dans votre organisation', retention: 'Durée du compte', optional: false },
    { type: 'Jeton de notification', purpose: 'Alerte d’appel entrant et messagerie vocale', retention: 'Jusqu’à la déconnexion', optional: false },
    { type: 'Historique d’appels', purpose: 'Afficher vos appels récents', retention: 'Politique PBX de l’organisation', optional: false },
    { type: 'Audio d’enregistrement', purpose: 'Lecture autorisée selon la politique de l’organisation', retention: 'Politique de l’organisation', optional: true },
    { type: 'Contacts appareil', purpose: 'Recherche de noms dans le répertoire', retention: 'Sur l’appareil seulement', optional: true },
    { type: 'Diagnostics techniques', purpose: 'Fiabilité et soutien de l’application', retention: '90 jours', optional: true },
  ] : [
    { type: 'Email address', purpose: 'Sign-in and account recovery', retention: 'Account lifetime', optional: false },
    { type: 'Display name', purpose: 'Identification inside your organization', retention: 'Account lifetime', optional: false },
    { type: 'Push token', purpose: 'Incoming-call and voicemail alerts', retention: 'Until sign-out', optional: false },
    { type: 'Call history', purpose: 'Show your recent calls', retention: 'Organization PBX policy', optional: false },
    { type: 'Recording audio', purpose: 'Authorized playback under organization policy', retention: 'Organization policy', optional: true },
    { type: 'Device contacts', purpose: 'Name search in the directory', retention: 'On device only', optional: true },
    { type: 'Technical diagnostics', purpose: 'Application reliability and support', retention: '90 days', optional: true },
  ];

  const permissions = fr ? [
    ['Microphone', 'Passer et recevoir des appels'],
    ['Notifications', 'Avertir des appels entrants et messages vocaux'],
    ['Contacts', 'Afficher les noms enregistrés dans votre appareil'],
    ['Rafraîchissement arrière-plan', 'Maintenir l’état de l’application'],
  ] : [
    ['Microphone', 'Place and receive calls'],
    ['Notifications', 'Alert for incoming calls and voicemail'],
    ['Contacts', 'Show names saved on your device'],
    ['Background refresh', 'Maintain application state'],
  ];

  return (
    <div style={{ padding: 16, overflowY: 'auto', paddingBottom: 120 }}>
      <SectionTitle eyebrow="LEMTEL" title={tx('Résumé de confidentialité', 'Privacy summary')} />
      <Card padded={true} style={{ background: `${colors.mint}0d`, border: `1px solid ${colors.mint}38` }}>
        <p style={{ fontSize: font.sm, color: colors.textSub, lineHeight: 1.6, margin: 0 }}>
          {tx(
            'L’application mobile Lemtel ne demande pas, ne génère pas et n’affiche pas de transcription ou d’analyse IA d’appels. Les appels et données d’organisation sont chiffrés en transit et restent isolés par organisation.',
            'The Lemtel mobile app does not request, generate, or display AI call transcription or analysis. Calls and organization data are encrypted in transit and remain isolated by organization.',
          )}
        </p>
      </Card>

      <SectionTitle eyebrow={tx('Données', 'Data')} title={tx('Données traitées par l’application', 'Data handled by the app')} />
      <Card padded={false}>
        {rows.map((row, index) => <DataRow key={row.type} row={row} first={index === 0} optionalLabel={tx('Optionnel', 'Optional')} requiredLabel={tx('Requis', 'Required')} />)}
      </Card>

      <SectionTitle eyebrow={tx('Autorisations', 'Permissions')} title={tx('Vous gardez le contrôle', 'You remain in control')} />
      <Card padded={false}>
        {permissions.map(([name, detail], index) => (
          <div key={name} style={{ padding: '13px 14px', borderTop: index ? `1px solid ${colors.border}` : 'none' }}>
            <div style={{ color: colors.textIce, fontSize: font.sm, fontWeight: 800 }}>{name}</div>
            <div style={{ color: colors.textSub, marginTop: 3, fontSize: font.xs, lineHeight: 1.45 }}>{detail}</div>
          </div>
        ))}
      </Card>

      <SectionTitle eyebrow={tx('Sécurité', 'Security')} title={tx('Mesures de protection', 'Protection measures')} />
      <Card padded={true}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: font.sm, color: colors.textSub, lineHeight: 1.7 }}>
          <li>{tx('Trafic chiffré par HTTPS et WSS sécurisé.', 'Traffic encrypted through HTTPS and secure WSS.')}</li>
          <li>{tx('Accès limité à l’organisation et au rôle authentifiés.', 'Access limited to the authenticated organization and role.')}</li>
          <li>{tx('Lecture audio vérifiée à chaque demande.', 'Audio playback checked on every request.')}</li>
          <li>{tx('Sessions et jetons supprimables en vous déconnectant.', 'Sessions and tokens removable by signing out.')}</li>
        </ul>
      </Card>

      <p style={{ color: colors.mutedSilver, fontSize: font.xs, lineHeight: 1.5, margin: '14px 4px 0' }}>
        {tx('Questions de confidentialité : ', 'Privacy questions: ')}<a href="mailto:privacy@avastatistic.ca" style={{ color: colors.lemtelBlue }}>privacy@avastatistic.ca</a>
      </p>
    </div>
  );
}

function DataRow({ row, first, optionalLabel, requiredLabel }: { row: Row; first: boolean; optionalLabel: string; requiredLabel: string }) {
  return (
    <div style={{ padding: '13px 14px', borderTop: first ? 'none' : `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, color: colors.textIce, fontSize: font.sm, fontWeight: 800 }}>{row.type}</span>
        <span style={{ color: row.optional ? colors.avaCyan : colors.signalGold, fontSize: 9, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', padding: '3px 7px', borderRadius: radius.pill, border: `1px solid ${row.optional ? colors.avaCyan : colors.signalGold}55` }}>{row.optional ? optionalLabel : requiredLabel}</span>
      </div>
      <div style={{ color: colors.textSub, fontSize: font.xs, lineHeight: 1.45, marginTop: 5 }}>{row.purpose}</div>
      <div style={{ color: colors.mutedSilver, fontSize: 10, marginTop: 5 }}>{row.retention}</div>
    </div>
  );
}
