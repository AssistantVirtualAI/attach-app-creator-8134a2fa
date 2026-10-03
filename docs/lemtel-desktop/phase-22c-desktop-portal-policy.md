# Lemtel — Phase 22C : politiques du portail visibles dans le Desktop

Base de revue : `63c6d5b72`.

## Flux

Portail / FusionPBX (propriétaire des réglages) → fonction authentifiée `lemtel-client-config` → manifeste Desktop validé (`evaluateManifest(...) === "allowed"`) → hook `useLemtelDesktopClientConfig` (`manifest`) → `App.tsx` (`portalTelephonyPolicy = lifecycle.manifest?.telephonyPolicy ?? null`) → `SettingsPage` (prop `portalTelephonyPolicy`).

Types stricts dans `lemtelDesktopClientConfig.ts` : `RecordingPolicy = 'not_allowed' | 'user_allowed' | 'portal_managed'`, `BinaryPortalPolicy = 'enabled' | 'disabled'`. La validation stricte existante est inchangée.

## États visibles (informatifs, lecture seule)

Section « PORTAL / Portal policy », juste avant « CALLS / Call Settings » :

- Do not disturb: enabled / disabled
- Call forwarding: enabled / disabled
- Recording: not allowed / user allowed / portal managed
- Voicemail: enabled / disabled

Note : « Telephony settings are applied by the portal. Change them in the Lemtel portal. »

La carte (`data-testid="desktop-portal-policy"`) ne contient aucun bouton, interrupteur, champ, lien ni action.

## Exposition du manifeste

- `allowed` : manifeste validé et sauvegardé.
- Panne transitoire + cache valide : manifeste du cache.
- `pending_block`, `blocked`, `unavailable`, absence de session, manifeste invalide/expiré, `finalizeBlock()` : `null`.
- Aucun endpoint, `fetch`, timer, journal ou lecture de jeton ajouté ; corps d'inscription inchangé `{ action: 'register', platform: 'desktop', installationRef }`.

## Ce qui ne change pas

SIP, identifiants, URL WSS, routage, CDR, synchronisation, PBX, FusionPBX, Electron main/preload, `useSoftphone`, `jssipProvider`. Aucun Verto ; JsSIP/WebRTC reste l'unique pile.

## Usages de SettingsPage

- Application Desktop principale (`mobileSettings`) : reçoit la prop.
- `ConsoleLayout` : inchangé, rend `SettingsPage` sans politique (prop optionnelle, aucune carte).

## Limites

- Les préférences locales existantes (Auto Answer, Announce Call Recording) et les liens « Manage in portal » peuvent temporairement diverger de l'état affiché par le portail.
- La carte ne donne aucun droit d'écriture.
- La validation sur un vrai Mac/Desktop avant publication reste une phase distincte.
