# Provisionnement source-only du sérialiseur Durable Object Cloudflare

## Statut, objectif et limite d’exécution

`scripts/lemtel-cloudflare-arbiter-serializer-provision.mjs` prépare un **déployeur source-only, auditable et fail-closed** pour le Worker Cloudflare nommé exactement `lemtel-failover-arbiter`. Son unique objectif futur est de provisionner le namespace Durable Object `ARBITER_SERIALIZER` pour la classe déjà exportée `LemtelFailoverSerializer`.

> **Cette révision est uniquement préparatoire. Aucun appel Cloudflare, Durable Object, Hostinger ou fournisseur n’a été effectué.** Aucun secret, compte, date de compatibilité, empreinte attendue, bootstrap, mode actif, DNS, route, pool, Load Balancer, téléphone, fencing ou promotion ne figure dans ce dépôt ni n’est configuré par ce livrable.

Le script n’accepte **zéro argument CLI**. Il refuse par défaut toute exécution et tous les paramètres opérationnels doivent être injectés au runtime. Son seul chemin réseau potentiel est impossible tant que toutes les gates locales passent, puis que la prélecture distante prouve l’état exact attendu. Une simulation (`LEMTEL_CF_DRY_RUN=true`) effectue toutes les gates locales et construit le multipart, **sans aucune requête réseau** et sans token API.

## Pourquoi un PUT immédiatement déployé, pas une version

Cloudflare applique les migrations Durable Object lors d’un déploiement immédiat ; une version téléversée ne peut pas porter/appliquer une migration. Le script effectue donc, seulement après prélecture, un **unique `PUT` multipart immédiatement déployé** vers le Worker imposé. Il n’utilise ni endpoint d’upload de version ni handler/endpoint de déploiement séparé.

La forme de migration est strictement :

```json
{
  "tag": "lemtel-arbiter-serializer-v1",
  "new_sqlite_classes": ["LemtelFailoverSerializer"]
}
```

`LEMTEL_CF_SERIALIZER_MIGRATION_TAG` doit respecter `^lemtel-arbiter-serializer-v[1-9]\d*$` **et** être exactement `lemtel-arbiter-serializer-v1`. Une valeur même syntaxiquement valide telle que `...-v2` est bloquée : le script ne peut donc ni créer une migration imprévue ni choisir un tag libre.

Une migration Durable Object est une transition persistante du cycle de vie des données, pas une simple modification de bundle. La création d’une nouvelle classe SQLite doit être considérée comme durable. Cette révision ne propose **aucun rollback cross-lifecycle** (création/renommage/suppression), aucune suppression de classe ou de données, et aucune reprise automatique après résultat incertain. Toute décision future de migration ou de retour en arrière doit être une révision distincte, explicitement revue avec le cycle de vie Cloudflare correspondant.

Références officielles :

- [Cloudflare — Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Cloudflare — Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare — Multipart Worker upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)
- [Cloudflare API — update a Worker script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)

## Gates runtime obligatoires

| Variable runtime | Exigence fail-closed |
|---|---|
| `LEMTEL_CF_SERIALIZER_PROVISION_INTENT` | Exactement `LEMTEL_CF_PROVISION_ARBITER_SERIALIZER_V1`. Confirmation d’intention non secrète. |
| `CLOUDFLARE_API_TOKEN` | Non vide seulement hors simulation ; injecté au runtime par le mécanisme approuvé, jamais écrit, affiché ou journalisé. |
| `LEMTEL_CF_TARGET_ACCOUNT_ID` | Exactement 32 caractères hexadécimaux minuscules. |
| `LEMTEL_CF_WORKER_NAME` | Exactement `lemtel-failover-arbiter`. |
| `LEMTEL_CF_EXPECTED_SOURCE_SHA256` | SHA-256 hexadécimal minuscule de la source locale contrôlée. |
| `LEMTEL_CF_COMPATIBILITY_DATE` | Date calendrier explicite revue au format `YYYY-MM-DD`; aucune valeur par défaut. |
| `LEMTEL_CF_SERIALIZER_MIGRATION_TAG` | Pattern restrictif ci-dessus, puis égalité stricte au seul tag autorisé `lemtel-arbiter-serializer-v1`. |
| `FAILOVER_MODE` | Exactement `disabled`. `active`, `bootstrap`, vide, absent ou toute autre valeur sont refusés avant réseau. |
| `LEMTEL_CF_DRY_RUN` | Facultative ; si présente, exactement `true`. Ce mode supprime tout accès réseau et ne demande pas de token. |

La seule source admise est :

```text
infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs
```

Elle est relue localement et son SHA-256 est comparé à `LEMTEL_CF_EXPECTED_SOURCE_SHA256` avec comparaison à temps constant avant toute requête. Pour inspecter l’empreinte de la copie revue, sans réaliser de déploiement :

```sh
sha256sum infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs | awk '{print $1}'
```

Le script n’affiche que des résultats redacted et codes de gate. Il ne journalise ni header d’autorisation, ni valeur d’environnement, ni exception brute, ni corps multipart.

## Prélecture distante obligatoire et exacte

Hors simulation, le script effectue d’abord un seul `GET` de réglages, avec `redirect: 'error'`. Il n’accepte que les **quatre bindings existants**, sans doublon, sans binding manquant, sans binding supplémentaire et sans changement de type/valeur :

| Binding existant exigé | Contrat de prélecture |
|---|---|
| `STATE` | `kv_namespace`, avec identifiant de namespace hexadécimal minuscule de 32 caractères. |
| `FAILOVER_MODE` | `plain_text` avec `text` exactement `disabled`. |
| `CONFIG_REVISION` | `plain_text` avec une révision `[a-z0-9-]` de 8 à 80 caractères. |
| `ARBITER_SERIALIZATION_ACK` | `plain_text` avec le texte historique exact `reviewed_single_serialized_scheduler`. |

Une réponse invalide, une redirection, une erreur HTTP/API, un mode actif, un binding omis/ajouté/dupliqué ou un type/texte inattendu bloque **avant** le `PUT`. Cette prélecture n’écrit rien et ne remplace pas une autorisation de changement.

## Multipart qui serait envoyé après toutes les gates

Une exécution non simulée validée ne pourrait effectuer que deux appels Cloudflare : le `GET` de prélecture ci-dessus puis un `PUT` immédiatement déployé vers :

```text
/accounts/<runtime-account-id>/workers/scripts/lemtel-failover-arbiter?bindings_inherit=strict
```

Les deux appels utilisent `redirect: 'error'`. Le header `Authorization` est construit uniquement en mémoire à partir du token runtime. Le script laisse `FormData` déterminer le `Content-Type` et sa boundary multipart ; il ne forge pas ce header.

Le multipart contiendrait seulement :

1. `metadata.json`, `application/json`, avec les métadonnées exactes suivantes (la date est la valeur runtime revue) ;
2. `lemtel-failover-arbiter-worker.mjs`, `application/javascript+module`, contenant les octets dont le SHA-256 vient d’être vérifié.

```json
{
  "main_module": "lemtel-failover-arbiter-worker.mjs",
  "compatibility_date": "<runtime-reviewed-YYYY-MM-DD>",
  "bindings": [
    { "name": "STATE", "type": "inherit" },
    { "name": "FAILOVER_MODE", "type": "inherit" },
    { "name": "CONFIG_REVISION", "type": "inherit" },
    {
      "name": "ARBITER_SERIALIZER",
      "type": "durable_object_namespace",
      "class_name": "LemtelFailoverSerializer"
    }
  ],
  "migrations": {
    "tag": "lemtel-arbiter-serializer-v1",
    "new_sqlite_classes": ["LemtelFailoverSerializer"]
  }
}
```

`STATE`, `FAILOVER_MODE` et `CONFIG_REVISION` sont donc hérités en mode strict. `ARBITER_SERIALIZER` est le seul nouveau binding et vise la classe exportée du même module. **`ARBITER_SERIALIZATION_ACK` est intentionnellement absent des nouvelles métadonnées** : le texte historique ne doit pas survivre comme preuve de sérialisation dans la nouvelle version. Aucun autre binding, secret, cron, migration différente ou configuration ne peut être ajouté par ce script.

## Simulation et validation locale

Après injection locale des seules valeurs non sensibles de gate dans l’environnement, la simulation suivante ne contacte pas Cloudflare et ne requiert pas de token :

```sh
LEMTEL_CF_DRY_RUN=true node scripts/lemtel-cloudflare-arbiter-serializer-provision.mjs
```

Aucun argument CLI ne peut être ajouté. Une commande d’exécution réelle, un token et toute valeur de cible restent volontairement absents de cette documentation : ils exigeraient une autorisation opérationnelle séparée et un canal de secrets approuvé.

Les validations livrées sont toutes locales :

```sh
node --check scripts/lemtel-cloudflare-arbiter-serializer-provision.mjs
node --test scripts/lemtel-cloudflare-arbiter-serializer-provision.test.mjs
node --test scripts/lemtel-durable-object-serialization.test.mjs \
  scripts/lemtel-sealed-arbiter-bootstrap.test.mjs \
  scripts/lemtel-failover-execution-protocol.test.mjs
git diff --check
```

Les mocks vérifient notamment : zéro réseau en simulation et lors de toute gate locale refusée ; SHA-256 ; migration SQLite exacte ; binding DO ; absence de l’ACK ; refus d’un réglage distant actif, manquant ou additionnel ; `PUT` immédiat unique sans handler de déploiement ; redirects refusées ; et absence de token dans les sorties. Ils ne prouvent pas le runtime, les permissions, les migrations ou les données Cloudflare réels.

## Ce qui reste strictement désactivé

Ce provisionnement ne met **jamais** `FAILOVER_MODE` à `active` : il exige et ré-hérite `disabled`. Il ne bootstrappe pas de configuration et ne crée, ne lit ni ne modifie aucun secret. Le code Worker conserve ses refus en mode disabled ; un Durable Object provisionné ne constitue pas une autorisation de l’employer en actif.

Même après une future exécution explicitement autorisée de ce provisionneur, l’activation automatique reste bloquée par toutes les gates indépendantes suivantes :

1. **configuration scellée** complète, fraîche, validée, injectée par le chemin de bootstrap séparé puis retour confirmé à `disabled` ;
2. **agent Hostinger déjà installé mais maintenu en `disabled`**, avec son preflight root-only et sans lancement, promotion ou démarrage runtime ;
3. distribution et validation du **chemin HMAC sécurisé** (secrets hors console, reçu de fencing lié à l’incident, persistance root-only et ledger one-time) ;
4. **drill destructif** approuvé/signé, de même révision et writer, démontrant aussi la sérialisation ;
5. **fence fournisseur** du writer DO, incluant résultat non ambigu et deux confirmations terminales d’arrêt ;
6. observation **L7** HTTPS exacte et non ambiguë ;
7. configuration, approbation et drill séparés du **Load Balancer/routage** ; aucune route, DNS ou trafic n’est modifié ici ;
8. procédure et drill de **failback** humain, sans failback automatique ;
9. validation du **retry client/mobile** et de l’unicité de writer après promotion.

L’absence ou l’ambiguïté d’une seule preuve reste un blocage humain fail-closed. Cette révision ne contacte pas DigitalOcean, Hostinger, Cloudflare réel, un Durable Object réel ou tout autre fournisseur, et ne touche ni Planipret, ni PBX/legacy Lemtel, ni téléphonie.

Voir aussi : [correction de sérialisation source-only](DURABLE_OBJECT_SERIALIZATION_SOURCE_ONLY.md), [bootstrap scellé](SEALED_ARBITER_BOOTSTRAP.md), [protocole d’exécution](AUTOMATIC_FAILOVER_EXECUTION_PROTOCOL.md) et [gates actuelles](CURRENT_AUTOMATIC_FAILOVER_GATES.md).
