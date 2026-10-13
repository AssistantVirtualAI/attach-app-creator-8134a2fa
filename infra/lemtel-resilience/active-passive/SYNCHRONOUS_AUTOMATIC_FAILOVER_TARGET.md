# Lemtel — cible de failover automatique synchrone

> **Statut : cible sélectionnée et préparée, mais non activée.** L’abonnement Cloudflare Load Balancing est actif depuis le 13 octobre 2026, mais aucun Load Balancer, pool, moniteur ou routage n’a encore été créé. DO reste le writer actif. Hostinger est un standby PostgreSQL privé en recovery/streaming : il ne doit jamais être redémarré ou promu comme writer hors du runbook contrôlé.

## Objectif approuvé

La cible retenue est : **DO writer, Hostinger hot standby privé, réplication PostgreSQL synchrone, arbitre indépendant, fencing fournisseur vérifié et Cloudflare Load Balancing avec pools prioritaires**.

Cette cible vise à reprendre automatiquement les nouvelles requêtes lorsque le writer est réellement en panne. Elle ne promet pas de préserver un appel VoIP déjà en cours : les scénarios SIP/WSS/TURN, les appels réels et la reprise média restent hors périmètre jusqu’aux informations approuvées de Kenny et Phil.

## Principe de sécurité

Cloudflare peut détecter une origine HTTP indisponible et envoyer le trafic vers une origine saine. Il ne doit pas décider seul d’une promotion PostgreSQL.

L’arbitre indépendant reçoit plusieurs signaux de santé. Il refuse toute décision ambiguë. Avant de donner un ordre de promotion, il doit utiliser l’API du fournisseur pour fencer l’ancien writer, confirmer que ce fencing est terminé, puis délivrer une autorisation à usage unique au standby. Hostinger ne peut promouvoir PostgreSQL que si cette autorisation et ses propres preuves locales concordent.

Une simple perte réseau ne suffit jamais. Sans preuve de fencing, il n’y a ni promotion, ni démarrage du runtime standby, ni routage vers Hostinger.

## Préparation requise

1. **Accès de fencing** : connecter des jetons API restreints DigitalOcean et Hostinger. Le contrôleur devra être autorisé à lire l’état et à arrêter une VM uniquement dans le cadre d’un fencing approuvé.
2. **Arbitre indépendant** : déployer un composant de décision hors des deux VPS. Il doit conserver un journal d’incident, utiliser des tokens à usage unique et ne promouvoir que si le fencing est confirmé.
3. **Hostinger standby** : PostgreSQL est reconstruit depuis DO, en recovery avec streaming privé, sans port PostgreSQL public. Il reste à vérifier le mode synchrone sur DO avant toute activation.
4. **Durabilité synchrone** : après synchronisation initiale, configurer DO pour confirmer les écritures seulement après réception durable par Hostinger. Si Hostinger est indisponible, les écritures attendront : c’est le compromis retenu pour éviter la perte d’écritures confirmées.
5. **Storage** : remplacer la simple copie périodique par une stratégie où une écriture n’est reconnue qu’après deux copies durables, ou utiliser un stockage durable partagé. Le rsync périodique seul ne remplit pas cette exigence.
6. **Versions applicatives** : conserver un digest immuable unique pour DO et Hostinger, puis vérifier que le runtime actif et le runtime préparé correspondent à ce digest avant de déclarer le standby prêt.
7. **Routage** : créer deux pools Cloudflare, une sonde applicative qui ne retourne `200` que pour le writer réellement prêt, puis une règle de priorité DO → Hostinger. Hostinger restera non routable tant que promotion, runtime et santé ne sont pas confirmés.
8. **Drills** : tester séparément le fencing DO, la promotion Hostinger, l’état public après bascule, puis la reconstruction inverse de DO comme standby. Aucun test ne touchera FusionPBX/SIP.

L’abonnement Cloudflare couvre maintenant la future configuration avec deux endpoints inclus. Il ne crée aucun pool et ne modifie aucun DNS par lui-même : ces ressources restent non configurées tant que le fencing, l’arbitre, les prévols et la validation finale ne sont pas terminés.

## Activation finale

L’activation n’est possible qu’après toutes les preuves précédentes et une confirmation finale donnant : la fenêtre de bascule, les seuils de délai acceptés, les identifiants d’incident, les responsables, le plan de retour et le choix de la configuration Cloudflare. Cette confirmation est requise car l’activation permet au système d’arrêter un serveur et de modifier le routage public automatiquement.

## Retour après failover

Après une bascule vers Hostinger, DO reste fencée. Elle doit être reconstruite comme standby privée depuis Hostinger et rattraper la réplication avant de reprendre le rôle de secours. Aucun failback n’est automatique.

## Limites explicites

- Aucun port PostgreSQL public ne sera ouvert.
- Aucun secret, adresse serveur, ressource cloud ou donnée client ne doit figurer dans le portail ou les journaux applicatifs.
- Aucun changement Planiprêt ou téléphonie réelle n’est inclus.
- La promesse est de limiter l’interruption des nouvelles requêtes une fois la promotion vérifiée, pas de garantir l’absence absolue de tout effet visible ou de préserver un appel en cours.

## Références

PostgreSQL décrit la réplication streaming asynchrone par défaut et le compromis de la réplication synchrone : https://www.postgresql.org/docs/current/warm-standby.html

Le fencing est requis pour éviter un split brain dans une architecture PostgreSQL haute disponibilité : https://clusterlabs.github.io/PAF/fencing.html

Cloudflare Load Balancing peut orienter automatiquement le trafic selon des contrôles de santé : https://developers.cloudflare.com/load-balancing/
