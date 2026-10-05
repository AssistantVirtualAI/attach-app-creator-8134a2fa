# Phase 38A — Promotion contrôlée du cold standby DigitalOcean

## Portée et état réel

Cette phase ajoute un **contrat déclaratif fail-closed** et un runbook. Elle ne démarre aucun service, ne modifie aucun DNS, n’ouvre aucun port et n’active aucune livraison automatique.

> **Cold standby restaurable ≠ réplication continue ≠ failover automatique.**
>
> Les sauvegardes chiffrées quotidiennes et les images préchargées peuvent réduire le temps de reprise, mais elles ne garantissent ni RPO nul, ni RTO contractuel, ni basculement transparent.

Le primaire visé reste **Hostinger**. Le secours visé reste **DigitalOcean**, privé tant qu’une promotion n’est pas explicitement autorisée. Aucun flux utilisateur Lemtel, client Desktop/iOS/Android, ni trafic FusionPBX n’est basculé par cette phase.

## Garde de dépôt

- Contrat : `infra/lemtel-resilience/cold-standby-promotion-contract.json`
- Validateur offline : `scripts/lemtel-cold-standby-promotion-gate.mjs`
- Workflow GitHub : `lemtel-cold-standby-promotion-gate.yml`

Le validateur retourne toujours le code `78` tant que la promotion est bloquée. Toute valeur positive, toute clé inconnue ou toute clé manquante rend le contrat invalide. Il ne contient pas de capacité de réseau, de secret, de restauration, de démarrage Docker, de déploiement ou d’écriture.

## Conditions de promotion à prouver lors d’un incident

Une décision d’incident séparée est requise **avant** le démarrage du standby, toute exposition publique, tout changement de routage ou toute modification DNS.

| Domaine | Preuve requise avant la promotion |
| --- | --- |
| Autorité | Responsable d’incident nommé, décision horodatée, runbook approuvé et fenêtre de changement confirmée. |
| Sauvegarde | Snapshot Restic Lemtel récent, intégrité Restic vérifiée et test de restauration récent réussi. |
| Source | Empreinte de la structure Compose exacte du primaire vérifiée; aucune substitution par un tag Supabase approximatif. |
| Images | Manifeste des digests d’images primaire/secours identique ou écart approuvé et documenté. |
| Configuration | Variables, clés de chiffrement, versions et dépendances vérifiées sans imprimer de secret; hostname de secours distinct vérifié avant exposition. |
| Base de données | Import à partir d’un `pg_dump` cohérent et des globals PostgreSQL; **jamais** copie brute de données PostgreSQL vivantes. |
| Validation DB | Rôles, extensions, schéma Lemtel-only, RPC, stockage et accès applicatif validés après import. |
| Santé privée | Services validés sur le réseau privé/local, sans base de données exposée publiquement. |
| Routage | Fournisseur externe capable de health checks actif/passif disponible; un simple enregistrement A IONOS ne constitue pas un failover. |
| Santé publique | Healthchecks HTTPS/Auth/API par hostname de secours, seulement après décision de promotion. |
| Retour arrière | Plan de rollback vers Hostinger et plan de failback validés avant l’exposition. |

## Séquence manuelle de reprise — sans commande de démarrage embarquée

1. **Déclarer l’incident** et geler les changements applicatifs et de livraison.
2. **Vérifier les preuves** listées ci-dessus; arrêter immédiatement si une preuve est absente ou échoue.
3. **Restaurer dans une zone privée** depuis un dump PostgreSQL cohérent, les artefacts de configuration et le stockage Lemtel; conserver les journaux de preuve hors du dépôt.
4. **Valider la compatibilité** de la configuration Compose exacte et des images avant le premier démarrage privé.
5. **Exécuter les healthchecks privés**, y compris l’Auth, les fonctions Lemtel nécessaires et le stockage. La DB demeure non exposée.
6. **Choisir le routage externe health-checked** déjà approuvé; ne pas transformer un changement DNS manuel en pseudo-failover.
7. **Exposer le secours seulement après l’autorisation explicite**, effectuer les healthchecks publics puis surveiller l’application.
8. **Préparer le retour au primaire** avec une stratégie de réconciliation des données écrite et une seconde autorisation.

## Actions explicitement interdites par cette phase

- démarrer les conteneurs du secours;
- ouvrir 80/443 ou tout port de base de données sur DigitalOcean;
- changer DNS, routeur, load balancer ou noms d’hôte;
- déclarer ou implémenter un failover automatique;
- activer GitHub Actions de déploiement, secrets d’environnement ou livraison Lovable;
- copier des données Planiprêt, déplacer la branche Lovable actuelle ou modifier FusionPBX.

## Ce qui sera nécessaire pour le failover automatique réel

Le failover automatique reste une phase ultérieure, soumise à une autorisation séparée. Elle devra inclure au minimum : réplication de données adaptée au RPO/RTO retenu, un routeur/LB externe avec health checks, identité et secrets de déploiement restreints, promotion et failback testés, alertes, procédures d’incident et gestion des écritures pendant une défaillance du primaire.

Aucune conclusion sur le comportement de type Ringotel, PushKit/CallKit, FCM, SIP/WSS/TURN ou FusionPBX n’est tirée de ce runbook. Ces fonctionnalités exigent leurs propres prérequis et tests sur appareils physiques.

## Étude de routage externe — option recommandée, non créée

**Option étudiée : Cloudflare Load Balancing**, avec un pool primaire Hostinger et un pool DigitalOcean. Cloudflare documente des moniteurs HTTPS/TCP, des pools, des seuils de santé, un pool de secours et des politiques de steering; un pool critique est retiré de la rotation selon la politique configurée. Les probes peuvent provenir de plusieurs régions et valider un code HTTP, un délai, un en-tête `Host` et un corps de réponse attendus ([moniteurs](https://developers.cloudflare.com/load-balancing/monitors/), [santé des pools](https://developers.cloudflare.com/load-balancing/understand-basics/health-details/)).

### Limite essentielle

Cloudflare peut **router** vers un endpoint déjà sain. Il ne peut pas restaurer un dump PostgreSQL, démarrer un Compose ni rendre un cold standby sain. Ainsi, l’état actuel Lemtel peut seulement devenir un **secours manuel assisté** : un responsable autorise et valide la promotion privée, puis le routeur peut diriger le trafic vers le secours devenu prêt. Le failover réellement automatique exigera un standby chaud ou une orchestration de promotion durable, ainsi qu’une réplication de données compatible avec le RPO/RTO choisi.

### Architecture cible à tester d’abord sur un sous-domaine de test

| Élément | Conception cible | Condition avant activation |
| --- | --- | --- |
| Nom utilisateur | Un hostname stable derrière le routeur externe | Certificat TLS, politique de session et rollback vérifiés. |
| Pool primaire | Endpoint Hostinger avec moniteur HTTPS applicatif minimal | Endpoint de santé sans secret, `Host` correct et réponse attendue. |
| Pool secours | Endpoint DO **déjà promu et sain**, jamais une DB exposée | Base restaurée depuis dump cohérent, configuration compatible, healthchecks privés/publics passés. |
| Steering | Ordre primaire → secours, seuils et délais explicitement testés | Test de bascule/failback sur hostname de test, alertes actives. |
| Données | Réplication/stratégie d’écriture décidée séparément | RPO/RTO approuvés; pas de promesse de cohérence à partir d’un backup quotidien. |

Un enregistrement A IONOS seul ne fournit ni moniteur, ni seuil, ni retrait automatique d’un endpoint défaillant. La documentation Cloudflare recommande de valider pools et moniteurs sur un domaine de test avant le hostname de production; elle exige également un profil de facturation et une confirmation de paiement pour activer le produit ([quickstart](https://developers.cloudflare.com/load-balancing/get-started/quickstart/), [activation](https://developers.cloudflare.com/load-balancing/get-started/enable-load-balancing/)). Les requêtes DNS vers un hostname Load Balancing sont comptabilisées; Cloudflare recommande des alertes de facturation ([facturation](https://developers.cloudflare.com/billing/understand/how-charges-accrue/)).

### Décision requise avant une phase d’implémentation

Avant toute création Cloudflare, migration de zone/DNS, ouverture de pare-feu, démarrage DO ou exposition du secours, il faudra une autorisation distincte précisant :

1. l’acceptation d’un service de routage payant et d’un plafond de budget;
2. l’autorité pour gérer la zone DNS concernée;
3. le RPO/RTO acceptable et le choix **cold standby manuel** versus **warm standby réellement automatique**;
4. les hostnames de test et de secours, les certificats et la méthode de gestion des sessions;
5. la fenêtre de test de bascule, retour arrière et failback.

Cette phase ne demande ni ne réalise cette autorisation.
