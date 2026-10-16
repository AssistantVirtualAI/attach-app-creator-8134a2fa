# Déploiement d’une version désactivée de l’arbitre Cloudflare

`scripts/lemtel-cloudflare-arbiter-disabled-version-deploy.mjs` est un **déployeur source-only** pour le Worker nommé exactement `lemtel-failover-arbiter`. Il ne possède aucune configuration de cible, aucun identifiant de compte, aucun secret et aucune valeur d’exploitation intégrés au dépôt.

> **Ce script n’est pas une autorisation d’activer le failover.** Il ne déploie qu’une version dont le gate local exige `FAILOVER_MODE=disabled`.

Le script n’accepte aucun argument CLI. Par défaut, il s’arrête. Même dans son chemin actif, chaque invocation vérifie les conditions locales avant le premier appel réseau.

## Gates obligatoires

Toutes les variables suivantes doivent être injectées au runtime. La valeur de `CLOUDFLARE_API_TOKEN` ne doit jamais être écrite dans un fichier, dans une commande documentée, dans les sorties de test ou dans les logs.

| Variable | Exigence |
|---|---|
| `LEMTEL_CF_DEPLOY_INTENT` | Doit être exactement `LEMTEL_CF_DEPLOY_DISABLED_VERSION_V1`. C’est une confirmation d’intention non secrète, pas un identifiant d’accès. |
| `CLOUDFLARE_API_TOKEN` | Doit être non vide pour une exécution hors simulation et injectée uniquement au runtime. Elle n’est jamais journalisée. |
| `LEMTEL_CF_TARGET_ACCOUNT_ID` | Doit être un identifiant hexadécimal minuscule de 32 caractères fourni au runtime. |
| `LEMTEL_CF_WORKER_NAME` | Doit être exactement `lemtel-failover-arbiter`. Toute autre valeur est refusée. |
| `LEMTEL_CF_EXPECTED_SOURCE_SHA256` | Doit être le SHA-256 hexadécimal minuscule de la source locale. |
| `LEMTEL_CF_COMPATIBILITY_DATE` | Doit être une date calendrier explicite au format `YYYY-MM-DD`; aucune date par défaut n’est choisie. |
| `FAILOVER_MODE` | Doit être exactement `disabled`; `active`, `bootstrap`, une valeur vide ou toute autre valeur sont refusés. |
| `LEMTEL_CF_DRY_RUN` | Facultative. Si présente, doit être exactement `true`. |

La source contrôlée est toujours `infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs`. Le script la lit localement et compare son SHA-256 avec `LEMTEL_CF_EXPECTED_SOURCE_SHA256`, en comparaison à temps constant, **avant tout appel réseau**.

Pour produire l’empreinte attendue à partir de la copie locale examinée :

```sh
sha256sum infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs | awk '{print $1}'
```

L’opérateur doit fournir une date de compatibilité revue explicitement et injecter les valeurs runtime depuis le mécanisme de secrets autorisé par son environnement. Les espaces réservés ci-dessous ne sont pas des valeurs à utiliser telles quelles :

```sh
export LEMTEL_CF_DEPLOY_INTENT='LEMTEL_CF_DEPLOY_DISABLED_VERSION_V1'
export LEMTEL_CF_TARGET_ACCOUNT_ID='<runtime-account-identifier>'
export LEMTEL_CF_WORKER_NAME='lemtel-failover-arbiter'
export LEMTEL_CF_EXPECTED_SOURCE_SHA256='<local-source-sha256>'
export LEMTEL_CF_COMPATIBILITY_DATE='<reviewed-YYYY-MM-DD>'
export FAILOVER_MODE='disabled'
: "${CLOUDFLARE_API_TOKEN:?inject at runtime through the approved secret mechanism}"
```

## Simulation locale obligatoire avant toute opération réelle

La simulation exécute toutes les validations locales qui ne nécessitent pas de lecture distante et construit le multipart, mais ne réalise **aucune** requête réseau. Elle ne demande donc pas de token API :

```sh
LEMTEL_CF_DRY_RUN=true node scripts/lemtel-cloudflare-arbiter-disabled-version-deploy.mjs
```

Aucun argument ne peut être ajouté à cette commande. Un échec de gate ne révèle ni le token API ni une autre valeur sensible.

## Requête strictement limitée après les gates

Quand `LEMTEL_CF_DRY_RUN` est absent et que tous les gates locaux passent, le script peut effectuer exactement trois requêtes Cloudflare :

1. un `GET` de réglages qui doit prouver les quatre bindings allowlistés et `FAILOVER_MODE=disabled` ;
2. un `POST` de version multipart pour le Worker imposé, avec `bindings_inherit=strict` ;
3. un `POST` de déploiement contenant uniquement la version nouvellement créée à `100 %`.

Le multipart contient un `main_module` explicite, `lemtel-failover-arbiter-worker.mjs`, une `compatibility_date` explicite et **exactement** ces quatre bindings :

```json
[
  { "name": "STATE", "type": "inherit" },
  { "name": "FAILOVER_MODE", "type": "inherit" },
  { "name": "CONFIG_REVISION", "type": "inherit" },
  { "name": "ARBITER_SERIALIZATION_ACK", "type": "inherit" }
]
```

Le mode `strict` fait échouer le téléversement si un de ces héritages ne peut pas être résolu. La prélecture distante bloque aussi si un binding ajouté ou manquant rend l’héritage ambigu, ou si la valeur distante du mode n’est pas exactement `disabled`. Aucun autre binding n’est envoyé. Le script n’envoie ni migration, ni binding Durable Object, ni secret HMAC, ni secret de bootstrap, ni création de Worker, ni configuration de route, DNS ou load balancer. Il ne contacte pas d’hébergeur et n’exécute ni démarrage, ni promotion, ni fencing.

Le contrat multipart (`metadata`, `main_module`, module JavaScript et `compatibility_date`) est décrit dans la [documentation Cloudflare sur les métadonnées multipart](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/). Le téléversement de version et le déploiement sont volontairement deux appels distincts, conformément à la [documentation Cloudflare Versions & Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).

## Ce qui reste bloqué et séparé

Une version déployée avec ce script reste sous `FAILOVER_MODE=disabled`. Ce code ne valide pas et ne remplace pas les gates suivants :

- la sérialisation Durable Object ;
- le bootstrap scellé ;
- la distribution HMAC sûre ;
- le fencing et sa preuve terminale ;
- le drill de production et le failback ;
- le load balancing, le routing et toute bascule DNS ;
- les retry côté clients.

Ces sujets exigent leurs propres preuves, revues et autorisations. L’absence de ces éléments doit bloquer toute décision d’activation du failover, même si la version désactivée a été téléversée ou déployée.

## Ambiguïté d’API à lever avant une exécution réelle

Le script utilise l’API Versions multipart existante, avec l’héritage strict, puis l’API Deployments à pourcentage. Cloudflare maintient aussi une API Workers orientée ressources, présentée comme beta dans sa documentation. Avant toute exécution hors simulation, le responsable doit confirmer dans un environnement non productif que le contrat d’héritage strict, les permissions du token runtime et la sémantique de l’API choisie correspondent toujours à la version d’API disponible. Cette confirmation ne doit pas créer ou modifier de bindings, de secrets, de routes ou de Worker de production.

## Validation locale

```sh
node --test scripts/lemtel-cloudflare-arbiter-disabled-version-deploy.test.mjs
node --check scripts/lemtel-cloudflare-arbiter-disabled-version-deploy.mjs
git diff --check
```

Les tests injectent lecture de source et `fetch`. Ils ne font aucun appel Cloudflare réel.
