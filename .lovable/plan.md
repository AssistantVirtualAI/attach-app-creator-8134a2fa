## Objectif

Pour chaque appel d'un courtier Planiprêt (mobile iOS et Android), pousser automatiquement vers Maestro, sans action manuelle :
1. l'enregistrement audio (fichier uploadé directement),
2. la transcription,
3. le résumé IA + coaching + analytics (score de lead, sentiment, points clés, actions).

## État actuel (vérifié)

- Le trigger `trg_pp_auto_process_call` sur `planipret_phone_calls` appelle `pp-auto-process-call`, qui fait transcription (`pp-admin-transcribe`) + analyse (`pp-coach-call`) — **et ne pousse rien vers Maestro**.
- La chaîne Maestro existe (`maestro-cdr` → `maestro-transcript` → `maestro-ai-analysis`) mais n'est déclenchée que depuis `ns-webhook-receiver` sur l'événement d'enregistrement, et elle relance une 2e analyse Claude (double coût).
- `maestro-recording` ne fait que **lire** un enregistrement depuis Maestro. Aucun upload de l'audio vers Maestro n'existe.
- L'audio est déjà mis en cache dans le bucket privé `call-recordings` par `ns-get-recording` (`recording_storage_path` sur la ligne d'appel).

## Ce qui sera construit

### 1. Nouvelle fonction `maestro-recording-upload`
- Entrée : `{ call_id }`.
- Récupère les octets audio : `recording_storage_path` du bucket `call-recordings` sinon `ns-get-recording` (qui met aussi en cache).
- Upload direct multipart `POST /api/v1/calls/{maestro_call_id}/recording` avec le token OAuth du courtier (`getBrokerAuth`), fallback clé de compte.
- Idempotent : `metadata.maestro_recording_uploaded_at` sur la ligne d'appel; skip si déjà fait sauf `force`.
- Journalise via `pipelineLog` / `maestroSyncLog` / `setPipelineStep(..., 'recording', ...)`.

### 2. Nouvelle fonction `maestro-sync-call` (orchestrateur par appel)
Séquence unique, idempotente, appelée une fois par appel :
1. `maestro-cdr` (lookup client + CDR, si pas déjà `maestro_synced`)
2. `maestro-recording-upload`
3. push de la **transcription déjà stockée** (`transcript` produit par `pp-admin-transcribe`) vers `/api/v1/calls/{id}/transcript` — appel de `maestro-transcript` seulement si aucune transcription n'existe encore
4. push du **résumé/coaching existant** (`ai_summary`, `ai_coaching`, `ai_key_points`, `ai_sentiment`, `ai_client_insights`, `lead_score`, `lead_temperature`, `ai_tasks`) vers `/api/v1/calls/{id}/ai_summary` — pas de nouvel appel Claude
5. création des tâches Maestro pour les actions `high` (logique existante réutilisée)
6. marque `pipeline_state.maestro = done`, diffuse l'événement temps réel au mobile.

### 3. Branchement automatique
- `pp-auto-process-call` : à la fin (transcription et/ou analyse terminée), appelle `maestro-sync-call` en fire-and-forget.
- `pp-coach-call` : après écriture de l'analyse, appelle aussi `maestro-sync-call` (couvre le chemin où l'analyse se termine hors de `pp-auto-process-call`).
- `ns-webhook-receiver` : remplace l'appel direct `maestro-cdr` par `maestro-sync-call`.
- Résultat : identique sur iOS et Android, puisque tout se passe côté serveur à partir du CDR NetSapiens.

### 4. Rattrapage + visibilité
- Fonction `maestro-backfill-sync` : réexécute `maestro-sync-call` pour les appels des N derniers jours dont `maestro_synced` est faux ou dont l'upload/transcript/AI n'a pas été poussé (par lots, avec limite).
- Onglet Maestro existant du mobile (`MaestroTab.tsx`) : afficher 4 lignes d'état (CDR / Enregistrement / Transcription / Analyse IA) lues depuis `pipeline_state`, avec un bouton « Resynchroniser » appelant `maestro-sync-call` en `force`.

## Détails techniques

- Auth : toutes les fonctions valident le JWT et utilisent `service_role` en interne; les appels internes fonction→fonction utilisent la clé service.
- Token Maestro par courtier via `getBrokerAuth(admin, call.user_id)`, avec repli sur la clé de compte si le courtier n'est pas connecté à Maestro; l'échec est journalisé et l'appel reste en `pending` pour un rattrapage ultérieur.
- Idempotence : `maestro_synced`, `metadata.maestro_recording_uploaded_at`, `pipeline_state.{cdr,recording,transcript,ai,maestro}` — un ré-appel ne duplique rien et ne rappelle jamais Claude.
- Aucune modification de schéma requise (les colonnes `pipeline_state`, `metadata`, `maestro_*` existent déjà).
- Coût IA inchangé : réutilisation de l'analyse `pp-coach-call` existante.
