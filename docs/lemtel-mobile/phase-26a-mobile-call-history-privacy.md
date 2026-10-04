# Lemtel — Phase 26A : confidentialité Mobile de l’historique d’appels

Base : `72f11a93b`.

## Portail vs clients

- **Portail Lemtel** : seul endroit des vues administratives multi-utilisateurs.
- **Clients Lemtel (Mobile)** : données privées de l’extension connectée uniquement (`own_extension_only`), y compris pour un administrateur.

## Filtrage serveur existant

`mobile-calls` impose déjà l’extension de l’utilisateur connecté. `mobileApi.calls()` n’envoie plus que `days` et `limit` ; aucun appelant Mobile ne peut choisir une autre extension. La fonction serveur n’est pas modifiée.

## Défense en profondeur locale

- `useRealtimeCDR(creds, rangeDays)` : plus de filtre d’extension, plus de `dataScope`/admin/organisation. Canal `cdr-ext-<ext>` filtré `extension=eq.<ext>` ; toute ligne Realtime d’une autre extension est ignorée. Sans extension : aucun canal, transport `idle`, message neutre.
- `CallsScreen` (Historique) : sélecteur d’extensions, liste du domaine et lecture `pbx_extensions_directory` retirés ; filtrage local sur l’extension personnelle pour tous ; indication non cliquable « mon extension ».
- `useDeviceNotifications` : canal CDR créé seulement avec une extension, filtre `extension=eq.<ext>` ; aucun repli organisationnel. SMS, messagerie vocale et enregistrements inchangés (revue séparée).

## Inchangé

Polling 15 s, backoff, nettoyage, premier plan, relance ; cadran, `sp.call()`, JsSIP seul propriétaire SIP Android, enregistrements, audio, permissions. Aucune fonction, migration, base, portail, Desktop, natif, PBX/FusionPBX, publication ni appel réel.
