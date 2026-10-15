# Lemtel — protocole d’exécution de failover, préparé et désactivé

## État de livraison : aucune bascule automatisée maintenant

**Cette livraison ne déploie, n’installe et n’active rien. Aucun secret, aucune configuration de production et aucun drill de production ne sont appliqués.** Le Worker est fermé par défaut. L’agent exige ses propres gates ; en mode `review`, son résultat maximal est `manual_promotion_action_required`. Le chemin `execute` exige une autorisation distincte et toutes les preuves locales.

Le [bootstrap scellé](SEALED_ARBITER_BOOTSTRAP.md) ajoute uniquement une fenêtre transitoire `bootstrap`, sans observation, fencing ou commande. **La configuration active doit désormais provenir du payload chiffré accepté**, pas des anciens bindings opérationnels. Retour obligatoire à `disabled` après injection ; l’active reste bloqué sans toutes les gates et le drill signé. Aucune modification du runtime existant n’est effectuée ici.

Un **agent installé en `disabled` n’est pas une activation** : il sort `blocked` (code `78`), sans lecture de commande distante, sans guard, sans promotion ni démarrage runtime. L’absence de `FAILOVER_MODE` a le même effet. Les unités sont des modèles **non installés**, sans section `[Install]` et sans lien à une cible de démarrage. Un démarrage explicite du timer ne serait pas une autorisation de promotion.

Le contrat de [gates actuelles](CURRENT_AUTOMATIC_FAILOVER_GATES.md) conserve tous les flags d’activation à `false` tant que les prérequis de production ne sont pas prouvés. Les rôles du nouveau protocole sont exclusivement **`do_writer` → `hostinger_standby`**, un standby chaud privé. Le rôle opérationnel `hostinger_standby` correspond au nom de contrat `hostinger_private_hot_standby` ; il ne s’agit ni d’une inversion de rôles ni d’une modification du contrat.

**Le routage Cloudflare est une révision séparée**, pas une variable permettant de contourner cette livraison : `automatic_traffic_routing_enabled` est toujours `false`. Aucune API LB, pool, DNS ou routage n’est utilisée. Aucun failback automatique. Aucun périmètre Planipret, Avastatistic, PBX/legacy Lemtel, FusionPBX ou téléphonie n’est touché.

## Artefacts et responsabilités

| Artefact | Responsabilité maximale |
|---|---|
| `lemtel-failover-arbiter-worker.mjs` | Worker sans dépendance ; HTTP de statut/boîte à commande, observation L7 et machine de fencing uniquement après toutes les gates. |
| `lemtel-ha-hostinger-failover-agent.sh` | Agent root-only ; preflight local ou collecte d’une commande, HMAC, échéance, ledger one-time et persistance root-only du reçu de fencing vérifié. |
| `.service` / `.timer` | Modèles non installés et non activés ; aucun auto-installeur et aucune section d’activation. |
| `scripts/lemtel-failover-execution-protocol.test.mjs` | Tests Node et contrôles de texte ; KV, horloge et HTTP simulés, aucun appel externe. |

## Configuration du Worker — uniquement des noms, aucune valeur

L’absence d’un seul prérequis en mode actif retourne/stocke `blocked`, **avant toute requête de santé ou de fournisseur et avant toute livraison de commande**. Les modes désactivés/inconnus retournent `disabled_or_dry_run` sans aucune lecture/écriture KV. Le mode `bootstrap` n’autorise que les deux endpoints de configuration décrits dans la documentation scellée ; son cron reste sans effet.

Dans la liste ci-dessous, **seuls `FAILOVER_MODE`, `STATE` et `CONFIG_REVISION` sont des bindings runtime**. Les autres noms sont les champs obligatoires de `configuration` dans le payload protégé, sans fallback sur des bindings en clair. Les trois secrets runtime de scellement et le JWK public sont décrits dans [SEALED_ARBITER_BOOTSTRAP.md](SEALED_ARBITER_BOOTSTRAP.md).

| Nom | Rôle / validation |
|---|---|
| `FAILOVER_MODE` | `active` peut considérer une exécution seulement après déchiffrement et toutes les gates. `bootstrap` : injection uniquement. Absent, `disabled`, `dry_run` ou valeur inconnue : aucune action. |
| `STATE` | Binding Workers KV avec `get` et `put` ; config, incident/commande et drill intégralement chiffrés, statuts et marqueurs one-use redacted. Une panne de KV bloque. |
| `DO_API_TOKEN` | Secret fournisseur limité au writer et aux lectures/actions de puissance nécessaires. Au moins 32 caractères, jamais retourné ou journalisé. |
| `DO_WRITER_DROPLET_ID` | Identifiant du seul writer DO autorisé. Les réponses d’action et de puissance doivent correspondre exactement. Aucune valeur intégrée au source. |
| `DO_API_BASE_URL` | URL HTTPS de l’API DO, terminée par le chemin `/v2`, fournie hors code. Pas de credentials, query, fragment ou redirection. |
| `DO_WRITER_L7_URL` | Endpoint HTTPS **direct et authentifié du writer**, jamais une adresse LB ou un standby, avec le chemin exact `/lemtel-lb-ready`. Adaptateur de santé à fournir et valider avant toute activation. |
| `DO_WRITER_L7_SECRET` | Secret de lecture L7, distinct du token fournisseur et du secret d’agent, au moins 32 caractères. |
| `AGENT_SHARED_SECRET` | Secret partagé avec le seul agent root Hostinger : authentification de la boîte à commande et HMAC-SHA256 du reçu de fence et de la commande. Au moins 32 caractères ; utiliser des valeurs aléatoires à forte entropie. |
| `DRILL_APPROVAL_SECRET` | Secret de validation hors bande, distinct, pour la signature de l’autorisation finale de drill. Ne doit pas être distribué à l’agent Hostinger. |
| `CONFIG_REVISION` | Révision opaque ASCII, 8–80 caractères minuscules/chiffres/tirets ; renouveler à chaque changement des endpoints, identifiants, secrets ou limites. Une différence avec l’incident persisté bloque. |
| `ARBITER_SERIALIZATION_ACK` | Accusé exact `reviewed_single_serialized_scheduler`. Ne constitue pas, à lui seul, une preuve de sérialisation ; voir la gate ci-dessous. |
| `OBSERVATION_INTERVAL_SECONDS` | 60–900 secondes ; une observation par cycle espacée, les appels dupliqués ne comptent pas comme plusieurs suspicions. |
| `INCIDENT_FAILURE_CYCLES` | 3–20 cycles **consécutifs** d’échec L7 définitif. La santé positive ou ambiguë remet la suspicion à zéro. |
| `GRACEFUL_SHUTDOWN_DELAY_SECONDS` | 60–900 secondes avant toute demande `power_off`, après `shutdown` accepté. |
| `POWER_STATE_TIMEOUT_SECONDS` | 120–3600 secondes, strictement supérieur au délai graceful ; au-delà, intervention humaine. |
| `COMMAND_TTL_SECONDS` | 30–300 secondes. Aucune réémission automatique après expiration ou livraison incertaine. |

### Dernière gate : autorisation signée après drill destructif

Même avec `FAILOVER_MODE=active` et un bootstrap scellé valide et non expiré, le Worker reste bloqué sans reçu signé valide sous la clé KV `lemtel_failover_execution_v1:production-drill`. **Ce reçu doit désormais être stocké dans un record AES-256-GCM de kind `drill`**, avec la clé runtime de scellement ; un ancien reçu en clair est refusé. Le contrôleur ne signe ni ne fabrique le drill.

Ce reçu est une enveloppe `{payload, signature}`. Le payload comporte `format=lemtel_production_destructive_drill_v1`, `config_revision`, `writer_role=do_writer`, `target_role=hostinger_standby`, `writer_droplet_id`, `destructive_drill_validated`, `serialized_execution_verified`, `validated_at` et `expires_at`. Les deux validations doivent être booléennes positives, la révision et le writer doivent correspondre, les timestamps sont des secondes Unix entières, la validité maximale est de 24 heures. **Aucun reçu signé n’est fourni ici.**

La signature est HMAC-SHA256 en hexadécimal minuscule, sous `DRILL_APPROVAL_SECRET`, du contexte `lemtel-production-drill-v1`, suivi d’un saut de ligne et du JSON canonique (clés triées récursivement, sans espaces). L’outil de délivrance du reçu et sa procédure humaine ne sont pas livrés ; l’identité d’approbation et la rotation sont à contrôler hors bande.

**KV n’est pas un verrou transactionnel, ne fournit ni CAS ni garantie de lecture globale immédiate.** Le verrou d’isolate du Worker évite seulement un chevauchement local. La production exige une revue et une preuve d’un exécuteur réellement sérialisé, avec persistence cohérente ; si une primitive de verrouillage forte est nécessaire, elle doit faire l’objet d’une révision avant autorisation. Ne jamais remplir l’accusé ou signer le reçu pour masquer cette limitation. Le ledger atomique local de l’agent empêche une seconde consommation du même incident, mais ne remplace pas la sérialisation du fencing côté Worker.

Après revue du code, choix d’une sérialisation sûre, configuration sécurisée, preflight et préparation des procédures de récupération, **un drill destructif reste la dernière gate**, supervisée et autorisée séparément. Le reçu ne déverrouille jamais Cloudflare/DNS, un failback ou une nouvelle émission : seule la chaîne locale explicitement configurée peut consommer une commande valide une fois.

## Écriture planifiée du Worker et endpoints

La configuration Workers et son cron doivent être préparés dans une étape séparée ; **aucun manifeste actif ni déploiement n’est livré**. Le cycle `scheduled` appelle la machine et rattache sa promesse à `ctx.waitUntil`. Les requêtes HTTP ne déclenchent jamais le fencing.

| Entrée | Effet limité |
|---|---|
| `GET /.well-known/lemtel-failover-bootstrap-key` | Seulement en mode bootstrap : JWK public et métadonnées non sensibles ; sinon `404`. |
| `POST /.well-known/lemtel-failover-bootstrap` | Seulement en mode bootstrap : HMAC, RSA-OAEP/SHA-256 + AES-GCM, nonce/révision one-use, échéances et validation complète ; aucun changement de mode ni commande. |
| `GET /healthz`, `GET /status` | État de sécurité sans secrets, IDs fournisseur ou commande. Pas un signal autorisant le routage. |
| `GET /agent/command` | Nécessite toutes les gates et `Authorization: Bearer` sous le secret partagé ; ne livre qu’une commande disponible et non expirée. |
| Autres méthodes/chemins en actif | Refus ; aucun endpoint permettant de lancer un incident ou de réinitialiser un fence. |

Les clés KV `lemtel_failover_execution_v1:status` et `lemtel_failover_execution_v1:incident` sont écrites par la machine active ; **l’incident entier est chiffré AES-256-GCM**, y compris révision, compteurs, phases, intentions/actions et éventuellement commande/reçu. Le statut public est reconstruit sur allowlist et ne contient que des états de sécurité. En mode désactivé, **rien n’est lu ni écrit** ; l’incident existant n’est pas effacé ni réarmé. La commande authentifiée conserve son reçu liant l’identité writer conformément au contrat de l’agent ; aucun secret/token/URL de configuration n’est retourné.

Une intention destructive est persistée **avant** chaque POST fournisseur. Une intention retrouvée après interruption, un résultat inconnu, un état terminal ambigu, un timeout ou une phase inconnue bloque durablement l’incident ; aucune relance implicite du POST. La remise en état exige une procédure humaine distincte avec preuves fraîches, pas une suppression opportuniste du KV ou du ledger.

## Séquence multi-phase préparée

1. **Observation L7 DO** : l’URL HTTPS configurée doit cibler le chemin exact `/lemtel-lb-ready`. Un `HTTP 200` n’efface la suspicion que si `Content-Type` est JSON et si le corps est **exactement** `{format=lemtel_do_writer_l7_ready_v1, writer_role=do_writer, definitive=true, observed_at, status=healthy}` ; `observed_at` est un timestamp Unix entier récent (120 secondes maximum, tolérance future 15 secondes). Seul un `HTTP 404` net, sans redirection et provenant de l’hôte/chemin HTTPS configurés, compte comme échec définitif : il atteste l’absence du marqueur. Un timeout, un échec réseau, une redirection, un hôte ou chemin inattendu, tout autre `4xx`/`5xx`, un JSON invalide, enrichi ou stale, ou toute autre réponse sont **ambigus**, jamais une autorisation de fence ou de promotion. Ce format ne doit pas être supposé compatible avec un ancien endpoint existant.
2. **Suspicion d’incident** : plusieurs cycles consécutifs espacés ; création d’un `incident_id` à usage unique. Aucune action fournisseur avant le seuil.
3. **Fencing graceful** : intention persistée puis une action DO `shutdown` ; l’action et son propriétaire sont validés.
4. **Délai puis hard fence** : polling de l’action et de la puissance. `power_off` seulement si le writer n’a pas été confirmé éteint et après le délai graceful ; jamais sur une réponse provider ambiguë.
5. **Polling terminal** : action `completed` et droplet `off`, avec deux confirmations espacées. Une nouvelle vérification terminale est exigée juste avant l’émission ; un retour à `active` bloque.
6. **Reçu de fence HMAC** : incident, writer, droplet configuré, action, état `off`, confirmations et timestamp sont liés sous HMAC, contexte `lemtel-fence-receipt-v1`.
7. **Commande `promotion`** : enveloppe HMAC, contexte `lemtel-promotion-command-v1`, avec `incident_id`, nonce, rôles, `issued_at`, `expires_at` et reçu de fencing HMAC.
8. **Hostinger : persistance puis exécution contrôlée** : l’agent valide les deux HMAC, l’échéance et le writer, crée un ledger durable à usage unique, puis persiste le reçu sous `/var/lib/lemtel-ha/current-topology-evidence/do-writer-fence-receipt.state` (root `0600`) avant l’attestation locale du runtime. En `review`, il s’arrête sur `manual_promotion_action_required`. En `execute`, uniquement après l’accusé explicite de configuration, il appelle les scripts locaux de promotion puis de runtime ; chaque action exige ce reçu root-only, l’incident exact et ses propres gates PostgreSQL/Storage.
9. **Routage et failback** : l’agent ne modifie jamais Cloudflare/DNS. Le routage reste la responsabilité du Load Balancer Cloudflare, après sa configuration et son drill. Le failback automatique reste interdit.

La boîte à commande marque l’intention de livraison avant réponse et ne réémet pas automatiquement. La consommation one-time est garantie localement par un fichier `.consumed` créé atomiquement avec `O_EXCL`/`O_NOFOLLOW` et synchronisé sur disque **avant l’attestation locale du runtime**. Une livraison perdue, une réponse réseau incertaine ou une expiration demande une intervention humaine, pas une nouvelle commande sur le même incident.

## Agent root-only et preflight

L’agent nécessite Linux, Bash, `/usr/bin/python3` standard (mode isolé `-I`) et les outils locaux de vérification PostgreSQL/Storage. Il ne s’installe et ne se lance jamais lui-même. Gate d’entrée exacte : `LEMTEL_HA_EXECUTE=run_hostinger_failover_agent` et `LEMTEL_HA_ROLE=hostinger_standby`, avec UID root. Aucune valeur de mode ou de secret héritée du processus n’est utilisée comme configuration.

Le seul fichier chargé est `/etc/lemtel-ha/failover-agent.env`, propriétaire root, fichier régulier `0600`, sans symlink, dans une chaîne de répertoires root non inscriptibles par groupe/autres. Parsing strict de lignes littérales `KEY=value` : pas de `source`, `eval`, expansion, quotes, variable inconnue ou doublon. Clés autorisées :

| Clé | Usage |
|---|---|
| `FAILOVER_MODE` | Absent ou autre que `active` : `blocked`, aucune requête distante. |
| `ARBITER_URL` | Origine HTTPS sans credentials, query, fragment ou autre chemin ; seule route distante `/agent/command`, pas de redirection/proxy. |
| `AGENT_SHARED_SECRET` | Même secret que le Worker, jamais en argument CLI ou en sortie. |
| `DO_WRITER_DROPLET_ID` | Writer attendu ; doit correspondre au reçu signé. |
| `LEMTEL_HA_LOCAL_POSTGRES_CONTAINER` | Container PostgreSQL standby local utilisé par l’attestation de promotion, jamais une cible distante. |

Les scripts fixes de stage, promotion et démarrage runtime sont sous `/opt/lemtel-ha/automatic-failover/`, root `0750` et dans une chaîne de répertoires non inscriptibles par d’autres utilisateurs. Le ledger privé est `/var/lib/lemtel-ha/failover-agent` (`0700`, fichiers `0600`) et le reçu de fencing validé est conservé dans `current-topology-evidence` (`0700`, fichier `0600`). L’installation de ces chemins n’est pas effectuée par cette livraison.

`preflight` est le mode par défaut : contrôles root/gate/rôle, fichier, configuration et chemins locaux ; **aucune requête réseau, aucun fichier d’incident créé et aucune promotion**. Un preflight en disabled sort `blocked`, jamais « prêt pour promotion ». Un preflight positif ne vérifie ni la connectivité ni les secrets distants ni les preuves de drill.

Exemple d’invocation **uniquement sur une installation locale revue, pour lecture**, sans secret sur la ligne de commande :

```bash
sudo env LEMTEL_HA_EXECUTE=run_hostinger_failover_agent \
  LEMTEL_HA_ROLE=hostinger_standby \
  /usr/bin/bash /opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-failover-agent.sh preflight
```

Le mode explicite `poll` n’exécute qu’un appel authentifié à l’arbitre. Les actions locales de promotion/runtime exigent le reçu HMAC déjà vérifié et persisté, le même incident, recovery/streaming, stage chiffré arrêté, intégrité Storage et absence de listener PostgreSQL public. L’agent ne fabrique ni preuve de fournisseur, ni état de promotion, ni preuve de writer unique ; il ne conserve que les champs validés du reçu émis par l’arbitre. Il masque les sorties des scripts locaux et toutes les exceptions réseau/config pour éviter une fuite de secrets.

## Validation locale livrée

```bash
bash -n infra/lemtel-resilience/automatic-failover/lemtel-ha-hostinger-failover-agent.sh
node --check infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs
node --test scripts/lemtel-failover-arbiter.test.mjs scripts/lemtel-failover-execution-protocol.test.mjs scripts/lemtel-sealed-arbiter-bootstrap.test.mjs
node --test scripts/lemtel-current-topology-failover-gate.test.mjs scripts/lemtel-current-topology-failover-guards.test.mjs
git diff --check
```

Aucun frontend modifié, donc aucun build frontend requis. Ces validations sont **sans réseau ni fournisseur** et ne constituent ni un drill destructif ni une preuve de disponibilité en production.
