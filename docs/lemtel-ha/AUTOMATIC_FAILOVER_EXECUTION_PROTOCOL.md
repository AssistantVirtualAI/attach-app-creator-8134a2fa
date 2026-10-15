# Lemtel — protocole d’exécution de failover, préparé et désactivé

## État de livraison : aucune bascule automatisée maintenant

**Ces fichiers ne sont ni déployés, ni installés, ni activés. Aucun secret, aucune configuration de production et aucun drill de production ne sont appliqués par cette livraison.** Le Worker est fermé par défaut ; l’agent ne peut jamais effectuer une promotion effective, même avec une commande valide. Le résultat maximal de l’agent est `manual_promotion_action_required`.

Un **agent installé en `disabled` n’est pas une activation** : il sort `blocked` (code `78`), sans lecture de commande distante, sans guard, sans promotion ni démarrage runtime. L’absence de `FAILOVER_MODE` a le même effet. Les unités sont des modèles **non installés**, sans section `[Install]` et sans lien à une cible de démarrage. Un démarrage explicite du timer ne serait pas une autorisation de promotion.

Le contrat et les guards de [PR234](CURRENT_AUTOMATIC_FAILOVER_GATES.md) sont **inchangés**, tous leurs flags restent à `false`. Les rôles du nouveau protocole sont exclusivement **`do_writer` → `hostinger_standby`**, un standby chaud privé. À la seule frontière d’appel du guard PR234, `hostinger_standby` est traduit vers son nom existant `hostinger_private_hot_standby` ; il ne s’agit ni d’une inversion de rôles ni d’une modification du contrat.

**Le routage Cloudflare est une révision séparée**, pas une variable permettant de contourner cette livraison : `automatic_traffic_routing_enabled` est toujours `false`. Aucune API LB, pool, DNS ou routage n’est utilisée. Aucun failback automatique. Aucun périmètre Planipret, Avastatistic, PBX/legacy Lemtel, FusionPBX ou téléphonie n’est touché.

## Artefacts et responsabilités

| Artefact | Responsabilité maximale |
|---|---|
| `lemtel-failover-arbiter-worker.mjs` | Worker sans dépendance ; HTTP de statut/boîte à commande, observation L7 et machine de fencing uniquement après toutes les gates. |
| `lemtel-ha-hostinger-failover-agent.sh` | Agent root-only ; preflight local ou collecte d’une commande, HMAC, échéance, ledger one-time et guard PR234 en lecture seule. |
| `.service` / `.timer` | Modèles non installés et non activés ; aucun auto-installeur et aucune section d’activation. |
| `scripts/lemtel-failover-execution-protocol.test.mjs` | Tests Node et contrôles de texte ; KV, horloge et HTTP simulés, aucun appel externe. |

## Bindings et secrets du Worker — uniquement des noms, aucune valeur

L’absence d’un seul prérequis en mode actif retourne/stocke `blocked`, **avant toute requête de santé ou de fournisseur et avant toute livraison de commande**. Un autre mode retourne/stocke `disabled_or_dry_run` ; le dry-run ne contacte pas non plus les fournisseurs.

| Nom | Rôle / validation |
|---|---|
| `FAILOVER_MODE` | Seule valeur permettant de considérer une exécution : `active`. Absent, `disabled`, `dry_run` ou toute autre valeur : aucune action. |
| `STATE` | Binding Workers KV avec `get` et `put` ; états, incident, commande et reçu de drill. Une panne de KV bloque. |
| `DO_API_TOKEN` | Secret fournisseur limité au writer et aux lectures/actions de puissance nécessaires. Au moins 32 caractères, jamais retourné ou journalisé. |
| `DO_WRITER_DROPLET_ID` | Identifiant du seul writer DO autorisé. Les réponses d’action et de puissance doivent correspondre exactement. Aucune valeur intégrée au source. |
| `DO_API_BASE_URL` | URL HTTPS de l’API DO, terminée par le chemin `/v2`, fournie hors code. Pas de credentials, query, fragment ou redirection. |
| `DO_WRITER_L7_URL` | Endpoint HTTPS **direct et authentifié du writer**, jamais une adresse LB ou un standby. Adaptateur de santé à fournir et valider avant toute activation. |
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

Même avec `FAILOVER_MODE=active` et toutes les variables présentes, le Worker reste bloqué sans reçu signé valide sous la clé KV `lemtel_failover_execution_v1:production-drill`.

Ce reçu est une enveloppe `{payload, signature}`. Le payload comporte `format=lemtel_production_destructive_drill_v1`, `config_revision`, `writer_role=do_writer`, `target_role=hostinger_standby`, `writer_droplet_id`, `destructive_drill_validated`, `serialized_execution_verified`, `validated_at` et `expires_at`. Les deux validations doivent être booléennes positives, la révision et le writer doivent correspondre, les timestamps sont des secondes Unix entières, la validité maximale est de 24 heures. **Aucun reçu signé n’est fourni ici.**

La signature est HMAC-SHA256 en hexadécimal minuscule, sous `DRILL_APPROVAL_SECRET`, du contexte `lemtel-production-drill-v1`, suivi d’un saut de ligne et du JSON canonique (clés triées récursivement, sans espaces). L’outil de délivrance du reçu et sa procédure humaine ne sont pas livrés ; l’identité d’approbation et la rotation sont à contrôler hors bande.

**KV n’est pas un verrou transactionnel, ne fournit ni CAS ni garantie de lecture globale immédiate.** Le verrou d’isolate du Worker évite seulement un chevauchement local. La production exige une revue et une preuve d’un exécuteur réellement sérialisé, avec persistence cohérente ; si une primitive de verrouillage forte est nécessaire, elle doit faire l’objet d’une révision avant autorisation. Ne jamais remplir l’accusé ou signer le reçu pour masquer cette limitation. Le ledger atomique local de l’agent empêche une seconde consommation du même incident, mais ne remplace pas la sérialisation du fencing côté Worker.

Après revue du code, choix d’une sérialisation sûre, configuration sécurisée, preflight et préparation des procédures de récupération, **un drill destructif reste la dernière gate**, supervisée et autorisée séparément. La réception d’un reçu n’autorise dans cet artefact que le chemin de fencing et la commande de readiness : elle ne rend pas les flags PR234 positifs et n’autorise pas une promotion, un runtime ou du trafic automatiques.

## Écriture planifiée du Worker et endpoints

La configuration Workers et son cron doivent être préparés dans une étape séparée ; **aucun manifeste actif ni déploiement n’est livré**. Le cycle `scheduled` appelle la machine et rattache sa promesse à `ctx.waitUntil`. Les requêtes HTTP ne déclenchent jamais le fencing.

| Entrée | Effet limité |
|---|---|
| `GET /healthz`, `GET /status` | État de sécurité sans secrets, IDs fournisseur ou commande. Pas un signal autorisant le routage. |
| `GET /agent/command` | Nécessite toutes les gates et `Authorization: Bearer` sous le secret partagé ; ne livre qu’une commande disponible et non expirée. |
| Autres méthodes/chemins en actif | Refus ; aucun endpoint permettant de lancer un incident ou de réinitialiser un fence. |

Les clés KV `lemtel_failover_execution_v1:status` et `lemtel_failover_execution_v1:incident` sont écrites par la machine ; l’incident conserve la révision, les compteurs, phases, intentions/actions et éventuellement une enveloppe de commande. Le statut public ne contient que des états de sécurité. En mode désactivé, seul le statut peut être écrit ; l’incident existant n’est pas effacé ni réarmé.

Une intention destructive est persistée **avant** chaque POST fournisseur. Une intention retrouvée après interruption, un résultat inconnu, un état terminal ambigu, un timeout ou une phase inconnue bloque durablement l’incident ; aucune relance implicite du POST. La remise en état exige une procédure humaine distincte avec preuves fraîches, pas une suppression opportuniste du KV ou du ledger.

## Séquence multi-phase préparée

1. **Observation L7 DO** : l’adaptateur doit répondre JSON `format=lemtel_do_writer_l7_observation_v1`, `writer_role=do_writer`, `definitive=true`, timestamp `observed_at` récent (120 secondes maximum, tolérance future 15 secondes). `HTTP 200` et `status=healthy` effacent la suspicion. Seuls `HTTP 503`, `status=unhealthy`, `reason=writer_unavailable` et les autres champs valides comptent comme échec définitif. Un timeout, un échec réseau, un autre HTTP 5xx, un JSON invalide ou stale sont **ambigus**, jamais une autorisation de fence ou de promotion. Ce nouveau format ne doit pas être supposé compatible avec un ancien endpoint existant.
2. **Suspicion d’incident** : plusieurs cycles consécutifs espacés ; création d’un `incident_id` à usage unique. Aucune action fournisseur avant le seuil.
3. **Fencing graceful** : intention persistée puis une action DO `shutdown` ; l’action et son propriétaire sont validés.
4. **Délai puis hard fence** : polling de l’action et de la puissance. `power_off` seulement si le writer n’a pas été confirmé éteint et après le délai graceful ; jamais sur une réponse provider ambiguë.
5. **Polling terminal** : action `completed` et droplet `off`, avec deux confirmations espacées. Une nouvelle vérification terminale est exigée juste avant l’émission ; un retour à `active` bloque.
6. **Reçu de fence signé** : incident, writer, droplet configuré, action, état `off`, confirmations et timestamp liés sous HMAC, contexte `lemtel-fence-receipt-v1`. Ce reçu n’est **pas** une substitution à l’attestation GPG hors bande exigée par PR234.
7. **Commande `promotion`** : enveloppe signée, contexte `lemtel-promotion-command-v1`, avec `incident_id`, nonce, rôles, `issued_at`, `expires_at` et reçu signé. Le nom décrit la phase visée ; **ce n’est pas une instruction permettant une promotion effective dans l’agent actuel**.
8. **Hostinger : guards seulement** : vérification cryptographique, échéance, correspondance du writer et claim durable de l’incident, puis guard local PR234. Si succès : `manual_promotion_action_required`. Si échec/crash : incident quand même consommé, `blocked`, revue humaine. Aucune promotion effective.
9. **Séquence future hors de cet artefact** : promotion manuelle distinctement autorisée, preuve signée de writer unique, guard PR234 post-promotion, démarrage runtime distinctement autorisé ; ensuite seulement éventuelle révision de routage Cloudflare, drill de trafic/retry et procédure de reverse failback. Ne jamais enchaîner ces actions depuis cet agent.

La boîte à commande marque l’intention de livraison avant réponse et ne réémet pas automatiquement. La consommation one-time est garantie localement par un fichier `.consumed` créé atomiquement avec `O_EXCL`/`O_NOFOLLOW` et synchronisé sur disque **avant le guard**. Une livraison perdue, une réponse réseau incertaine ou une expiration demande une intervention humaine, pas une nouvelle commande sur le même incident.

## Agent root-only et preflight

L’agent nécessite Linux, Bash, `/usr/bin/python3` standard (mode isolé `-I`), et les dépendances de lecture des guards PR234. Il ne s’installe et ne se lance jamais lui-même. Gate d’entrée exacte : `LEMTEL_HA_EXECUTE=run_hostinger_failover_agent` et `LEMTEL_HA_ROLE=hostinger_standby`, avec UID root. Aucune valeur de mode ou de secret héritée du processus n’est utilisée comme configuration.

Le seul fichier chargé est `/etc/lemtel-ha/failover-agent.env`, propriétaire root, fichier régulier `0600`, sans symlink, dans une chaîne de répertoires root non inscriptibles par groupe/autres. Parsing strict de lignes littérales `KEY=value` : pas de `source`, `eval`, expansion, quotes, variable inconnue ou doublon. Clés autorisées :

| Clé | Usage |
|---|---|
| `FAILOVER_MODE` | Absent ou autre que `active` : `blocked`, aucune requête distante. |
| `ARBITER_URL` | Origine HTTPS sans credentials, query, fragment ou autre chemin ; seule route distante `/agent/command`, pas de redirection/proxy. |
| `AGENT_SHARED_SECRET` | Même secret que le Worker, jamais en argument CLI ou en sortie. |
| `DO_WRITER_DROPLET_ID` | Writer attendu ; doit correspondre au reçu signé. |
| `LEMTEL_HA_LOCAL_POSTGRES_CONTAINER` | Container standby local à inspecter par PR234, pas une cible distante. |

Le chemin de guard fixe est `/opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-auto-promotion-guard.sh`, root `0755` dans une chaîne de répertoires non inscriptibles par d’autres utilisateurs. Le ledger privé est `/var/lib/lemtel-ha/failover-agent` (`0700`, fichiers `0600`). L’installation de ces chemins n’est pas effectuée par cette livraison.

`preflight` est le mode par défaut : contrôles root/gate/rôle, fichier et configuration, chemin de guard ; **aucune requête réseau, aucun fichier d’incident créé et aucun guard exécuté**. Un preflight en disabled sort `blocked`, jamais « prêt pour promotion ». Un preflight positif ne vérifie ni la connectivité ni les secrets distants ni les preuves de PR234.

Exemple d’invocation **uniquement sur une installation locale revue, pour lecture**, sans secret sur la ligne de commande :

```bash
sudo env LEMTEL_HA_EXECUTE=run_hostinger_failover_agent \
  LEMTEL_HA_ROLE=hostinger_standby \
  /usr/bin/bash /opt/lemtel-ha/automatic-failover/lemtel-ha-hostinger-failover-agent.sh preflight
```

Le mode explicite `poll` n’exécute qu’un appel authentifié à l’arbitre. Le guard PR234 conserve ses exigences : attestation GPG fournisseur hors bande, incident concordant, recovery/streaming, stage chiffré arrêté et absence de listener public. L’agent ne fabrique ni attestation, ni promotion state, ni preuve de writer unique. Il masque les sorties du guard et toutes les exceptions réseau/config pour éviter une fuite de secrets.

## Validation locale livrée

```bash
bash -n infra/lemtel-resilience/automatic-failover/lemtel-ha-hostinger-failover-agent.sh
node --test scripts/lemtel-failover-execution-protocol.test.mjs
node --test scripts/lemtel-current-topology-failover-gate.test.mjs scripts/lemtel-current-topology-failover-guards.test.mjs
git diff --check
```

Aucun frontend modifié, donc aucun build frontend requis. Ces validations sont **sans réseau ni fournisseur** et ne constituent ni un drill destructif ni une preuve de disponibilité en production.
