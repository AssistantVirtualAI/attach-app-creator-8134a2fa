# Lemtel — Phase 24B : autorité du portail sur l'enregistrement manuel (Desktop)

Base de revue : `06c5a0197`.

## Source unique

Le **manifeste de portail validé** (`useLemtelDesktopClientConfig`, inchangé) fournit `telephonyPolicy.recordingPolicy`. `App.tsx` la normalise strictement (`user_allowed` / `portal_managed`, tout le reste → `not_allowed`) et la transmet à `SipKeepAlive` par un contexte React local à `App.tsx` (`RecordingPolicyContext`, défaut `not_allowed`) → instance unique `useSoftphone`. Le contexte remplace une prop afin de garder intacte la balise `<SipKeepAlive creds={creds} allowNewActions={lifecycleAllowed}>` vérifiée par le test historique 21B. Aucune inférence depuis le SIP, l'état d'enregistrement, le stockage local, la plateforme ou le réseau.

## Comportements

| Politique | Bouton Record / Stop | Message passif (`desktop-recording-policy-note`) | Voyant `desktop-recording-indicator` |
|---|---|---|---|
| `user_allowed` | Affiché, comportement existant | Aucun | Si `sp.recording` |
| `not_allowed` | Absent | `Manual recording is not allowed` | Si `sp.recording` |
| `portal_managed` | Absent | `Recording managed in portal` | Si `sp.recording` |
| absent / invalide | Absent | `Manual recording is not allowed` | Si `sp.recording` |

## Défense en profondeur

- UI : le bouton n'est rendu que pour `user_allowed` ; le message passif n'a ni bouton, ni lien, ni action ; aucun raccourci clavier.
- Hook : la première instruction de `toggleRecording` refuse l'action si la politique n'est pas exactement `user_allowed`. Aucun changement d'état, aucun DTMF `*2`, aucun relais historique PBX ne part, même appelé hors UI.
- `user_allowed` : DTMF `*2` puis relais historique inchangés.

Le voyant d'enregistrement en cours reste visible sous les trois politiques ; il n'est jamais cliquable et n'arrête rien.

## Ce qui ne change pas

Appels, SIP, JsSIP, Electron, FusionPBX, enregistrements automatiques, CDR, lecture des enregistrements, voicemail, Mobile, Planiprêt et portail. Autres contrôles (muet, attente, clavier, transferts, DTMF, sortie audio, raccrochage) inchangés.

## Limites

Aucun test sur un appel PBX réel ni sur un vrai Mac/Windows dans cette phase.
