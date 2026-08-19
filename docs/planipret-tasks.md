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

## Rôles
- `admin`, `broker`, `advisor` : lecture, création, modification, suppression.
- `assistant` : lecture, création, modification. **Suppression refusée côté
  serveur** (`role_forbidden`), avant tout appel à Planiprêt.

## Idempotence et audit
Chaque mutation calcule une clé déterministe (`idempotencyKey`) enregistrée dans
`planipret_task_mutations`. Un double tap, un retry réseau ou un tool-call AVA
rejoué renvoient la première réponse avec `replayed: true` — aucune seconde
écriture. Chaque action écrit dans `planipret_audit_log` : outil, source,
session AVA, `task_id`, statut HTTP, résultat et `correlation_id` — jamais le
contenu des notes.

## Limites de l'endpoint de liste
Planiprêt n'expose aucun GET public. La passerelle sonde, dans l'ordre :
`/telecom/api/v1/users/{id}/tasks`, `/telecom/api/v1/users/{id}/tasks` sur la
base principale, puis `/api/main/tasks?xid=…&type=user`. Si tout répond
404/405/501, la réponse est `source: "projection"` (dernier état connu) ou
`source: "unavailable"` avec `error: "tasks_unavailable"`. **Reste en attente
d'une documentation officielle Planiprêt.**

## Tests
- `src/lib/__tests__/planipretTasks.test.ts` — dates, buckets, cache par user.
- `src/test/planipretTaskHandler.test.ts` — passerelle : create/update/delete,
  422 sans notes, `xid` hors périmètre, token expiré, rôle assistant,
  isolation multi-tenant, `tasks_unavailable`, idempotence (double tap, retry,
  concurrence), audit sans notes.
- `src/test/avaTaskTools.test.ts` — schémas des 5 outils AVA et barrières de
  confirmation partagées chat/voix (`src/lib/planipret/avaMutations.ts`).
- `src/test/tasksSection.test.tsx` — buckets, vide, offline, erreur + Réessayer,
  bouton `+`, report, suppression confirmée/annulée, refresh realtime, filtres.
- `src/test/tasksHomeRegression.test.ts` — onglet Appels intact, aucun secret
  côté client, tout passe par `planipret-task-api`.
