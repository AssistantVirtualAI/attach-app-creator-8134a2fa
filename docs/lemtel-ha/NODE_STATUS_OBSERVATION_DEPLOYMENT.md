# Déploiement des prérequis d’observation de statut de nœud

Ce document couvre exclusivement le package **root-only** destiné au **writer DigitalOcean déjà actif**. Il installe les prérequis serveur de l’ingress Edge redacted livré par la PR #275, sans activer une publication depuis un nœud.

> Le package ne contient aucun secret, aucune configuration de publisher, aucune donnée métier et aucun état d’observation. Il ne crée, lit, transmet ni journalise de valeur de secret.

## Artefacts et intégrité

À partir de la révision approuvée, produire un archive hors-ligne déterministe :

```bash
node scripts/lemtel-node-status-observation-deploy-package.mjs \
  --source-revision 7daec6cde62326846805f99071cd90ce5e6b5efa \
  --output /chemin/root-only/lemtel-node-status-observation.tar
```

Le générateur produit :

- `lemtel-node-status-observation.tar` — archive ustar déterministe avec une allowlist fixe;
- `lemtel-node-status-observation.tar.sha256` — digest détaché de l’archive;
- `manifest.sha256` dans l’archive — digest de chaque source livrée;
- `lemtel-node-status-manifest.json` et les manifestes de fonctions — les manifestes Lemtel liés aux bytes scellés.

L’archive contient seulement la migration `0020`, les deux `index.ts` Edge et leurs manifestes, le manifeste Lemtel de statut et les métadonnées. Elle exclut délibérément le script de publisher, les unités de service/timer, les fichiers `.env`, tout secret et toute configuration de routage.

## Préconditions d’exécution

Le déployeur `infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-node-status-observation-deploy.sh` refuse par défaut. Il requiert simultanément :

1. l’exécution par `root`;
2. `LEMTEL_HA_ROLE=digitalocean_writer`;
3. `LEMTEL_NODE_STATUS_OBSERVATION_EXECUTE=deploy_verified_node_status_observation`;
4. `LEMTEL_NODE_STATUS_SNAPSHOT_ATTESTATION=FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED`;
5. un archive et un digest détaché root-owned, non inscriptibles par groupe/autres;
6. un PostgreSQL unique déjà writer (`pg_is_in_recovery() = false`) et un conteneur `supabase-edge-functions` déjà en cours d’exécution;
7. le montage Edge `/home/deno/functions` et l’extension admin existante.

L’attestation est une affirmation de gouvernance, pas un secret et pas un snapshot créé ou consulté par le script. Le déployeur n’effectue aucune sauvegarde de base ni lecture de contenu de tables.

Exécution approuvée, depuis le writer uniquement :

```bash
sudo env \
  LEMTEL_HA_ROLE=digitalocean_writer \
  LEMTEL_NODE_STATUS_OBSERVATION_EXECUTE=deploy_verified_node_status_observation \
  LEMTEL_NODE_STATUS_SNAPSHOT_ATTESTATION=FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED \
  LEMTEL_NODE_STATUS_OBSERVATION_ARCHIVE=/chemin/root-only/lemtel-node-status-observation.tar \
  bash infra/lemtel-resilience/active-passive/lemtel-ha-do-writer-node-status-observation-deploy.sh
```

## Transaction et vérifications

Après les gates, le déployeur :

1. vérifie le digest détaché, l’allowlist de l’archive, `manifest.sha256` et les métadonnées;
2. utilise seulement les catalogues PostgreSQL et `pg_is_in_recovery()` pour vérifier le writer et déterminer l’état de `0020`;
3. applique `0020` **seulement si tous ses objets sont absents**; si tous sont présents, il la saute; tout état partiel est refusé;
4. sauvegarde les sources Edge existantes root-only, remplace `lemtel-node-status-ingest/index.ts` et l’extension `lemtel-onboarding-admin/index.ts`;
5. redémarre uniquement le runtime Edge déjà actif;
6. contrôle l’état actif du runtime, les digests installés et des marqueurs statiques non sensibles de l’ingress et de l’extension admin.

Ces contrôles ne font aucun appel HTTP et ne lisent aucune observation, table métier, payload, identité de nœud, métrique, erreur, client ou donnée téléphonique.

## Rollback et limites explicites

Une erreur après remplacement de sources restaure les sources Edge sauvegardées puis redémarre uniquement le runtime Edge. La migration `0020` est **additive** et n’est pas annulée; elle peut donc demeurer présente après un échec. Dans tous les cas, les publications restent non configurées : ce package n’écrit pas `/etc/lemtel-ha/node-status-publisher.env`, n’installe ni n’active le publisher ou son timer et ne publie aucune observation.

Sont explicitement hors périmètre : démarrage du runtime standby, promotion, fencing, failover (manuel ou automatique), téléphonie, modification de Caddy, contact Hostinger/Cloudflare/DNS ou autre fournisseur, commande distante, routage, installation de service et accès aux données métier.

Toute configuration de secrets runtime, revue de route HMAC, installation locale du publisher et activation de timer restent des changements séparés, approuvés et réversibles indépendamment.
