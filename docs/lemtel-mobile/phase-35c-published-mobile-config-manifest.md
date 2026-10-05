# Lemtel — phase 35C : manifeste mobile de configuration publiée

## Objet

Cette phase prépare le futur endpoint Lemtel-only qui remplacera l’ancien parcours de lecture de configuration mobile. Le code est une source isolée sous `infra/lemtel-self-hosted/functions/`; **il n’est pas déployé et aucun client ne l’appelle**.

## Lecture autorisée par le futur contrat

Une requête devra fournir uniquement une organisation et un canal `staging` ou `production`, avec un JWT. L’endpoint vérifie le jeton puis l’appartenance active de l’utilisateur à cette même organisation. Il ne lit qu’une révision ayant le statut `published` et ne retourne que le canal, la révision et les objets de configuration validés.

L’organisation, l’utilisateur, les dates, l’auteur de publication, les identifiants internes, les credentials, les endpoints, PBX, TURN, Storage et releases ne sont pas exposés. Les objets retournés sont revalidés pour taille, profondeur et clés sensibles, et la réponse est `no-store`.

## Limites

Le manifeste est entièrement hors ligne : déploiement, import et cutover client sont tous à `false`. Il dépend d’une publication atomique future, de comptes Auth Lemtel neufs, d’appartenances de test, de tests RBAC/manifeste synthétiques, puis d’autorisations distinctes de déploiement Edge et de cutover client.

Il ne crée ni utilisateur, ni organisation, ni configuration, ni bucket, ni fonction déployée. Il ne touche ni Planiprêt, ni FusionPBX, ni DNS, ni DigitalOcean.

## Vérification

```sh
node --test scripts/lemtel-self-hosted-mobile-config-manifest.test.mjs
```

Ce test lit seulement le dépôt et vérifie le contrat de lecture minimale; il ne contacte aucun backend.
