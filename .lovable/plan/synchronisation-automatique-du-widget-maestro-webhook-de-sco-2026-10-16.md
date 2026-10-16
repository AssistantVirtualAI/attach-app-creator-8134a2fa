# Synchronisation automatique du widget Maestro (webhook de Scott)

## But
Chaque changement téléphonique d'un courtier (poste, numéro, identifiants SIP), qu'il soit fait depuis le portail, l'app mobile ou NetSapiens, est envoyé automatiquement au webhook de Scott. Ensuite, tous les courtiers existants sont poussés une fois.

## Ce que l'on envoie
`POST https://client.planipret.com/telecom/api/v1/sync?machine=1` avec la même clé machine Bearer que les autres appels telecom de Scott.
```text
{ "user_id": "<ID CRM Maestro du courtier>", "external_user_id": "<ID utilisateur NetSapiens = poste>" }
```
- Courtier actif avec poste : les deux champs sont envoyés.
- Poste supprimé ou courtier retiré : `external_user_id` est omis, et Scott supprime son profil téléphonique.
- Un courtier sans ID CRM Maestro n'est pas envoyé. Il apparaît dans le rapport comme « non lié ».

## Déclencheurs
1. Portail et app : création ou suppression d'un courtier, changement de poste, assignation ou libération d'un numéro (procédure commune assignNumberToExtension), réinitialisation du mot de passe SIP.
2. NetSapiens : ajout d'un abonnement `subscriber` (modèle seul, sans toucher à call/cdr/message/voicemail). Le récepteur actuel envoie la synchro quand un utilisateur ou un numéro change.
3. Anti-doublon : une seule synchro par courtier toutes les 30 s. En cas d'échec, 3 nouvelles tentatives, puis l'erreur est journalisée.

## Envoi initial
Après le déploiement, tous les courtiers actifs liés à Maestro sont poussés par lots. Le rapport donne le nombre de réussites, d'échecs et de courtiers non liés, sans montrer de numéro ni de secret.

## Aucun changement sur
Les appels, CallKit, PJSIP, le routage DID, les SMS, iOS/Android, Lemtel et les crons NetSapiens existants.

## Détails techniques
- `_shared/maestro-widget-sync.ts` : `syncBrokerToWidget(admin, userId, {released})`. Il résout `maestro_broker_id` et le poste depuis planipret_profiles, appelle maestroTelecomFetch("/sync", POST), applique l'anti-doublon et journalise dans planipret_maestro_sync_log.
- Appels ajoutés de façon non bloquante (waitUntil) dans pp-admin-user, pp-admin-phonenumbers et `_shared/pp-did-routing.ts`, après un read-back réussi.
- ns-webhook-receiver : il gère le modèle `subscriber` et retrouve le courtier par poste. ns-webhook-setup est appelé avec `{models:["subscriber"]}` (ajout de « subscriber » à la liste autorisée).
- Nouvelle fonction admin `pp-widget-sync-all` pour l'envoi initial, par lots, avec un rapport expurgé.
- Tests Deno : payload avec et sans external_user_id, courtier sans ID CRM ignoré, anti-doublon, erreurs expurgées.
- Une règle à ajouter dans AGENTS.md.

## Point à confirmer avec Scott
Il faut confirmer que `external_user_id` correspond bien à l'utilisateur NetSapiens (le poste) et que `/sync` accepte la clé machine `machine=1`. Le premier envoi se fera sur un seul courtier pour valider, puis sur tous.
