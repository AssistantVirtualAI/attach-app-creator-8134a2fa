# Lemtel — paquet source de transaction d’activation DO writer

**Livraison source seulement. Ne pas exécuter cette transaction dans cette tâche, en CI, dans un build, un postinstall ou un déploiement inactif.** Aucun hôte n’a été contacté et aucun secret n’a été créé par cette livraison. Le paquet distinct est décrit par `infra/lemtel-resilience/traffic-observability/activation-package-manifest.json`; son point d’entrée est `lemtel-ha-do-writer-traffic-activation-apply.sh`. Il référence quatre helpers existants, inchangés et vérifiés par SHA-256, plutôt que de modifier le déployeur inactif ou ses manifestes.

> `activation_preflight_ready=true` ne constitue **jamais** une autorisation d’activation. Un **snapshot chiffré frais**, créé par l’opérateur, ainsi qu’une revue de restauration et une approbation explicite du **mode activation** sont indispensables. Les tokens sont des attestations humaines, pas des preuves fabriquées par le programme.

## Périmètre exact

Une exécution future réussie rend **uniquement le collecteur DO actif**, avec les adaptations locales nécessaires : configuration collecteur root-only, variable HMAC dans le seul service Edge, route exacte Caddy avec `log_skip`, timer existant. Elle ne déploie ni migration ni code Edge/portail. Elle ne crée ni snapshot ni backup fournisseur. La sauvegarde locale Caddy, ses métadonnées de restauration et les verrous ne sont que des moyens transactionnels.

Aucun Hostinger, Cloudflare, DNS/LB, failover automatique, fencing, téléphonie, PBX, Planiprêt ou Avastatistic n’entre dans le périmètre. Aucun accès SQL ou lecture de données métier. Aucun bypass JWT global ou route alternative.

Toutes les attestations de résultat comprennent explicitement :

```text
hostinger_contacted=false
cloudflare_or_dns_changed=false
automatic_failover_enabled=false
fencing_executed=false
telephony_contacted=false
credential_values_emitted=false
```

## Entrée opérateur, fail-closed

Exécution **locale sur DO writer**, root, **zéro argument**. Le programme doit être installé avec ses quatre helpers dans un répertoire root-owned, non symlink, dont tous les parents sont non modifiables par groupe/autres. Les sources doivent être régulières, root-owned, un seul lien et non modifiables par groupe/autres. Revoir leurs empreintes et le manifeste avant toute exécution future.

L’opérateur établit séparément les attestations ci-dessous dans une session root propre, sans configuration ou valeur sensible dans l’environnement. Il ne faut jamais copier les valeurs d’authentification dans une commande, le dépôt, un ticket ou un journal. Ne pas utiliser de traçage shell ou de capture de terminal intrusive. Le point d’entrée peut alors être lancé localement par `/usr/bin/bash`, sans argument applicatif.

| Gate | Valeur d’intention ou attestation exacte, non sensible |
|---|---|
| `LEMTEL_HA_ROLE` | `digitalocean_writer` |
| `LEMTEL_TRAFFIC_ACTIVATION_EXECUTE` | `activate_verified_do_writer_traffic_transaction` |
| `LEMTEL_TRAFFIC_ACTIVATION_SNAPSHOT_ATTESTATION` | `FRESH_ENCRYPTED_DO_WRITER_SNAPSHOT_CREATED_AND_RESTORE_REVIEWED` |
| `LEMTEL_TRAFFIC_ACTIVATION_BACKUP_ATTESTATION` | `FRESH_ENCRYPTED_WRITER_BACKUP_VERIFIED` |
| `LEMTEL_TRAFFIC_ACTIVATION_PACKAGE_REVIEW` | `REVIEWED_DO_WRITER_TRAFFIC_TRANSACTION` |
| `LEMTEL_TRAFFIC_ACTIVATION_ROLLBACK_ATTESTATION` | `DO_WRITER_TRAFFIC_ROLLBACK_REVIEWED` |
| `LEMTEL_TRAFFIC_EDGE_LOG_ATTESTATION` | `EDGE_AND_ROUTE_ACCESS_LOGS_DISABLED_VERIFIED` |
| `LEMTEL_TRAFFIC_ACTIVATION_REVIEW_APPROVED` | `REVIEWED_LOCAL_COLLECTOR_ACTIVATION` |
| `LEMTEL_TRAFFIC_ACTIVATION_SCHEMA_ATTESTATION` | `INACTIVE_TRAFFIC_SCHEMA_AND_RBAC_VERIFIED` |

Une gate absente ou incorrecte échoue **avant toute mutation**. L’approbation du mode activation est distincte de la revue du paquet et du prévol. Le wrapper ne transmet les gates des deux installateurs qu’après validation de toutes ces attestations; il ne leur délègue pas l’autorisation globale.

## Conditions locales et refus conservateurs

1. Le prévol runtime existant est vérifié par empreinte, exécuté **dans** la transaction et doit réussir avant la première création locale. Le wrapper est plus strict : aucune configuration, unité chargée même désactivée, baseline, bibliothèque collecteur ou lien de timer préexistant n’est accepté. Il ne s’agit pas d’une mise à jour ou d’une rotation.
2. Le seul conteneur exact `supabase-edge-functions` et le seul `supabase-caddy` doivent être running. Projet/service Compose, numéro de conteneur et statut non-oneoff doivent être sans ambiguïté. Les chemins de configuration viennent uniquement des labels réels, restent en mémoire et ne sont jamais rapportés.
3. Les fichiers Compose sont réguliers, root-owned, non symlinks, un lien, avec parents root non modifiables par groupe/autres. Les fichiers d’environnement initiaux éventuels sont **0600**. Le label de working directory est utilisé s’il existe; sinon le répertoire du premier fichier labelisé. Le label de fichiers d’environnement est utilisé s’il existe; sinon seulement le `.env` de ce répertoire. Les chemins relatifs, caractères ambigus, doublons et configurations qui produisent des avertissements sont refusés.
4. Avec un environnement enfant minimal et le socket Docker local uniquement, le hash Compose du service initial doit égaler le label `com.docker.compose.config-hash`. Un contexte dépendant d’anciennes variables exportées, d’un autre env-file non identifiable ou d’une version Compose incompatible bloque plutôt que de reconstruire un service avec des paramètres manquants. Les mêmes fichiers et empreintes de métadonnées sont revérifiés avant changement et rollback. Aucune maintenance Compose/Caddy concurrente ne doit avoir lieu.
5. Le Caddyfile doit être régulier et sûr. La transaction vérifie les préconditions exactes du helper, sauvegarde une copie **root 0600** dans un répertoire **0700**, vérifie son digest en mémoire et enregistre seulement digest/uid/gid/mode dans `caddy-backup.metadata.json` root 0600. Après le helper, l’ensemble du Caddyfile doit être exactement l’original plus son insertion prévue — ou identique si cette route était déjà prête. `log_skip` est revérifié.
6. **Limite volontaire du helper inchangé :** son arbre `caddy-backups` utilise des timestamps. Le wrapper refuse un arbre préexistant pour ne jamais risquer d’écraser une sauvegarde antérieure. Ne pas supprimer cet arbre pour contourner le refus : toute adaptation à un writer avec historique doit faire l’objet d’une nouvelle revue source. Les copies générées par le helper sont conservées dans leurs répertoires root-only.
7. La source de migration déjà déployée doit être présente sous le chemin de bundle inactif qu’utilise le déployeur existant, et les sources admin/ingress ainsi que le manifeste ingress doivent être présents dans le montage Edge. Le contrôle est uniquement **FS/métadonnées**, sans lire ces fichiers. Cela ne prouve **pas** l’état du schema en base : les tests schema/RBAC/HMAC distincts doivent déjà avoir été validés par l’opérateur. L’horloge doit être attestée synchronisée par `timedatectl`.

Les dépendances locales doivent déjà exister : Bash, Python 3 et sa bibliothèque standard cryptographique, Docker/Compose compatible, systemd et timedatectl; shell disponible dans Edge pour le contrôle de format non bavard. Aucun paquet système, image ou dépendance n’est installé ou téléchargé. `--no-build --pull never` interdit construction ou pull; `--no-deps` et le service labelisé limitent toute re-création à Edge.

## Séquence transactionnelle future

- Vérifier les gates, les helpers source, le prévol intégré et toutes les conditions locales, **sans mutation**. Générer en mémoire 32 octets via `secrets.token_hex(32)`; tout échec du CSPRNG ou format autre que 64 hex minuscules bloque avant écriture.
- Créer exclusivement les fichiers de ce run avec `O_EXCL`, `O_NOFOLLOW`, umask 077 et vérification root/0600/régulier/un lien. Le secret ne rejoint que la configuration collecteur et un env-file Docker temporaire. Le transport est dérivé localement de l’hôte canonique du helper Caddy et du chemin ingress exact; il n’est jamais affiché.
- Créer un override YAML root-only **nouveau** contenant uniquement le service labelisé et l’interpolation de `LEMTEL_TRAFFIC_COLLECTOR_SECRET`. L’override ne contient aucune valeur de secret. Compose lit le fichier d’environnement root-only; le secret n’est ni en argv ni dans l’environnement du shell ou des processus de commande. Vérifier `--check-config` avant toute re-création.
- Recomposer uniquement Edge sans dépendances depuis les fichiers initiaux plus cet override. Vérifier unicité, nouveau conteneur running, labels cohérents et présence unique de la variable. Le contrôle dans Edge vérifie son format **sans aucune sortie de valeur**.
- Encapsuler strictement `lemtel-ha-do-writer-traffic-ingress-route-apply.sh`, gates adéquates et diagnostics capturés sans affichage; vérifier l’identité de toutes les autres routes et `log_skip`.
- Revalider `--check-config`, puis appeler **une seule fois** le collecteur avant l’installation du timer, avec état initial absent. Il doit retourner `status=baseline_pending`; cette baseline n’envoie aucune mesure. Le programme n’appelle plus le collecteur, ne déclenche pas de service supplémentaire et ne dort pas pour forcer une métrique.
- Appeler uniquement `lemtel-traffic-timer-enable.sh` avec ses trois gates propres. Vérifier timer enabled/active, métadonnées config, route ready et Edge running. L’attestation conserve le statut de la **première** baseline, pas un prétendu état courant de données : `first_baseline_status=baseline_pending`, `metrics_visibility=not_verified`.

Le timer peut ensuite suivre sa cadence normale. **Aucune métrique visible n’est revendiquée.** Aucune deuxième collecte n’est forcée par la transaction.

Après réussite, les deux entrées Compose créées par ce run restent dans `edge-config` root 0700 : un env-file root 0600 contenant le secret et un override root 0600 qui ne contient qu’une interpolation. Le secret persiste ainsi seulement dans la configuration collecteur root 0600, l’env-file Edge root 0600 et la configuration interne du conteneur Edge ; aucun secret n’est placé dans l’override. Les labels Compose du nouvel Edge pointent donc vers des fichiers stables et protégés, ce qui permet une re-création ultérieure depuis la configuration réelle plutôt que depuis un chemin éphémère. Ce programme reste one-shot : un nouveau lancement refuse la configuration et les unités existantes, sans les modifier. La sauvegarde Caddy et ses métadonnées root-only restent disponibles pour restauration.

## Diagnostic de phase et rollback automatique

En cas de refus, l’attestation ajoute `activation_phase` : une étiquette redacted parmi `preflight`, `configuration`, `edge_recreate`, `ingress_route`, `baseline`, `timer` et `final_attestation`. Cette valeur sert uniquement à orienter une revue locale ; elle ne contient ni chemin, ni commande, ni sortie de conteneur, ni secret et ne transforme pas un refus en autorisation.

## Rollback automatique et manuel sûr

Sur erreur ou interruption gérée après la première mutation, les diagnostics restent redacted. Les sous-processus interrompus sont terminés par groupe avant rollback. Le programme :

1. désactive/arrête uniquement le timer puis le service **si l’installateur a été tenté par ce run**, avec préexistence déjà exclue;
2. restaure Caddy depuis sa copie 0600 vérifiée, avec mode/ownership initiaux, sous le verrou de route puis validation et reload local;
3. recompose seulement Edge, sans dépendance, avec **uniquement les fichiers Compose initiaux et leurs env-files initiaux**, sans override HMAC; vérifie running, hash initial et absence de la variable;
4. retire uniquement les fichiers secrets créés exclusivement par ce run, contrôlés par inode, puis les fichiers/unités collecteur initialement absents et les répertoires neufs vides. Pas de suppression récursive. Les sauvegardes Caddy vérifiées sont conservées. Aucun fichier antérieur n’est supprimé.

`rollback_status=manual_required` indique qu’au moins une étape n’a pu être confirmée. Le programme ne prétend jamais qu’un rollback a réussi après une erreur de restauration. Une modification concurrente de fichier initial bloque la re-composition plutôt que d’appliquer une configuration non vérifiée.

Pour un rollback **manuel local, explicitement approuvé**, y compris après réussite :

- Suspendre la maintenance concurrente, vérifier le snapshot frais/restauration et l’identité de ce run. Ne jamais afficher un Caddyfile, `.env`, inspect Docker complet, journal détaillé ou environnement. Garder toutes les captures dans la mémoire d’un outil root, avec stderr/stdout capturés et seulement statuts redacted émis.
- Seulement si les unités appartiennent à ce run, désactiver/arrêter `lemtel-traffic-collector.timer`, puis arrêter `lemtel-traffic-collector.service`; confirmer qu’aucun service de collecte n’est encore actif. N’arrêter aucune autre unité.
- Dans `activation-runs/run-*`, sélectionner **sans ambiguïté** la copie `Caddyfile.before` de ce run. Vérifier root/0600/régulier/non-symlink/un lien et son digest contre les métadonnées root 0600, **en mémoire**. Restaurer atomiquement le Caddyfile du montage de l’unique Caddy local avec uid/gid/mode des métadonnées. Prendre le verrou de route, valider et recharger uniquement Caddy; tous les diagnostics doivent rester capturés. Ne pas restaurer un fichier si une autre modification Caddy a été approuvée depuis : passer à une revue dédiée.
- Découvrir l’unique Edge et capturer ses labels seulement en mémoire. Reprendre projet/service/working directory et les env-files initiaux, vérifier leurs permissions et la configuration initiale contre la preuve revue. Recomposer **ce seul service** avec `--no-deps --force-recreate --no-build --pull never`, sans l’override, puis vérifier running et absence de la variable en sortie booléenne uniquement. Ne pas essayer de contourner un label ambigu ou non suffisant pour retrouver les fichiers initiaux.
- Supprimer uniquement la configuration collecteur et les entrées `edge-config` créées par ce run, après contrôle d’identité et métadonnées ; ne jamais supprimer un fichier remplacé depuis. Retirer uniquement les unités/fichiers de collecte initialement absents après confirmation d’arrêt, recharger systemd, conserver les sauvegardes vérifiées. Ne pas lancer une collecte de contrôle.

Le rollback traite les erreurs ordinaires et signaux gérables; **SIGKILL, perte d’alimentation ou indisponibilité du runtime ne peuvent pas garantir une restauration automatique**. Utiliser alors la procédure manuelle revue et les sauvegardes, sans contact d’un autre hôte ni action HA.

## Validations source seulement

`bash -n` sur la nouvelle source (et helpers), tests Node `scripts/lemtel-traffic-activation-transaction.test.mjs` et suites trafic existantes, puis `git diff --check`. Le nouveau test ne lance aucun helper, prévol, Docker, systemd ou collecteur et ne fabrique aucun HMAC de test. Il vérifie aussi la séparation/allowlist/empreintes du manifeste d’activation et assemble deux archives seulement en mémoire pour contrôler leur reproductibilité, modes root-only et intégrité. Les tests statiques ne prouvent pas le comportement du runtime réel : la validation du mode activation en environnement local approuvé reste une étape future, après snapshot frais et revue explicite.

## Génération du paquet source hors ligne

`scripts/lemtel-traffic-activation-package.mjs` peut sceller une archive source indépendante et son sidecar SHA-256 **sans exécution, accès réseau ou génération de secret**. Il réutilise uniquement l’encodeur ustar déterministe du générateur inactif, dont l’import ne lance pas son CLI. Aucun build ou artefact portail n’est nécessaire pour ce paquet d’activation distinct.

```sh
node scripts/lemtel-traffic-activation-package.mjs --output /chemin/prive/lemtel-traffic-activation-source.tar
```

Le répertoire de sortie doit déjà exister, ne pas être partagé ou symlink, et se situer **hors du dépôt**. Les deux fichiers sont créés exclusivement en 0600; une cible préexistante n’est jamais remplacée. Une source ou empreinte non conforme produit `package_status=blocked`, sans diagnostic sensible. L’archive contient exactement les cinq scripts source (mode 0700), cette documentation, le manifeste d’activation et `manifest.sha256` (mode 0600), ownership ustar root et dates fixes. Elle ne contient aucun fichier de configuration runtime, secret, migration, donnée métier, portail, sauvegarde ou override effectif. Le manifeste conserve `activation_authorized=false` et `deployment_authorized=false` : **fabriquer ou extraire cette archive n’autorise aucune exécution**. Une installation future doit préserver les modes root-only dans un répertoire parent protégé, vérifier l’intégrité et faire revoir le paquet avant les gates opérateur.
