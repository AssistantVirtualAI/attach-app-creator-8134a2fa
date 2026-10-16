# Lemtel — installateur désactivé de l’agent de failover Hostinger

> **Portée : Lemtel uniquement, installation locale root-only.** Cet artefact empaquette les sources déjà intégrées de l’agent Hostinger ; il n’est ni une activation du failover ni une procédure de bascule.

## État livré

L’installateur `infra/lemtel-resilience/automatic-failover/lemtel-ha-hostinger-failover-agent-installer.sh` ne s’exécute qu’avec UID 0, le jeton exact `LEMTEL_HA_EXECUTE=install_hostinger_failover_agent_disabled` et le rôle exact `LEMTEL_HA_ROLE=hostinger_standby`. Il refuse tout argument positionnel. Il installe les sources locales de l’agent, ses gardes de stage/promotion/runtime et les deux unités systemd existantes, mais **ne les démarre, ne les active et ne les connecte à aucune cible de boot**.

Les unités `lemtel-ha-hostinger-failover-agent.service` et `.timer` restent sans section `[Install]`. L’installateur exige qu’elles soient déjà inactives et non activées, exécute uniquement `systemctl daemon-reload`, puis vérifie de nouveau ces deux états. Il n’appelle ni `systemctl start`, ni `restart`, ni `enable`.

## Paquet déterministe et vérifiable

`lemtel-ha-hostinger-failover-agent-installer-package.sh` construit localement une archive gzip déterministe et son SHA-256. L’archive contient exclusivement l’installateur, les quatre sources déjà intégrées de l’agent/guards, ses deux unités systemd et un manifeste SHA-256 interne. Le générateur n’effectue aucun transfert et ne contacte ni Hostinger, ni Cloudflare, ni le writer DO.

L’archive seule ne déclenche aucune action : elle doit être vérifiée, extraite et revue sur le standby avant l’invocation contrôlée ci-dessous. Le paquet reste une préparation ; il ne transforme pas le service ou le timer en unité active.

## Gates fail-closed avant toute écriture d’installation

| Gate | Vérification locale obligatoire | Refus si absente ou ambiguë |
|---|---|---|
| Privilège et rôle | UID root, jeton d’installation exact, rôle `hostinger_standby`, aucun argument CLI | oui |
| Runtime Hostinger | Aucun conteneur actif avec le projet Compose `lemtel-ha-hostinger-promoted` | oui |
| PostgreSQL standby | Un unique conteneur PostgreSQL, actif, sans port publié ; `pg_is_in_recovery()` est `t` ; le seul `pg_stat_wal_receiver` est `streaming` | oui |
| Listener privé | Aucun listener hôte TCP 5432 et aucun port conteneur PostgreSQL publié | oui |
| Attestation Storage | Le manifeste reçu `/home/lemtelstorage/storage-current/.lemtel-ha-manifest.current.sha256` est un fichier non vide non symlink et son mtime a au plus 900 secondes | oui |
| systemd | Service et timer de l’agent inactifs et non activés avant **et** après la copie | oui |
| Ledger | Répertoire `/var/lib/lemtel-ha/failover-agent` root:root `0700`, fichier `installer-ledger` root:root `0600`, synchronisé sur disque | oui |

La vérification Storage est une lecture du manifeste déjà déposé par la réplication du writer DigitalOcean. L’installateur ne contacte pas le writer, ne lance pas `rsync`, ne change pas Storage et ne traite pas le contenu métier du manifeste.

## Frontière HMAC et reçus

Les sources intégrées conservent la validation de reçus HMAC (reçu de fencing et commande) décrite dans le protocole existant. **Cette phase ne distribue aucune clé HMAC.** L’installateur n’accepte aucune clé ou secret en argument, ne crée ni ne lit de configuration d’agent, ne place aucune valeur dans un fichier et ne journalise aucune valeur de clé.

La fourniture HMAC doit rester **hors bande** d’un futur chemin d’activation revu séparément. Le paquet installé reste donc bloqué faute de configuration opérationnelle ; l’installateur ne doit jamais servir à placer une clé dans le source, la ligne de commande, les logs ou un fichier. Un reçu HMAC existant ne déclenche rien : aucun poll, guard, reçu consommé ou ledger d’incident n’est exécuté pendant l’installation.

## Exclusions garanties par cette phase

L’installateur ne :

- démarre aucun runtime Hostinger, Docker Compose ou conteneur ;
- ne promeut pas PostgreSQL et n’exécute aucune commande SQL mutante ;
- n’effectue aucun fencing ni appel fournisseur ;
- ne contacte ni ne modifie Cloudflare, les DNS, les pools, le routage ou le load balancer ;
- ne contacte ni ne modifie PBX, SIP, téléphonie, enregistrements ou données métier Lemtel ;
- ne modifie que les fichiers racine de paquet sous `/opt/lemtel-ha/automatic-failover`, les deux unités systemd et son ledger d’installation local.

Le `installer-ledger` ne contient que l’état d’installation, un horodatage et des flags d’exclusion ; il n’enregistre ni secret, ni reçu, ni identifiant fournisseur, ni donnée métier. Il est distinct du ledger one-time d’incident que l’agent préparé pourrait utiliser dans une phase d’activation explicitement autorisée.

## Invocation contrôlée

Après revue humaine des gates ci-dessus, exécuter sur le standby Hostinger uniquement :

```bash
sudo env \
  LEMTEL_HA_EXECUTE=install_hostinger_failover_agent_disabled \
  LEMTEL_HA_ROLE=hostinger_standby \
  /usr/bin/bash infra/lemtel-resilience/automatic-failover/lemtel-ha-hostinger-failover-agent-installer.sh
```

Cette commande ne comporte aucune valeur HMAC. Une réussite imprime explicitement `agent_service_enabled=false`, `agent_timer_enabled=false`, `runtime_started=false`, `promotion_executed=false`, `fencing_executed=false`, `cloudflare_or_dns_changed=false`, `telephony_contacted=false` et `business_data_modified=false`.

## Validation statique livrée

```bash
bash -n infra/lemtel-resilience/automatic-failover/lemtel-ha-hostinger-failover-agent-installer.sh
node --test scripts/lemtel-hostinger-failover-agent-installer.test.mjs
git diff --check
```

Les tests de contrat sont statiques : ils n’exécutent pas l’installateur, Docker, systemd, PostgreSQL, Storage, réseau ou fournisseur.
