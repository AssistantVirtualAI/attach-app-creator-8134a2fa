# Plan — Réassignation automatique des postes dans le widget Maestro

## Objectif

Empêcher définitivement les erreurs HTTP 500 du widget quand un poste (external_user_id) est encore lié à un ancien compte Maestro d'un courtier. Couvre tous les courtiers, pas seulement Marc et Camille.

## Partie 1 — Côté Maestro (Scott)

Scott modifie l'endpoint `POST /telecom/api/v1/sync` :

- Quand un `external_user_id` arrive associé à un autre `user_id` CRM que celui déjà enregistré, l'endpoint supprime l'ancienne association (et l'ancien profil SIP local, ex. `1136W`) puis crée la nouvelle, au lieu de lever une erreur de contrainte unique.
- La réponse reste HTTP 200 avec `{"success": true}`; idéalement un champ `reassigned_from: <ancien_user_id>` dans la réponse pour traçabilité.
- La libération explicite (`{"user_id": "..."}` sans `external_user_id`) continue de fonctionner telle quelle.

**Critère d'acceptation :** renvoyer `{"user_id": "387458632", "external_user_id": "1137"}` (Camille) doit réussir sans intervention manuelle.

## Partie 2 — Côté Planiprêt (nous)

1. **Historique des identifiants Maestro** : conserver l'ancien `maestro_broker_id` quand il change sur un profil (colonne `previous_maestro_broker_id` ou table d'audit), pour connaître l'ancien compte sans dépendre de Scott.
2. **Repli automatique en cas de 500** : dans `_shared/maestro-widget-sync.ts`, si `widget.sync` reçoit HTTP 500 et qu'un ancien identifiant est connu, tenter une libération de l'ancien `user_id` puis réessayer la synchro une seule fois. Journaliser le résultat dans `planipret_maestro_sync_log` (action `widget.auto_release`).
3. **Filet de sécurité** : ce repli reste utile même après le correctif de Scott (période de transition, autres causes de 500).
4. **Tests** : tests Deno sur `buildWidgetPayload` et sur la logique de repli (500 → release → retry → succès ; 500 sans ancien identifiant → échec consigné, pas de boucle).

## Partie 3 — Validation

- Après le déploiement de Scott : resynchroniser Camille (1137) et vérifier HTTP 200.
- Resynchroniser l'ensemble des courtiers actifs via `pp-widget-sync-all` et produire un rapport (envoyés / échecs / non liés).
- Vérifier dans l'historique que les réussites s'affichent bien comme réussites.

## Hors périmètre

- Aucun changement au routage d'appels, aux DID, à l'app mobile ou à Lemtel.
- Aucun déploiement tant que le plan n'est pas approuvé.
