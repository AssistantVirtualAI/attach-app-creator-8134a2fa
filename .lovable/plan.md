# Conformité à la spécification Task API — constat et correctifs

## Ce qui est déjà conforme (vérifié dans le code)

- Contrat API : la passerelle n'appelle que `POST /api/main/tasks`, `PUT /api/main/tasks/{taskId}` et `DELETE /api/main/tasks/{taskId}`, avec `task_id` aussi dans le corps pour update/delete. Aucun `GET /api/main/tasks` inventé.
- Liste : uniquement la route interne `/users/{telecomUserId}/tasks`, encapsulée serveur, avec `source: api | projection | unavailable` et `tasks_unavailable` sur 404/405/501.
- Sécurité : aucun token côté client, tout passe par `planipret-task-api` avec le JWT Supabase ; audit sans le texte des notes ; `correlation_id` sur chaque action.
- Rôles : suppression refusée à `assistant` côté serveur avant tout appel amont.
- Idempotence : clé déterministe + table `planipret_task_mutations` (double tap, retry, tool-call rejoué).
- Erreurs : mapping 401/403/422/404-405-501/timeout/5xx structuré.
- AVA : 5 outils identiques chat et voix, confirmations partagées (`avaMutations.ts`), suppression toujours confirmée.
- Accueil : bloc « Mes tâches » (En retard / Aujourd'hui / À venir), création, report, suppression confirmée ; onglet Appels intact.
- Fuseau America/Toronto imposé serveur et client.
- Tests : 105 tests verts couvrant passerelle, idempotence, isolation, outils AVA, UI et régression Appels.

## Écarts constatés (à corriger)

1. **« Voir tout » pointe vers l'onglet Appels** (`/planipret/mobile/calls`) au lieu d'une vue tâches — incohérent avec la spec §4.1.
2. **Placement du bloc** : « Mes tâches » est en bas de l'accueil, la spec le veut sous le résumé AVA et avant l'agenda.
3. **Cible `contract` non vérifiée** : le contrôle de périmètre `xid` ne s'applique qu'à `type=user`. Une tâche `type=contract` part sans vérification et l'erreur `target_mapping_required` de la spec §3.3 n'existe pas.
4. **`get_task` lit seulement la projection** : si la tâche n'est pas encore projetée, retour `task_not_found` au lieu d'une lecture via la même source que `list`.
5. **Section « Récentes » (tâches créées par AVA < 24 h)** absente — optionnelle dans la spec, mais l'indicateur AVA existe déjà.
6. **422 par champ** : la passerelle renvoie les détails, mais la feuille de création n'affiche qu'un message global, sans mappage champ par champ.

## Travaux proposés

### Accueil (`MHome.tsx`, `TasksSection.tsx`, `TaskComposerSheet.tsx`)
- Déplacer `TasksSection` sous le résumé AVA et avant l'agenda / rappels.
- Ajouter une vue « Toutes mes tâches » (route mobile `tasks`) et y brancher « Voir tout ».
- Ajouter le groupe optionnel « Récentes (AVA, 24 h) ».
- Afficher les erreurs 422 champ par champ dans la feuille de création.

### Passerelle (`_shared/planipret-task-handler.ts`)
- Étendre le contrôle de périmètre à `type=contract` : exiger une correspondance officielle et retourner `target_mapping_required` en l'absence de mapping, au lieu d'envoyer l'appel.
- `get` : tenter la source live (même connecteur que `list`) avant de retomber sur la projection.

### Tests
- Nouveaux cas : `target_mapping_required` sur contrat non mappé, `get` live puis repli projection, « Voir tout » ouvre la vue tâches, erreurs 422 par champ, ordre des sections de l'accueil.

## Détails techniques
Aucune migration nécessaire ; la correspondance contrat s'appuie sur les tables de profil/contrat existantes et retourne une erreur explicite si elle est absente. Aucun fichier natif PJSIP / VoIP n'est touché.
