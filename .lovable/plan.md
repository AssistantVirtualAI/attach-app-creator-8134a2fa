## Objectif

Après chaque analyse IA d'un appel Planiprêt, envoyer automatiquement le **summary** et l'**analyse complète** vers l'API Télécom Maestro, associés à l'appel du bon agent (broker). Aujourd'hui `ai-analyze-call` remplit `planipret_phone_calls.ai_summary` / `ai_analysis_json` et insère dans `planipret_ai_insights`, mais rien n'est miroré vers Maestro.

## Approche

Réutiliser l'infra existante (`maestroTelecomMirror` — retry + backoff + `planipret_maestro_sync_log`) pour envoyer un `PUT /users/{maestro_broker_id}/calls/{maestro_call_id}` avec les champs d'analyse, dès que `ai-analyze-call` termine avec succès.

Aucun changement front. Zéro impact sur NS-API (fire-and-forget silencieux).

## Étapes

1. **Helper `mirrorCallAnalysisToMaestro`** dans `supabase/functions/_shared/maestro-telecom.ts` :
   - Prend `admin`, `userId`, `ppCall` (row `planipret_phone_calls`), `analysis`, `insights` (summary court/long, coaching, topics, next_steps, sentiment, lead_score/temperature, key_info).
   - Récupère `maestro_broker_id` (via `getMaestroBrokerId`) et `maestro_call_id` sur la row.
   - **Skip silencieux** si l'un des deux est absent (log warn, pas d'erreur).
   - Envoie deux appels miroir :
     - `PUT /users/{broker}/calls/{maestro_call_id}` avec un payload structuré :
       ```
       {
         ai_summary, ai_summary_short, ai_analysis, ai_coaching,
         ai_next_actions, ai_topics, sentiment,
         lead_score, lead_temperature, lead_reason,
         transcript_language, model, analyzed_at
       }
       ```
     - `POST /users/{broker}/call/{maestro_call_id}/notes` (fallback si l'API refuse les champs custom sur PUT) avec le résumé lisible — activé via un flag interne, désactivé par défaut pour ne pas dupliquer.
   - Actions log : `call.analysis.summary`, `call.analysis.details`.

2. **Hook dans `supabase/functions/ai-analyze-call/index.ts`** :
   - Après le `INSERT` dans `planipret_ai_insights` (ligne 391), appeler `mirrorCallAnalysisToMaestro(admin, ppCall.user_id, ppCall, analysis, { summary, coaching, leadA, ... })`.
   - Reste fire-and-forget, jamais dans le `try/catch` critique.

3. **Nouvelle action admin `resync-analysis`** dans `pp-maestro-admin` :
   - Body `{ action: "resync-analysis", call_id?, since_hours?=72, limit?=100 }`.
   - Sélectionne les rows `planipret_phone_calls` avec `ai_analysis_json IS NOT NULL AND maestro_call_id IS NOT NULL` (filtrées par `call_id` ou `analyzed_at >= since`) et rejoue `mirrorCallAnalysisToMaestro`.
   - Utile pour rattraper les analyses historiques.

4. **Page admin `PAMaestroSync`** :
   - Ajouter un bouton "Resynchroniser analyses (72h)" à côté de "Actualiser" qui invoque `resync-analysis`.
   - Ajouter dans la vue "Répartition par action" les nouvelles clés `call.analysis.summary` / `.details` (aucune modif nécessaire, le tableau est déjà générique).

5. **Diagnostics mobile (`MDiagnostics`)** :
   - Ajouter une sous-ligne "Dernier miroir d'analyse IA" alimentée par le dernier enregistrement `planipret_maestro_sync_log` avec `action LIKE 'call.analysis.%'` (via extension de `pp-maestro-admin status`).

## Détails techniques

- Aucune migration SQL — tout se joue en edge functions ; `planipret_maestro_sync_log` existe déjà et absorbera les nouvelles actions.
- `maestro_call_id` est renseigné par le miroir `call.started/ended` déjà en place ; si absent (appel antérieur à l'intégration), le mirror log l'entrée avec `error: "no_maestro_call_id"` en `success=false` pour rester visible côté admin.
- Payload envoyé en camelCase-lite (snake_case) conforme aux autres actions Maestro Télécom du projet.
- Timeouts par défaut du helper (8s, 3 tentatives) suffisants pour un PUT léger.

## Fichiers touchés

- `supabase/functions/_shared/maestro-telecom.ts` — ajout `mirrorCallAnalysisToMaestro`
- `supabase/functions/ai-analyze-call/index.ts` — appel du helper après persistance
- `supabase/functions/pp-maestro-admin/index.ts` — action `resync-analysis`
- `src/pages/planipret/admin/PAMaestroSync.tsx` — bouton "Resynchroniser analyses"
- `apps/planipret-mobile/src/pages/planipret/mobile/MDiagnostics.tsx` — ligne "Dernier miroir analyse IA"
