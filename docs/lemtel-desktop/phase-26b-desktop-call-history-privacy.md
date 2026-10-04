# Lemtel — Phase 26B : confidentialité Desktop de l’historique d’appels

Base : `8f93abed1`.

## Séparation

- **Softphone Desktop personnel (`RecentsList`)** : `own_extension_only`, y compris pour un administrateur.
- **Console administrative Desktop (`components/console/`)** : hors phase, comportement inchangé (méthodes générales `ava.calls`, `ava.refreshCalls`, `ava.scopedCallRecords` conservées).

## Implémentation

- `avaApi` : `ava.personalCalls(limit, { rangeDays })` et `ava.refreshPersonalCalls(limit, { rangeDays })`. Extension résolue uniquement par `getMeContext()`; aucun paramètre d’extension, de portée ou d’organisation. Sans extension : liste vide, aucune lecture CDR.
- `RecentsList` : appelle seulement les méthodes personnelles; filtre local défensif `isOwnRow` (extension, caller/destination/source number, from, to); canal Realtime `rt-pbx_call_records-extension-<ext>` filtré `extension=eq.<ext>` (INSERT/UPDATE/DELETE), rejet des lignes étrangères, debounce 300 ms, throttle 1 000 ms, nettoyage au démontage; plus de `useOrgId`/`useRealtimeRefresh`; sans extension : aucune lecture, aucun canal, message d’attente; indication non cliquable « My extension ».

## Autorité

Le serveur/RLS existant reste l’autorité finale et n’est pas modifié. Le filtrage client est une défense en profondeur.

## Inchangé

Console admin, enregistrements, messagerie vocale, SMS, appels, audio, transfert, DTMF, JsSIP (seul moteur SIP), Electron, fonctions, migrations, Planiprêt.
