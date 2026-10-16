# Lemtel — observabilité privée du trafic hôte

**Implémentation uniquement : aucun déploiement, provisionnement, timer ou appel aux serveurs n’est effectué par ce changement.** L’activation reste une phase distincte, après revue du paquet transactionnel et création de la configuration root-only. Aucun chiffre réel n’est actuellement attendu ou inventé.

## Périmètre et données

Seuls `do_writer` (DigitalOcean) et `hostinger_standby` sont acceptés. Le rôle décrit l’origine du relevé, **pas une commande ni une preuve de promotion**. Il n’autorise aucun démarrage du standby, changement DNS, fencing ou bascule.

L’enveloppe contient exclusivement, dans cet ordre : `nodeRole`, `observedAt`, `periodSeconds`, `rxBytes`, `txBytes`, `tcpEstablished`. `observedAt` est un bucket UTC à la minute (`YYYY-MM-DDTHH:mm:00Z`), les octets sont des **deltas mesurés** et TCP un **compteur agrégé instantané**, jamais additionné sur le temps. L’état collecteur est dérivé de la fraîcheur de réception.

**Exclus partout dans les données et journaux applicatifs** : adresses, interfaces détaillées, SNI, URL de trafic, paquets, contenu, ports détaillés, clients, identifiants utilisateur/appareil. Aucune liaison avec la téléphonie ou d’autres produits. L’endpoint HTTPS est une configuration de transport root-only, jamais une métrique, un champ stocké ou un libellé exposé au portail. Le transport observe nécessairement une adresse source : **aucun access log proxy/gateway/Edge sur cette route ne doit la conserver**. Le writer attesté utilise un chemin **direct Caddy → Edge**, sans conteneur gateway/JWT global ; une transaction root-only ajoute donc la route exacte avec `log_skip`. Cette exigence est vérifiée avant activation, jamais supposée.

## Paquet et migration

La prochaine migration physique est **0017**, après `0016_lemtel_platform_administrator_audit.sql`. Son manifeste incrémental est `infra/lemtel-self-hosted/migrations/lemtel-traffic-manifest.json`; le paquet dédié et ses SHA-256 sont dans `deployment-manifest.json` à côté de ce fichier. Le manifeste historique `migrations/manifest.json` et le manifeste Edge générique sont volontairement laissés au périmètre baseline/mobile-config qu’imposent leurs validateurs : ils ne sont pas des listes exhaustives des incréments. Le paquet trafic référence explicitement 0017 et sa dépendance à la baseline Lemtel existante.

La table `lemtel_traffic_samples` ne contient que rôle, bucket, intervalle, deltas, total TCP et état. RLS activée **sans aucune politique client**; toutes les permissions `PUBLIC`, `anon`, `authenticated` sont révoquées. `service_role` a uniquement `SELECT, INSERT` (aucun UPDATE/DELETE). Un trigger interne contrôlé supprime les données de plus de sept jours sur insertion. S’il n’y a plus d’insertions, les anciennes lignes peuvent rester physiquement présentes jusqu’à la reprise; les lectures excluent toujours ce qui est hors 24 h. Clé unique `(node_role, observed_at)` : première insertion gagnante, rejeu ignoré sans remplacer les chiffres.

Bornes : 30–300 s, deltas 0–10^12 octets, TCP 0–10^6, bucket minute UTC, horloge dans le passé ≤180 s ou futur ≤120 s. Le plafond de deux rôles et une ligne/minute borne à environ 20 160 relevés sur sept jours. Les erreurs SQL ne sont jamais renvoyées au collecteur.

## Authentification et lecture

Le secret **`LEMTEL_TRAFFIC_COLLECTOR_SECRET`** doit être généré hors dépôt : 32 octets aléatoires encodés en **64 caractères hexadécimaux minuscules**. Sa valeur n’est jamais décrite, imprimée, embarquée, ajoutée à argv ou passée au navigateur. La chaîne hexadécimale UTF-8 est la clé HMAC (elle n’est pas décodée en octets par un côté seulement). Même configuration côté Edge et deux collecteurs, rotation coordonnée séparée.

`X-Lemtel-Traffic-Signature` transporte `sha256=` suivi du HMAC-SHA256 du **corps exact JSON compact canonique** (sans espaces ni nouvelle ligne). La preuve n’est jamais loggée. L’Edge rejette champs inattendus/dupliqués, dates non canoniques, types incorrects, débordements, skew, secret absent/invalide ou HMAC invalide. Taille maximale 512 octets, lecture stream bornée. Les erreurs ont uniquement un statut HTTP; succès **204 sans contenu** (y compris doublon). Aucun `Access-Control-Allow-Origin`; tout POST contenant `Origin` est refusé, OPTIONS sans autorisation de navigateur. Il n’y a pas de gateway JWT sur le writer attesté : la route Caddy exacte est protégée exclusivement par l’HMAC de cette fonction, avec `log_skip`; **aucun bypass JWT global** n’est créé.

`get_traffic_trend` est une action exacte de `lemtel-onboarding-admin`, authentifiée puis **platform-admin actif uniquement**, read-only et sans audit identifiant ajouté. Elle retourne deux rôles, une fenêtre de 24 h, des buckets de cinq minutes **sparse**, les deltas additionnés par bucket, les secondes réellement couvertes, et le dernier total TCP (gauge). Pagination explicite jusqu’à 2 880 lignes/minute; aucun trou n’est rempli de zéros. Dernier relevé de moins de 180 s : `collecting`, sinon `pending`; cela ne signifie pas que le serveur est sain. Une erreur de lecture est indisponible, pas une absence de collecteur.

## Collecteur local et phase future

Deux scripts shell seulement, **root-only**, dépendances locales standard : Bash, Python 3, curl et systemd pour l’installateur. Ils n’installent aucune dépendance.

Configuration exigée : `/etc/lemtel-ha/traffic-collector.env`, fichier régulier **root 0600**, non symlink, un lien, parents root non modifiables par groupe/autres. Pas de `source` ou `eval`. Trois affectations simples (sans guillemets), aucune autre clé :

- `LEMTEL_TRAFFIC_NODE_ROLE` : exactement `do_writer` ou `hostinger_standby`;
- `LEMTEL_TRAFFIC_ENDPOINT` : endpoint HTTPS canonique approuvé, nom DNS et chemin `/functions/v1/lemtel-traffic-ingest`, sans IP littérale, port explicite, userinfo, query ou fragment;
- `LEMTEL_TRAFFIC_COLLECTOR_SECRET` : secret au format ci-dessus, jamais sa valeur dans la documentation.

`lemtel-traffic-collect.sh --check-config` vérifie la configuration sans lire de compteurs ni appeler curl. Le mode normal agrège `/proc/net/dev` hors loopback, compte seulement l’état `01` des tables TCP/TCP6 locales et garde une baseline **uniquement agrégée** dans `/var/lib/lemtel-traffic-collector` root 0700 / fichiers 0600, protégée par flock. Premier relevé, reboot/reset compteur ou intervalle trop long : baseline, **aucun faux delta zéro**. Moins de 30 s ou même minute : attente. Tous les ports/adresses des tables proc sont ignorés et jamais conservés. Les interfaces virtuelles peuvent doubler certains volumes : il s’agit d’activité hôte, pas de bande passante facturable ou de volume client.

HMAC et payload sont passés à curl via stdin, pas argv, sans verbose, redirection, proxy ni retry, TLS obligatoire, timeouts bornés; seule la clé `status=<enum>` apparaît au journal. La baseline avance **avant** l’envoi : collecte best-effort, trous possibles après échec, pas de backfill ni double comptage après un résultat HTTP ambigu. Un accès préexistant mal protégé ou une configuration invalide provoque un refus contrôlé, sans détails.

L’installateur `lemtel-traffic-timer-enable.sh` ne peut être appelé que dans la phase séparée avec confirmation `enable-lemtel-traffic-collector`, gate `LEMTEL_TRAFFIC_ACTIVATION_APPROVED=transactional-package-ready`, revue locale explicite et attestation de rollback local revue. Il revalide la configuration **avant** les écritures locales. Timer 60 s, jitter ≤10 s, pas de rattrapage; service root durci, journaux status-only. **Ne l’exécuter ni via build, package, postinstall ou CI, ni aujourd’hui.** Ces gates ne sont pas des attestations automatiques de sécurité.

Avant toute activation réelle : approbation de changement DO writer explicitement revue; snapshot DO créé par l’opérateur et restauration revue (jamais automatisés par le paquet); backup et rollback vérifiés; schema 0017 + Edge ingress + admin + route et secrets assemblés en paquet transactionnel revu; attestation de suppression/vérification des logs d’accès **Caddy et Edge** sur toute la route; clock sync; tests SQL des droits/contraintes/retention, HMAC synthetic et RBAC réels; application atomique approuvée; configuration root-only sur chaque rôle; puis activation locale explicitement autorisée. L’installateur du timer seul **n’est pas** le paquet transactionnel de déploiement. Aucun provisioning Cloudflare/DigitalOcean/Hostinger depuis ce sous-travail.

## Générateur du paquet transactionnel redacted

`scripts/lemtel-traffic-observability-deploy-package.mjs` scelle une archive `tar` reproductible et son sidecar SHA-256. L’archive ne contient que `manifest.sha256`, `deployment-metadata.json`, la migration **0017**, `portal.tar`, et les deux paires source/manifest Edge que le déployeur `lemtel-ha-do-writer-traffic-observability-deploy.sh` exige. Elle exclut donc le collecteur, l’installateur du timer, l’applicateur Caddy, toute configuration globale JWT, les secrets, relevés, sauvegardes, adresses IP et données de contenu/PII.

Le portail est obtenu **uniquement** par téléchargement de l’artefact GitHub Actions nommé `lemtel-operations-portal-<run-id>`. Avant lecture, le générateur vérifie via l’API GitHub que le run est le workflow `.github/workflows/lemtel-operations-portal-build.yml`, terminé avec succès sur `lemtel/integration`, avec le même `head_sha` que `--source-revision`; il exige ensuite un artefact unique, non expiré, et un digest API `sha256:` puis recalcule ce SHA-256 sur le ZIP téléchargé. Les sources SQL/Edge sont lues depuis ce même objet Git, pas depuis le worktree. Il ne prend ni `--portal-dir` ni une sortie de build locale et ne lance ni déployeur, ni route Caddy, ni timer/collector, ni contact Hostinger/Cloudflare/téléphonie/failover.

Commande future, seulement lorsqu’une preuve existe :

```sh
node scripts/lemtel-traffic-observability-deploy-package.mjs \
  --github-run-id <run-id> \
  --source-revision <head-sha-du-run> \
  --output /chemin/prive/lemtel-traffic-observability.tar
```

Le résultat `package_status=blocked` est attendu et sûr pour tout run, digest, branche, révision, ZIP ou artefact manquant/non conforme; aucun fichier de paquet n’est alors créé. Lors de la validation de cette branche (base `ce156b4391cc92f8e052c61dc1fd7df608cb2a71`), aucun run réussi du workflow portail ne correspond à cette révision : les runs disponibles les plus récents précèdent cette base, et l’artefact a une rétention de trois jours. **Aucun paquet réel n’a donc été produit et aucun fallback de build local n’est autorisé.**

## UI et validation

Exploitation affiche les deux cartes responsive, derniers deltas/intervalle et TCP total, badges collecting/pending, SVG RX cyan et TX violet pointillé, aire RX, fenêtre 24 h, légende et titres accessibles. Les groupes séparés ne relient pas les buckets manquants. Sans aucun relevé, message exact :

> Aucun collecteur de trafic n’est encore provisionné : aucun chiffre n’est inventé.

Sans accès ou en panne : message indisponible, pas de métriques ni de faux zéro. Les tests locaux sont `scripts/lemtel-traffic-observability-contract.test.mjs`, Edge `lemtel-traffic-ingest/index.test.ts` et `lemtel-onboarding-admin/traffic.test.ts`, UI `LemtelTrafficObservability.test.tsx`. Les fetch/curl de tests sont entièrement simulés; aucune route réelle n’est appelée.
