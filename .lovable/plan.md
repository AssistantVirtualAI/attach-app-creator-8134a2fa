## Problème

Sur l'app mobile Planipret, la page **Enregistrements** :
- Fait juste l'upload audio, sans vraiment enchaîner transcript + IA de façon fiable.
- Associe parfois la transcription et l'analyse IA au **mauvais appel** (mismatch avec l'audio joué).
- N'utilise pas la même logique éprouvée que `/planipret/admin/recordings` (PARecordings).

### Cause racine

Dans `src/components/planipret/mobile/recordings/RecordingsList.tsx` :

1. Le helper `callDbId(c)` retourne `proxy_call_db_id ?? c.id`. Il est utilisé **à la fois** pour :
   - la résolution audio (correct — le proxy pointe vers la ligne qui a le fichier)
   - **et** pour `pp-admin-transcribe` / `pp-coach-call` (**incorrect** — la transcription et l'IA doivent être écrites sur la ligne affichée `c.id`, pas sur le proxy). Résultat : le transcript arrive sur un autre `id`, et la carte affiche celui d'un appel voisin.

2. La boucle `for (const call of queue)` traite les calls en série mais **ne se termine jamais proprement** en cas d'erreur intermédiaire, et ne re-tente pas de la même façon que le portail admin (backoff `transcript_pending`, retry `TRANSCRIPT_MISSING`, realtime UPDATE).

3. Aucune souscription realtime `postgres_changes` sur `planipret_phone_calls` pour rafraîchir la carte quand `pp-admin-transcribe` ou `pp-coach-call` écrit dans la DB (le portail admin le fait via `pa-call-${callId}`).

4. Aucune garde "voicemail" (les `vmail@` sont bruités et échouent — l'admin les filtre).

## Correctif

Refactorer uniquement `src/components/planipret/mobile/recordings/RecordingsList.tsx` pour reproduire fidèlement le pipeline du portail admin, en conservant l'UI mobile existante (cartes, pills, PipelineProgress, autoloader silencieux).

### 1. Séparer les identifiants

- `audioLookupId(c)` = `proxy_call_db_id ?? c.id` (pour `ns-get-recording` uniquement).
- `pipelineId(c)` = **toujours `c.id`** pour `pp-admin-transcribe` et `pp-coach-call`, de façon à ce que la ligne mise à jour en DB soit exactement celle de la carte.

### 2. Reprendre la séquence exacte du portail admin par appel

Pour chaque `call` de la file (top 15 avec audio résolvable, hors voicemails) :

1. **Audio** — `ns-get-recording` avec `call_db_id = audioLookupId`. Si `pending/processing`, backoff comme admin (15s → 30s → 60s → 120s, max 4 min), max ~4 tentatives, puis `error` silencieux.
2. **Transcript** — `pp-admin-transcribe` avec `call_id = pipelineId`. Gérer les 3 issues comme admin :
   - `ok + transcript` → merge dans l'état + `onUpdated`.
   - `pending` → replanifier avec backoff (15s·2^n).
   - autre → marquer `error` sans toast.
3. **IA / Coaching** — `pp-coach-call` avec `call_id = pipelineId` et `transcript` local (fallback si DB pas encore synchro, comme admin). Gérer `TRANSCRIPT_MISSING` → retry 3 s. Skip si `ai_coaching` déjà présent (cache).

Chaque étape est indépendante : si transcript échoue, on n'appelle pas l'IA ; si audio échoue, on tente quand même transcript/IA (utile pour les vieux appels sans MP3).

### 3. Realtime par carte visible

Souscrire un canal `postgres_changes UPDATE` sur `planipret_phone_calls filter id=eq.${call.id}` pour chaque carte ouverte (comme `pa-call-${callId}` dans admin), afin que les colonnes `transcript`, `ai_summary`, `ai_coaching`, `lead_score`, `lead_temperature` mettent à jour la carte instantanément quand une écriture arrive de n'importe quelle source.

### 4. Filtre voicemail

Exclure de la file d'auto-pipeline les appels dont `to_number` matche `vmail|voicemail|vm@` (aligné avec `PARecordings`).

### 5. Cache & garde-fous

- `autoPipelineDoneRef` conservé, mais réinitialisé quand un appel repasse en erreur pour permettre un retry manuel via le bouton "retry audio" déjà présent.
- Toujours écrire via `onUpdated` avec `{ ...call, ... }` en gardant le même `id`, pour ne jamais déplacer les données vers une autre carte.

## Détails techniques

- Fichier modifié : `src/components/planipret/mobile/recordings/RecordingsList.tsx` (uniquement — pas de changement DB, pas de nouvelle edge function, pas de changement admin).
- Aucune modification du parent `MRecordings` / `MHome`.
- Aucune modification de `pp-admin-transcribe`, `pp-coach-call`, `ns-get-recording` (déjà corrects côté admin).
- La barre déjà retirée reste retirée ; l'autoloader silencieux (sans toast) est conservé.
- L'UI (cartes, pills, `PipelineProgress`, `AudioStatusBadge`) n'est pas touchée visuellement.

## Vérification

Après implémentation, ouvrir `/planipret/mobile/recordings`, laisser tourner 30 s, puis vérifier via Playwright + `supabase--read_query` que pour 3 cartes :
- `transcript` correspond bien au bon `id` (jointure `planipret_phone_calls` sur `id`, comparaison à la carte affichée),
- `ai_summary` et `lead_score` sont cohérents avec ce transcript,
- Aucun appel voicemail n'apparaît en boucle d'échec dans la console.
