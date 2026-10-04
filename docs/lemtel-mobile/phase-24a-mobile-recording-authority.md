# Lemtel — Phase 24A : autorité du portail sur l'enregistrement manuel (Mobile)

Base de revue : `51831e134`.

## Objectif

L'écran d'appel actif Mobile applique `telephonyPolicy.recordingPolicy`, issue du **manifeste de portail validé** (`lemtel-client-config` → `useLemtelMobileClientConfig`). C'est la seule source d'autorité : aucune inférence depuis le SIP, la plateforme, un stockage local, l'état d'enregistrement ou le réseau. Toute valeur absente, en chargement, en erreur, bloquée ou inattendue vaut `not_allowed`.

## Comportements visibles

| Politique | Bouton Record / Stop Rec | Texte passif (appel actif) | Voyant « Enregistrement en cours » |
|---|---|---|---|
| `user_allowed` | Affiché, comportement existant (`startRecord` / `stopRecord`) | Aucun | Affiché si l'appel est enregistré |
| `not_allowed` | Absent ; aucun chemin vers start/stop | « Enregistrement manuel non autorisé » / *Manual recording is not allowed* | Affiché si l'appel est enregistré |
| `portal_managed` | Absent ; aucun chemin vers start/stop | « Enregistrement géré par le portail » / *Recording managed in portal* | Affiché si l'appel est enregistré |

`portal_managed` n'arrête jamais un enregistrement en cours : le voyant passif reste, seul le bouton manuel disparaît. Le texte passif n'a ni lien, ni action, ni appel serveur. Les autres contrôles (muet, attente, clavier, transfert, ajout, parking, audio, AVA, haut-parleur manuel) sont inchangés.

## Ce qui ne change pas

Politiques PBX automatiques, démarrage/arrêt de l'enregistrement PBX, enregistrements existants, CDR, lecture d'enregistrements, voicemail, consentement local, Android/iOS natif, JsSIP, PJSIP, Verto (absent), FusionPBX, serveur, portail et Desktop.

## Tests

- `apps/ava-softphone-mobile/src/components/ActiveCallSheet.recordingPolicy.test.tsx` : 6 tests (trois politiques, voyant en `portal_managed`, valeurs absentes/invalides, contrôles non liés).
- `src/test/lemtelMobileRecordingAuthorityPhase24.test.ts` : garde de phase (5 chemins, condition exacte, aucun nouveau code réseau/signalisation).

## Limites

Aucune validation sur appareil physique ni appel PBX réel dans cette phase.
