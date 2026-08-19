# Planiprêt Task API — intégration mobile & AVA

## Architecture
```
UI mobile (TasksSection / TaskComposerSheet)
  └── usePlanipretTasks (cache local, realtime, optimistic)
        └── src/lib/planipret/tasks.ts  (supabase.functions.invoke)
              └── edge: planipret-task-api  ← seul point d'accès à l'API
                    ├── secrets serveur (PLANIPRET_ACCESS_TOKEN)
                    ├── idempotence : planipret_task_mutations
                    ├── projection : planipret_tasks_projection
                    └── audit : planipret_audit_log
AVA chat + voicebot → ava-tool-executor → planipret-task-api (mêmes permissions)
```
Le client React n'appelle **jamais** `client.planipret.com` directement.

## Endpoints officiels utilisés
- `POST /api/main/tasks` — création (`xid`, `type`, `date`, `notes` requis)
- `PUT /api/main/tasks/{taskId}` — modification
- `DELETE /api/main/tasks/{taskId}` — suppression logique

Aucun GET officiel : la liste passe par l'endpoint interne
`/users/{telecomUserId}/tasks`. Indisponible → `tasks_unavailable`, sinon repli
sur la projection locale.

## Format des dates
`YYYY-MM-DD HH:mm:ss` en **America/Toronto** (`toApiDateTime`). Le fuseau est
imposé côté serveur comme côté client via le module partagé
`supabase/functions/_shared/planipret-tasks.ts`.

## Outils AVA
`list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`.
`create_task`, `update_task` et `delete_task` exigent une confirmation
explicite (chat : `MUTATING_ACTIONS`; voix : `CONFIRM_REQUIRED`). Le rôle
assistant ne peut pas supprimer. Chaque mutation AVA diffuse un événement
realtime `tasks` qui rafraîchit l'accueil.

## Accueil mobile
Le bloc « Appels récents » est remplacé par « Mes tâches » (En retard /
Aujourd'hui / À venir) avec créer, modifier, reporter (+24 h) et supprimer.
L'historique d'appels reste intégralement dans l'onglet Appels; aucun code
VoIP/PJSIP/JsSIP n'a été modifié.

## Tests
`src/lib/__tests__/planipretTasks.test.ts` — formatage des dates, buckets,
cache local par utilisateur.
