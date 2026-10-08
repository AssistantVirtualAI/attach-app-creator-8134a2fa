import React from 'react';
import { colors, font } from '../lib/theme';
import { Card, SectionTitle } from '../components/ui/Primitives';
import { useT } from '../lib/i18n';

export default function PrivacyScreen() {
  const { lang, tx } = useT();
  const fr = lang === 'fr';
  const sections = fr ? [
    { title: '1. Compte et organisation', items: [['Collecté', 'Adresse courriel, nom affiché, rôle et organisation active.'], ['Finalité', 'Authentification, accès à votre organisation et soutien.'], ['Conservation', 'Jusqu’à la fermeture du compte, selon les règles de votre organisation.']] },
    { title: '2. Appels et historique', items: [['Collecté', 'Métadonnées d’appel : direction, heure, durée et état.'], ['Finalité', 'Afficher l’historique, les appels manqués et les alertes.'], ['Accès', 'Limité à votre organisation et à votre rôle authentifiés.']] },
    { title: '3. Enregistrements audio', items: [['Accès', 'La lecture est vérifiée à chaque demande par le chemin authentifié Lemtel.'], ['Appareil', 'L’audio est diffusé à la demande; il n’est pas conservé par défaut sur l’appareil.'], ['Contrôle', 'Votre organisation définit la politique d’enregistrement et de conservation.']] },
    { title: '4. Aucune transcription IA mobile', items: [['Engagement', 'Cette application mobile ne demande pas, ne génère pas et ne présente pas de transcription ou d’analyse IA d’appels.'], ['Portail', 'Toute politique d’organisation distincte est gérée par les administrateurs dans le portail, jamais par une commande de l’application mobile.']] },
  ] : [
    { title: '1. Account and organization', items: [['Collected', 'Email address, display name, role, and active organization.'], ['Purpose', 'Authentication, organization access, and support.'], ['Retention', 'Until account closure, subject to organization rules.']] },
    { title: '2. Calls and history', items: [['Collected', 'Call metadata: direction, time, duration, and status.'], ['Purpose', 'Show history, missed calls, and alerts.'], ['Access', 'Limited to your authenticated organization and role.']] },
    { title: '3. Recording audio', items: [['Access', 'Playback is checked for every request through the authenticated Lemtel path.'], ['Device', 'Audio streams on demand and is not retained on the device by default.'], ['Control', 'Your organization defines the recording and retention policy.']] },
    { title: '4. No mobile AI call transcription', items: [['Commitment', 'This mobile application does not request, generate, or display AI call transcription or analysis.'], ['Portal', 'Any separate organization policy is managed by administrators in the portal, never by a mobile app command.']] },
  ];

  return (
    <div style={{ padding: 16, overflowY: 'auto', paddingBottom: 120 }}>
      <SectionTitle eyebrow={tx('Confidentialité', 'Privacy')} title={tx('Vos données dans Lemtel', 'Your data in Lemtel')} />
      <Card padded={true}>
        <p style={{ fontSize: font.sm, color: colors.textSub, lineHeight: 1.6, margin: 0 }}>
          {tx('Lemtel applique le principe de confidentialité dès la conception : seules les données nécessaires au service de communication sont utilisées, les organisations restent isolées, et vos données ne sont jamais vendues à des annonceurs.', 'Lemtel follows privacy by design: only data needed for communication service is used, organizations remain isolated, and your data is never sold to advertisers.')}
        </p>
      </Card>
      {sections.map((section) => (
        <Card key={section.title} padded={true}>
          <h3 style={{ color: colors.textIce, fontSize: font.md, margin: '0 0 10px', fontWeight: 800 }}>{section.title}</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {section.items.map(([label, detail]) => (
              <div key={label} style={{ padding: '9px 10px', border: `1px solid ${colors.border}`, borderRadius: 10, background: `${colors.lemtelBlue}08` }}>
                <div style={{ color: colors.lemtelBlue, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ marginTop: 3, color: colors.textSub, fontSize: font.sm, lineHeight: 1.48 }}>{detail}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <Card padded={true}>
        <p style={{ margin: 0, color: colors.textSub, fontSize: font.sm, lineHeight: 1.6 }}>
          {tx('Pour toute question ou demande relative à vos données : ', 'For any data question or request: ')}<a href="mailto:privacy@avastatistic.ca" style={{ color: colors.lemtelBlue }}>privacy@avastatistic.ca</a>
        </p>
      </Card>
    </div>
  );
}
