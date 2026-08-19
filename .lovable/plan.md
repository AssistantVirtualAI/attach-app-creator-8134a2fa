# Planiprêt Task API — finalisation et couverture de tests

## État actuel (vérifié dans le code)

Déjà en place et fonctionnel :

- Passerelle serveur `planipret-task-api` : actions `list | get | create | update | delete`, clé d'idempotence par mutation (rejeu = même résultat), `correlation_id`, audit, erreurs structurées, repli sur projection locale (`source: api | projection | unavailable`), contrôle de périmètre `xid`.
- Payloads alignés sur la doc officielle (`POST /api/main/tasks`, `PUT`/`DELETE /api/main/tasks/{taskId}` avec `task_id` dans le corps), normalisation America/Toronto.
- Outils AVA communs chat + voix : `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task` dans `_shared/ava-tools.ts` + `ava-tool-executor`, avec barrières de confirmation dans `MAvaChat` et `AvaVoiceAgent`.
- Accueil mobile : « Appels récents » remplacé par `TasksSection` (En retard / Aujourd'hui / À venir, filtres, pagination, bouton `+` via `TaskComposerSheet`), rafraîchissement broadcast Realtime. L'onglet Appels est intact.

Le seul manque réel est la **couverture de tests exigée** (un seul fichier `planipretTasks.test.ts` existe), plus quelques durcissements ciblés.

## Ce qui reste à faire

### 1. Tests passerelle (Edge Function, logique pure extraite)
- Création valide, 422 si `notes` manquant, update, delete autorisé.
- Delete refusé pour le rôle `assistant`.
- Erreur de mapping `xid` hors périmètre.
- Token expiré / non connecté → `planipret_unauthorized`.
- Isolation multi-tenant (un utilisateur ne lit pas la projection d'un autre).
- Liste indisponible en amont (404/405/501) → `tasks_unavailable` + projection.

### 2. Tests d'idempotence
- Double appel `create` avec la même clé → une seule tâche, même réponse.
- Même chose pour `delete` rejoué.

### 3. Tests AVA
- Chat : les cinq outils sont exposés avec le bon schéma, `create/update/delete` sont dans les actions mutantes, annulation = aucune mutation, messages d'erreur lisibles.
- Voix : `delete_task` exige `confirmed=true` ; silence / interruption / déconnexion = aucune mutation.

### 4. Tests UI
- `TasksSection` : buckets overdue/today/upcoming, état vide, état offline/projection, état erreur + Réessayer, bouton `+`, modification, suppression avec confirmation.
- Hook `usePlanipretTasks` : chargement cache → refresh serveur, mise à jour optimiste réversible, rafraîchissement sur broadcast.
- Régression : l'onglet Appels et l'historique restent rendus et inchangés.

### 5. Durcissements mineurs
- Vérifier qu'aucun log ne contient de notes complètes ni de token.
- Confirmer que notifications et sync calendrier restent désactivés par défaut dans `TaskComposerSheet`.
- Mettre à jour `docs/planipret-tasks.md` : routes consommées, actions AVA, rôles, limites de l'endpoint de liste non documenté.

## Détails techniques

- Tests en Vitest (`bunx vitest run`), pas de test désactivé.
- Extraction, si nécessaire, des helpers testables de `planipret-task-api/index.ts` vers `_shared/planipret-tasks.ts` sans changer le comportement HTTP.
- Aucun fichier natif touché (PJSIP, Info.plist, icônes, scripts protégés).
- Aucune migration nouvelle prévue : `planipret_tasks_projection` et `planipret_task_mutations` existent déjà.

## Livrable final

Résumé des fichiers modifiés, fonctions à redéployer (`planipret-task-api`, `ava-tool-executor` si les schémas changent), résultats build/test, et point sur ce qui dépend encore d'un endpoint GET officiel Planiprêt.
