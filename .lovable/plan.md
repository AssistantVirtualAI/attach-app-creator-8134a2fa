# Traitement complet des enregistrements d'appels

## Objectif
1. Traiter les **806 appels** existants (dont 15 avec enregistrement non transcrits/analysés) en batch.
2. Déclencher automatiquement le pipeline (récupération enregistrement → transcription → analyse Claude) pour **tout nouvel appel** dès qu'il apparaît.

## Étapes

### 1. Backfill des appels existants
- Nouvelle edge function `pp-admin-backfill-calls` qui :
  - Liste tous les `planipret_phone_calls` où `has_recording = true` ET (`transcript` vide OU `analyzed_at` null), par lots de 10.
  - Pour chaque appel, invoque `pp-admin-transcribe` (récupère transcript NetSapiens → fallback Whisper) puis `pp-coach-call` (analyse Claude, failover Lovable AI).
  - Traite en concurrence limitée (3 en parallèle) pour éviter les rate limits.
  - Retourne un rapport `{ processed, succeeded, failed[] }`.
- Bouton **"Traiter tous les enregistrements"** dans `PARecordings.tsx` (web + mobile) qui appelle cette fonction avec toast de progression.

### 2. Auto-traitement des nouveaux appels
- Trigger DB `AFTER INSERT OR UPDATE OF has_recording ON planipret_phone_calls` : quand `has_recording` passe à `true` et `analyzed_at IS NULL`, insère une ligne dans une queue `planipret_ai_processing_queue` (statut `pending`).
- Nouvelle edge function `pp-process-call-queue` (invoquée par pg_cron toutes les minutes) qui draine la queue (10 items/exécution) en appelant `pp-admin-transcribe` puis `pp-coach-call`.
- Alternative plus simple si acceptable : utiliser directement le trigger DB avec `pg_net.http_post` pour invoquer `pp-coach-call` de manière asynchrone (pas de nouvelle table).

## Détails techniques
- Modèle IA : **Claude (`ANTHROPIC_API_KEY`)** en principal, **Lovable AI Gateway (`google/gemini-2.5-pro`)** en failover — déjà en place dans `pp-coach-call`.
- Source transcription : `ns-get-transcription` (NetSapiens) → fallback Whisper via `ai-transcribe-call`.
- Idempotence : les fonctions vérifient `analyzed_at` et `analysis_in_progress` avant retraiter (déjà géré par le lock existant).
- Rate limit : concurrence max 3, délai 500ms entre lots.

## Question
Préfères-tu l'**Option A** (queue + cron toutes les minutes, robuste et retryable) ou l'**Option B** (trigger DB → `pg_net.http_post` direct, plus simple mais sans retry automatique) pour l'auto-traitement des nouveaux appels ?
