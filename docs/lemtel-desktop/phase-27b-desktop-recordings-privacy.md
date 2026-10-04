# Lemtel — Phase 27B : confidentialité Desktop des enregistrements

Base : `c84166455`.

## But

Le softphone Desktop (*Calls → Recordings*) n'affiche que les enregistrements de l'extension de la session authentifiée, y compris pour un administrateur. Parité avec 26B (historique Desktop) et 27A (enregistrements Mobile).

## Périmètre

`RecordingsList.tsx`, `SoftphonePane.tsx` (commentaire seulement, appel inchangé `<RecordingsList extension={creds.extension} />`), `avaApi.ts`, le test composant, le test racine et ces deux documents.

## Implémentation

- `avaApi` : `ava.personalRecordings(limit, { rangeDays })` et `ava.refreshPersonalRecordings(limit, { rangeDays })`. Extension résolue uniquement par `getMeContext()`; aucun paramètre d'extension, d'organisation, de domaine ou de portée. Sans extension : `[]`, aucune lecture. Réutilise la lecture et la synchronisation best-effort existantes; aucune écriture.
- `RecordingsList` : la prop `extension` sert seulement de garde locale et de filtre défensif (`isOwnRecording` : extension, caller/destination/source number, from, to). Sans extension : liste vide, aucun appel, aucun canal, message d'attente.
- Changement d'extension : données, erreurs, statuts et URL audio effacés immédiatement; réponse tardive de l'ancienne extension ignorée.
- Cache audio : vidé au changement d'extension et au démontage; une URL temporaire ne passe jamais d'une session à l'autre.
- Realtime : canal `rt-recordings-extension-<ext>`, filtre `extension=eq.<ext>`, `INSERT`/`UPDATE` seulement, vérification locale de la ligne et du caractère « enregistrement », debounce 2 s, throttle 5 s, nettoyage au changement/démontage. `useOrgId`/`useRealtimeRefresh` retirés.
- Le champ de domaine n'est plus transmis à la transcription : la fonction serveur le relit depuis la fiche d'appel.

## Console administrative

`components/console/RecordingsView.tsx` et les méthodes générales `ava.recordings` / `ava.refreshRecordings` sont inchangées.

## Validations

Test composant (7) exécuté avec une configuration temporaire hors dépôt (dépendances Desktop absentes); test racine; garde d'isolation.

## Limites

Le serveur/RLS reste l'autorité finale; le filtrage client est une défense en profondeur. Aucun essai sur un vrai Mac/Windows ni appel PBX réel. Borne figée à fixer en 27B.1.
