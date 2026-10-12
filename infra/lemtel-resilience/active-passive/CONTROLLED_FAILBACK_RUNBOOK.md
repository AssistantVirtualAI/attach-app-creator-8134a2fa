# Lemtel — runbook de failback contrôlé

> **Statut : préparation uniquement — aucune étape de ce document ne doit être exécutée sans une fenêtre de maintenance validée et une approbation explicite.**
>
> **État de départ obligatoire :** DigitalOcean est le writer PostgreSQL unique, le runtime public actif et la route DNS canonique. Hostinger est le former primary fencé. Le retour ne doit jamais être improvisé par un redémarrage de Hostinger.

## Objet et limites

Ce runbook décrit le **seul** ordre sûr pour un retour contrôlé vers Hostinger après le drill du 11 octobre 2026. Il vise à préserver un unique writer, la confidentialité de PostgreSQL et l’intégrité Storage. Il ne couvre pas FusionPBX, SIP, WSS, TURN, appels, enregistrements téléphoniques ni une promotion automatique.

Aucun raccourci n’est permis : pas de démarrage du conteneur `supabase-db` Hostinger, pas de timer Storage Hostinger, pas de changement DNS, pas de listener PostgreSQL public et pas de promotion avant le fencing du writer DO.

## Approbation requise avant l’exécution

L’opérateur doit obtenir une confirmation explicite qui précise :

- la fenêtre de maintenance et l’impact utilisateur accepté ;
- le numéro d’incident et les responsables de l’exécution ;
- la stratégie RPO/RTO retenue et l’acceptation du caractère asynchrone de la réplication ;
- la validation des sauvegardes chiffrées récentes du writer DO ;
- la décision de retourner le writer vers Hostinger et de modifier le routage Cloudflare ;
- le plan de communication, les adresses d’alerte et le seuil d’annulation.

Sans ces éléments, **arrêter après les vérifications de lecture seule**.

## Phase A — Préflight lecture seule sur le writer DO

1. Déclarer la fenêtre, geler les déploiements applicatifs et empêcher toute exécution concurrente de failover/failback.
2. Vérifier que DO est le seul writer : PostgreSQL promu, runtime public sain et Cloudflare sur la route canonique DO.
3. Vérifier qu’Hostinger est encore fencé : PostgreSQL arrêté, redémarrage automatique bloqué, aucun runtime writer ni listener PostgreSQL.
4. Capturer uniquement des preuves non sensibles : santé HTTPS/Auth/REST/Storage, état de réplication, âge/lag, inventaire Storage et statut des sauvegardes chiffrées.
5. Mesurer et consigner le lag observé ainsi que le point de restauration visé. Si le seuil approuvé est dépassé, **annuler**.
6. Vérifier l’absence de changements FusionPBX/SIP et le maintien de PostgreSQL sur le réseau privé WireGuard uniquement.

**Gate A :** aucun écart de rôle, aucun indicateur de données non récupérables et accord écrit des responsables. Sinon, rester sur DO.

## Phase B — Reconstruire Hostinger comme standby depuis DO

1. Conserver Hostinger fencé ; ne jamais réutiliser son ancien volume PostgreSQL comme source.
2. Recréer PostgreSQL Hostinger depuis une sauvegarde de base approuvée du writer DO, avec les paramètres de standby et de réplication privés vérifiés.
3. Démarrer Hostinger seulement en mode recovery/standby ; confirmer `pg_is_in_recovery=true` et l’absence de listener public.
4. Laisser le streaming DO → Hostinger rattraper le lag, puis contrôler recovery, WAL, état de slot, sécurité WireGuard et âge de la dernière transaction reçue.
5. Répliquer Storage dans le sens DO → Hostinger avec manifeste, contrôle d’intégrité et preuve de destination non exposée.
6. Préparer le runtime Hostinger, mais garder tous les composants d’écriture et de routage public désactivés tant que le cutover n’est pas autorisé.

**Gate B :** Hostinger est un standby intact, lag dans le seuil approuvé, Storage vérifié et runtime prêt mais passif. Sinon, effacer/reconstruire le standby ou rester sur DO ; ne pas promouvoir.

## Phase C — Cutover transactionnel, seulement après confirmation finale

Avant la première commande mutante de cette phase, présenter à l’approbateur : heure prévue, lag final, résultats des Gates A/B, impact utilisateur et plan d’annulation. L’exécution requiert une nouvelle confirmation explicite.

1. Mettre le runtime public DO en mode maintenance contrôlée pour arrêter les nouvelles écritures applicatives.
2. Vérifier une dernière fois que Hostinger est en recovery et synchronisé dans le seuil accepté.
3. Fencer transactionnellement DO : arrêter le writer PostgreSQL, bloquer son redémarrage automatique et confirmer l’absence de listener writer. Si cette preuve échoue, **annuler** et ne pas promouvoir Hostinger.
4. Promouvoir Hostinger une seule fois après preuve de fencing DO, puis confirmer son mode writer et conserver PostgreSQL privé.
5. Démarrer le runtime Hostinger sur le writer promu, avec l’artefact et l’enveloppe runtime approuvés.
6. Valider HTTPS strict, Auth, REST, Storage et `lemtel-session-bootstrap` sur Hostinger sans écriture métier de recette.
7. Modifier manuellement le routage Cloudflare de la route canonique seulement après les contrôles précédents. Ne pas activer de bascule automatique.
8. Vérifier le routage externe, le runtime et les alertes, puis déclarer Hostinger writer unique et DO former writer fencé.

**Gate C :** si une vérification échoue avant le DNS, conserver la route sur DO, conserver Hostinger standby/fencé selon son état et exécuter le plan d’annulation. Si le DNS a été déplacé mais le runtime Hostinger échoue, appliquer le runbook d’incident avec une décision humaine ; ne jamais redémarrer DO comme writer sans procédure contrôlée.

## Phase D — Validation et clôture

1. Consigner les horodatages, le lag/RPO observé, le RTO, les preuves des rôles et l’état des alertes, sans secrets, IP, identifiants de ressource ni données utilisateur.
2. Mettre à jour le contrat active-passive avec le nouvel état seulement si toutes les preuves sont archivées.
3. Reconfigurer le monitoring et la réplication future en fonction du nouveau writer, sans activer une promotion automatique.
4. Programmer un exercice de secours distinct pour le nouveau standby ; il ne doit pas être combiné à une recette téléphonie.
5. Garder les tests authentifiés des clients séparés du failback. Les appels ne restent hors périmètre que jusqu’aux détails FusionPBX approuvés.

## Conditions d’arrêt immédiat

Arrêter et escalader si l’une des conditions suivantes survient :

- plus d’un writer potentiel ou un fencing non prouvé ;
- un listener PostgreSQL public, une règle firewall élargie ou une réplication hors WireGuard ;
- une divergence Storage ou un manifeste non vérifié ;
- un lag au-delà du seuil accepté ou une sauvegarde non valide ;
- une mutation DNS avant la validation du runtime promu ;
- une demande de modification FusionPBX/SIP dans cette opération.

> **Règle finale :** le failback est une opération de continuité distincte. Il ne sera jamais exécuté automatiquement, ni à partir de ce document, ni en réponse à une alerte seule.
