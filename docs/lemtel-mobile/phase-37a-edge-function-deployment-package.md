# Lemtel — phase 37A : paquet de déploiement Edge Functions

## Objet

Les sources Lemtel-only suivantes existent déjà dans le dépôt, mais ne sont pas encore présentes dans le runtime Edge auto-hébergé :

- `lemtel-mobile-config-admin` : administration authentifiée des brouillons, publication et retrait, exclusivement via les RPC atomiques Lemtel;
- `lemtel-mobile-config-manifest` : lecture authentifiée de la seule configuration publiée d’une organisation.

Cette phase ne les déploie pas. Elle crée un manifeste d’intégrité hors ligne qui associe chaque slug à sa source Lemtel-only, sa destination prévue sous le volume de fonctions et une empreinte SHA-256.

## Contrat de runtime

La pile Supabase auto-hébergée officielle monte le volume des fonctions dans `/home/deno/functions`, conserve un routeur `main/index.ts` et un import map `deno.jsonc`. Le paquet exige que ces deux fichiers runtime préexistants soient vérifiés mais ne les remplace jamais.

Les seuls chemins prévus sont :

| Slug | Source versionnée | Destination prévue dans le volume |
|---|---|---|
| `lemtel-mobile-config-admin` | `infra/lemtel-self-hosted/functions/lemtel-mobile-config-admin/index.ts` | `lemtel-mobile-config-admin/index.ts` |
| `lemtel-mobile-config-manifest` | `infra/lemtel-self-hosted/functions/lemtel-mobile-config-manifest/index.ts` | `lemtel-mobile-config-manifest/index.ts` |

Le manifest ne contient ni `.env`, ni clé de service, ni secret Auth, ni données Lemtel. Les fonctions utilisent les variables déjà injectées à l’exécution par la pile auto-hébergée; elles ne sont jamais écrites dans ce paquet.

## Déploiement futur — pas encore autorisé

Une étape distincte devra, avec snapshot frais et autorisation explicite :

1. contrôler les empreintes locales avant la copie;
2. vérifier le routeur et l’import map présents dans le volume de fonctions;
3. déposer les deux sources dans un répertoire de staging du volume, puis effectuer un remplacement atomique;
4. redémarrer uniquement le service `functions` et vérifier sa santé;
5. exécuter des sondes Auth/RBAC et un manifeste en lecture seule avec le compte propriétaire Lemtel;
6. conserver les applications Desktop/iOS/Android sur leur origine actuelle jusqu’au cutover client séparément approuvé.

> Ce paquet est volontairement non autorisant : aucun fichier ne peut être copié, aucun conteneur ne peut être redémarré et aucun client ne peut être basculé par son exécution.

## Vérification

```sh
node --test scripts/lemtel-self-hosted-edge-function-package.test.mjs
```

Le test recalcule les empreintes des sources locales et refuse toute source non Lemtel, tout chemin de routeur, toute absence de prérequis runtime ou toute levée d’autorisation.
