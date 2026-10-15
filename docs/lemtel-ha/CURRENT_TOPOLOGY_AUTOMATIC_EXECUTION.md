# Lemtel — exécution automatique de la topologie actuelle

> **État : préparé, non installé et non activé.**
>
> Topologie couverte : **DigitalOcean writer actif → Hostinger standby privé**.
> Aucun élément de ce dossier ne change Cloudflare/DNS, ne contacte un fournisseur téléphonie, ni ne démarre le runtime Hostinger tant que le service local n’est pas explicitement installé avec un fichier de configuration root-only.

## Chaîne locale préparée

1. L’agent Hostinger reçoit uniquement une commande éphémère authentifiée de l’arbitre Cloudflare.
2. Il atteste localement l’enveloppe runtime, le compose validé, le Storage reçu, PostgreSQL en recovery, WireGuard et l’absence de listener PostgreSQL hôte.
3. Il vérifie la preuve signée attestant que le writer DO est fencé.
4. En **mode `review`** (défaut), il s’arrête après les preuves : aucune promotion, aucun runtime.
5. En **mode `execute`** seulement, il promeut Hostinger comme writer unique, confirme que PostgreSQL reste privé, puis démarre le runtime HTTP après promotion.
6. Le trafic reste piloté exclusivement par Cloudflare Load Balancing ; les scripts Hostinger ne modifient jamais la zone, les pools ou les DNS.

## Gates obligatoires avant installation

Tous les éléments suivants doivent être réels et attestés dans une même fenêtre de drill :

- timer/service Hostinger toujours absents et configuration `review` vérifiée avant le drill ;
- preuve de fencing DO signée, incident-id cohérent et non rejouable ;
- Hostinger en recovery avec réplication WAL privée, Storage intègre et runtime stage validé ;
- monitor L7 Cloudflare authentifié et pool primaire/standby sains ;
- Load Balancer Cloudflare configuré pour le routage active-passive, rollback/failback compris ;
- drill de promotion et de démarrage runtime avec fenêtre de maintenance, suivi d’un failback contrôlé ;
- validation indépendante qu’un seul writer est possible après chaque erreur partielle.

> Sans toutes ces gates, `automatic_traffic_failover_enabled` reste **false**.

## Interdits invariants

- pas de seconde promotion, de redémarrage du writer DO ni de failback automatique ;
- pas de listener PostgreSQL public, de port DB publié, ni de réplication hors WireGuard ;
- pas d’action PBX/SIP/WSS/TURN/voix/recording ;
- pas d’API fournisseur ou de routage Cloudflare appelé depuis le standby ;
- pas de valeurs de secrets, d’IP, d’identifiants ou de données client dans les preuves ou journaux.
