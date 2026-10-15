# Numéro de téléphone fiable à la création ou à la réassignation d'un courtier

## Problème constaté
- Créer un courtier route l'appel puis le texto, mais le **numéro affiché (caller ID)** du poste n'est pas mis à jour. Or l'envoi de textos se sert de ce numéro : le courtier peut alors texter depuis un numéro qui n'est pas le sien, ou ne pas pouvoir texter du tout.
- Le bouton **Assigner** du portail écrit seulement le routage des appels, sans relecture. Il ne branche pas les textos, ne touche pas au numéro affiché et ne libère pas l'ancien numéro du courtier.
- Un numéro qui sert seulement aux textos (comme le 514 de Camille) peut être assigné sans avertissement, alors qu'il ne reçoit pas d'appels.

## Correctif : une seule procédure partagée « assigner un numéro à un poste »
Elle sera utilisée par la création d'un courtier, le bouton Assigner et la commande « garder un seul numéro ». Elle fait, dans cet ordre :
1. **Vérifie** que le poste existe dans le système téléphonique et que le numéro est libre ou appartient déjà à ce poste.
2. **Appels** : route le numéro vers le poste, puis relit le résultat pour le confirmer. Si le numéro ne sert qu'aux textos, l'assignation est refusée avec un message clair : « numéro textos seulement, activez l'appel chez le fournisseur ».
3. **Textos** : branche le côté textos du même numéro sur le poste, puis relit pour confirmer.
4. **Numéro affiché** : met ce numéro comme numéro sortant du poste (appels et textos), puis relit pour confirmer.
5. **Ancien numéro** : en cas de réassignation, libère l'ancien numéro du courtier pour les appels et les textos, sans laisser de routage vers le poste.
6. **Registre** : met à jour la liste interne des numéros et conserve une trace avant/après.
7. **Résultat** : renvoie l'état de chaque étape (appels, textos, numéro affiché, libération). Le portail affiche « Appels ✓ / Textos ✓ » ou l'étape qui a échoué, sans jamais annoncer un succès partiel comme complet.

Si l'étape 2 échoue, rien d'autre n'est modifié. Si une étape suivante échoue, le résultat le signale clairement pour qu'on la relance.

## Garde-fous
- Une seule ligne à la fois, toujours avec relecture. Aucune réécriture en masse.
- Aucun changement aux appareils, aux règles de réponse, à l'app iPhone/Android, à Lemtel ou aux crons.
- Aucun texto ni appel de test n'est envoyé.

## Vérification
- Tests automatiques : création, réassignation, numéro textos seulement refusé, ancien numéro libéré, échec d'une étape bien signalé.
- Contrôle en lecture seule sur Camille (1137) et sur le poste de Marc : routage, textos et numéro affiché alignés.

## Détails techniques
- Nouveau helper `assignNumberToExtension()` dans `_shared/pp-did-routing.ts`, qui réutilise `assignDidToExtension`, `assignSmsNumber` et `releaseDid`. Il ajoute un `PUT /domains/{d}/users/{ext}` avec `caller-id-number`, `caller-id-number-emergency` et `sms-number` (nom exact des champs à confirmer dans `docs/netsapiens/`), suivi d'une relecture.
- `pp-admin-user` (`autoAssignDid`) et `pp-admin-phonenumbers` (`assign`, `single_did`) appellent ce helper.
- Le portail admin affiche les statuts par étape.
- Seules `pp-admin-user` et `pp-admin-phonenumbers` sont déployées.
