# Lemtel — Phase 22B : consommation Mobile en lecture seule des politiques du portail

Base de revue : `44c8b22e9`.

## Flux

Portail / FusionPBX (propriétaire des réglages) → fonction authentifiée `lemtel-client-config` → manifeste validé par `evaluateManifest(...) === "allowed"` → hook `useLemtelMobileClientConfig` (`manifest`) → `MobileApp` (`portalTelephonyPolicy = clientConfig.manifest?.telephonyPolicy ?? null`) → `SettingsScreen` (onglet Réglages) et `MoreScreen` → son `SettingsScreen` interne.

Seuls quatre libellés déjà validés traversent cette chaîne : `dndState`, `forwardingState`, `recordingPolicy`, `voicemailPolicy`. Aucune identité, appareil, révision, jeton, URL ou identifiant SIP n'est transmis aux écrans.

## États présentés (informatifs, lecture seule)

| Champ | FR | EN |
| --- | --- | --- |
| dndState | Ne pas déranger : activé / désactivé | Do not disturb: enabled / disabled |
| forwardingState | Transfert d’appels : activé / désactivé | Call forwarding: enabled / disabled |
| recordingPolicy | Enregistrement : non autorisé / autorisé à l’utilisateur / géré par le portail | Recording: not allowed / user allowed / portal managed |
| voicemailPolicy | Boîte vocale : activée / désactivée | Voicemail: enabled / disabled |

Note affichée : « Les réglages téléphoniques sont appliqués par le portail. Modifiez-les dans le portail Lemtel. »

La carte ne contient aucun bouton, interrupteur ni champ, et n'appelle jamais `mobileApi`. Sans politique (configuration manuelle, ancienne session, tests), la carte n'apparaît pas.

## Exposition du manifeste

- `allowed` : `manifest` = manifeste validé et sauvegardé.
- Panne transitoire avec cache valide : `manifest` = manifeste du cache.
- `pending_block`, `blocked`, `unavailable`, absence de session, `finalizeBlock()` : `manifest = null`.
- Aucun appel réseau, timer, lecture d'identifiants ou journal ajouté. Rafraîchissement au premier plan toujours limité à 900 s minimum.

## Ce qui ne change pas

État SIP, identifiants, URL WSS, routage, signalisation, commutateurs DND/transfert existants, Click-to-Call, sonnerie, audio, permissions. Android : JsSIP/WebView reste seul propriétaire WSS/REGISTER/signalisation. Aucun Verto.

## Limites

- L'application ne peut pas modifier une politique du portail par ce flux ; une future phase définira les permissions d'écriture.
- Les anciens commutateurs locaux DND/transfert peuvent temporairement afficher un état différent de la carte du portail.
- Le test sur appareil physique iOS/Android reste une phase distincte, obligatoire avant toute publication Store.
