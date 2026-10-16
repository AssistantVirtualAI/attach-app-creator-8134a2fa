# Lemtel — publisher de statut de nœud redacted

**Implémentation source-only.** Aucun déploiement, appel externe, création de secret, installation, démarrage de runtime, timer, routage, DNS, promotion, fencing ou failover n’est effectué par ce répertoire.

Le script `lemtel-node-status-publish.sh` est un publisher **root-only** à sens unique. Il ne lit ni ne publie une IP, hostname, identifiant, nom de conteneur, réseau, erreur brute, métrique, client, donnée téléphonique ou contenu. Il ne lance aucune commande distante et ne contacte aucun fournisseur : son unique transport potentiel est le endpoint privé Lemtel déjà configuré localement.

## Contrat de configuration future

Une phase séparée et explicitement approuvée pourrait installer le script et créer `/etc/lemtel-ha/node-status-publisher.env`. Le fichier doit déjà être un fichier régulier `root:root` **0600**, à un seul lien, sans symlink et avec des parents root non inscriptibles par groupe/autres. Le script refuse toute autre condition et ne fait jamais `source`/`eval`.

Les sept clés simples, sans guillemets ni clés supplémentaires, seraient :

| Clé | Contrat |
|---|---|
| `LEMTEL_NODE_STATUS_ENDPOINT` | Nom DNS HTTPS canonique, chemin exact `/functions/v1/lemtel-node-status-ingest`, sans IP, port, query, fragment ni userinfo. |
| `LEMTEL_NODE_STATUS_SECRET` | Une valeur runtime de 64 hex minuscules; distincte selon le rôle et jamais documentée, affichée ou versionnée. |
| `LEMTEL_NODE_STATUS_NODE_ROLE` | Exactement `do_writer` ou `hostinger_standby`. |
| `LEMTEL_NODE_STATUS_AGENT_STATE` | `healthy`, `degraded` ou `unknown`. |
| `LEMTEL_NODE_STATUS_RUNTIME_STATE` | `ready`, `degraded` ou `unknown`. |
| `LEMTEL_NODE_STATUS_REPLICATION_STATE` | `streaming`, `degraded` ou `unknown`. |
| `LEMTEL_NODE_STATUS_STORAGE_STATE` | `synced`, `degraded` ou `unknown`. |

`--check-config` vérifie exclusivement ce contrat local; il ne contacte aucun endpoint. En mode normal, le payload canonique est limité aux six champs allowlist, signé HMAC SHA-256, et envoyé via stdin de `curl` avec HTTPS obligatoire, pas de proxy/redirection, timeout borné, aucune verbosité ni retry. La sortie est uniquement `status=<enum>`.

## systemd

`systemd/lemtel-node-status-publisher.service` et `.timer` sont des sources **désactivées par défaut**. Elles ne sont pas installées par ce changement. Aucune commande d’installation ou d’activation n’est fournie afin qu’un futur changement ne puisse pas être confondu avec cette préparation source-only.

Une future installation ne serait envisageable qu’après les gates documentées dans [`docs/lemtel-ha/NODE_STATUS_OBSERVABILITY_THREAT_MODEL.md`](../../../docs/lemtel-ha/NODE_STATUS_OBSERVABILITY_THREAT_MODEL.md). Elle doit rester une décision locale et séparée; elle ne donne aucune autorisation de démarrer un runtime, promouvoir un standby, modifier le routage ou activer le failover automatique.
