# Lemtel — prévol d’activation de l’observabilité trafic

Le script `infra/lemtel-resilience/traffic-observability/lemtel-ha-do-writer-traffic-runtime-preflight.sh` est un **prévol local, root-only et strictement lecture seule** pour le writer DigitalOcean. Son seul objectif est de dire si l’état local est suffisamment cohérent pour **préparer** une revue transactionnelle redacted de la télémétrie trafic.

> `activation_preflight_ready=true` **n’autorise pas une activation**. Cette valeur ne remplace ni l’approbation de changement, ni le snapshot frais, ni la revue du paquet transactionnel, ni les validations séparées de sécurité et de restauration.

## Utilisation locale non secrète

Ne l’exécuter que localement sur le writer DigitalOcean, par un opérateur root, et jamais depuis CI, un build, un installateur ou une session distante automatisée :

```sh
sudo env LEMTEL_HA_ROLE=digitalocean_writer \
  bash infra/lemtel-resilience/traffic-observability/lemtel-ha-do-writer-traffic-runtime-preflight.sh
```

La commande ne prend **aucun argument**. Le seul environnement montré ci-dessus décrit le rôle; il ne contient pas de valeur de configuration, d’adresse ou de donnée d’authentification. Ne pas rediriger sa sortie vers un emplacement partagé : même redacted, elle est une observation opérationnelle locale.

## Ce qui est vérifié

La sortie est exclusivement constituée de lignes `key=value`. Ses valeurs sont des booléens, compteurs ou énumérations non sensibles; elle ne divulgue ni nom de conteneur, ni chemin, ni libellé Compose, ni adresse, ni URL, ni valeur de configuration.

| Groupe | États redacted rapportés | Interprétation pour la préparation |
|---|---|---|
| Caddy | nombre/unicité du candidat, exécution, montage, Caddyfile et `ingress_route=absent|ready|invalid` | `ready` exige le marqueur exact de la route, le chemin exact et `log_skip`. `absent` peut être un état sain avant une transaction; `invalid` bloque. |
| Edge | nombre/unicité du candidat, exécution, montage des fonctions, sources de fonctions, source admin et paire `lemtel-traffic-ingest` (index + manifeste) | Tous les états de présence requis doivent être satisfaisants. Aucun contenu de source Edge n’est imprimé. |
| Compose | présence redacted des labels de projet, service et fichiers de configuration; disponibilité de la commande Compose | Seule la présence est attestée. Aucune valeur de label ou de fichier de configuration n’est lue dans la sortie. |
| Configuration collecteur | `collector_config=absent|safe|unsafe` | `safe` signifie seulement métadonnées régulières root/0600/non-symlink. Le fichier n’est jamais ouvert ni lu. `absent` est acceptable pour préparer une transaction; `unsafe` bloque. |
| Units locales | `collector_timer` et `collector_service` à `active|disabled|absent` | Un état actif, en échec ou indéterminé est traité de façon conservatrice comme non sûr; le prévol ne démarre, n’arrête, n’active ni ne désactive jamais une unité. |

Le prévol interroge exclusivement le runtime local via des inspections Docker à templates réduits, des métadonnées de système de fichiers, et les lectures `systemctl show` / `systemctl is-enabled`. Il ne lance aucune commande dans un conteneur, n’utilise pas de configuration Compose, ne fait aucun appel SQL ou HTTP, et ne contacte aucun hôte.

## Résultat et échec fermé

Le script retourne `0` seulement avec `traffic_runtime_preflight_status=complete` et `activation_preflight_ready=true`. Toute absence, ambiguïté, unité non sûrement inactive, configuration non sûre ou incapacité à lire le runtime produit `activation_preflight_ready=false`, un statut d’échec, une `reason=` générique, et un code non nul. Les raisons sont volontairement génériques afin de ne pas transformer le prévol en canal de fuite.

`ingress_route=ready` confirme seulement la forme redacted de la route locale attendue. Il ne confirme pas qu’une requête peut être traitée, ni qu’une cible répond. `ingress_route=absent` n’implique pas qu’une route sera créée automatiquement.

## Limites explicites

Ce prévol :

- ne crée, ne lit, ne réutilise, ne distribue et ne valide **aucune** valeur de secret;
- ne confirme jamais l’existence d’un endpoint trafic, d’une preuve HMAC, d’une migration SQL, ou d’un résultat d’ingestion;
- n’active aucun collecteur, timer, service, route, conteneur ou configuration;
- ne recharge pas Caddy et ne redémarre aucun runtime;
- ne crée aucun snapshot, backup, rollback, changement DNS, promotion HA ou contact de fournisseur;
- ne remplace pas les tests synthétiques distincts, les contrôles SQL/RBAC, ni l’attestation des logs d’accès Caddy et Edge.

Avant toute activation réelle, une revue transactionnelle distincte reste obligatoire : disposer d’un **snapshot frais** créé et revu par l’opérateur, vérifier le backup et le rollback, faire approuver le paquet schema/Edge/Caddy, contrôler les journaux d’accès de route, réaliser les tests synthétiques et l’autorisation explicite d’activation locale. Le prévol ne constitue jamais cette autorisation.
