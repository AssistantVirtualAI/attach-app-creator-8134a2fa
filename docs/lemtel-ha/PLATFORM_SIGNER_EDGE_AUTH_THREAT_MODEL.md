# Lemtel — modèle de menace Edge → signer de plateforme

> **Statut : source-only, bloqué.** Ce document définit les critères de sécurité avant toute identité machine, binding de clé ou route de signature. Il ne crée ni service token, ni secret, ni politique Access permissive, ni endpoint, ni action de failover.

## Finalité autorisée

Le signer Cloudflare, s’il est ultérieurement activé, ne peut signer que la remise chiffrée de la configuration **publication-only** de l’enrôlement de nœuds Lemtel. Il ne doit jamais signer une commande de fencing, promotion, runtime, DNS, Load Balancer, téléphonie, PBX, secret arbitre ou action fournisseur.

## Actifs protégés

| Actif | Exigence |
|---|---|
| Clé privée de plateforme | Générée et conservée write-only dans Cloudflare Secrets Store ; jamais affichée ni exportée. |
| Identité machine Edge→Worker | Distincte des clés de plateforme et de nœud ; distribuée au seul runtime Edge via un fournisseur géré avec identité de workload. |
| Message de signature | Format canonique, TTL court, nonce unique durable et finalité allowlistée. |
| État d’enrôlement | Autoritaire côté Edge/DB ; le Worker ne déduit aucune approbation depuis un réseau, une IP, un hostname ou un client. |
| Réponse de signature | Scellée au nœud autorisé ; aucune clé, secret ou ciphertext n’est renvoyé au portail. |

## Frontières de confiance

1. **Portail / navigateur** : non fiable pour toute décision d’enrôlement ou de signature. Une session admin permet seulement de demander une action serveur qui reste autoritaire.
2. **Runtime Edge DO** : seul appelant logique potentiel. Son identité doit être fournie hors code et hors fichier de déploiement par un gestionnaire de secret avec identité de workload ; l’environnement, les logs, arguments CLI et artefacts ne sont pas des canaux acceptables.
3. **Cloudflare Access** : reste `default-deny` jusqu’à la création contrôlée d’une identité machine. Une IP source, seule, n’est jamais une authentification.
4. **Worker signer** : vérifie Access, la requête canonique, l’expiration, la finalité et le nonce avant de lire une clé liée. Il refuse par défaut et n’effectue aucun appel réseau de contrôle.
5. **Nœud DO/Hostinger** : n’accepte qu’une réponse chiffrée/signée correspondant à ses pins root-only et à son challenge propre. Une clé publique ou une preuve de possession ne démontre pas l’identité cloud d’un nœud.

## Menaces et réponses obligatoires

| Menace | Réponse requise avant activation |
|---|---|
| Appel Internet, navigateur ou utilisateur Access | Application Access non visible, `default-deny`, politique machine dédiée uniquement ; aucune règle utilisateur ou navigateur. |
| Vol/rejeu d’une requête | JSON canonique, nonce unique dans un ledger durable, TTL court ; résultat incertain = blocage sans retry. |
| Oracle de signature | Finalité unique `node_enrollment_publication_delivery`, schéma fermé, taille bornée, aucun texte libre ni URL/action fournie par l’appelant. |
| Réutilisation ou confusion de clés | Une identité client distincte ; aucune réutilisation de clé de plateforme, nœud, HMAC arbitre ou fournisseur. |
| Fuite de crédential | Source gérée par identité de workload, injection seulement au runtime Edge, rotation/révocation drillées, aucune valeur dans dépôt/fichier/CLI/gist/portail/log. |
| Compromission Edge | Principe du moindre privilège : endpoint unique, finalité unique, audience fixe, quota strict, ledger et audit redacted ; incident révoque l’identité machine avant toute nouvelle signature. |
| Compromission Worker ou clé plateforme | Retirer le binding et révoquer la chaîne d’enrôlement ; régénérer pins et inviter de nouveaux nœuds via revue hors bande. |
| Contournement HA | Le signer ne connaît aucune API fournisseur ni configuration de promotion/routage ; toutes les activation HA restent séparées et fail-closed. |

## Décision de canal

Le canal retenu pour l’identité Edge→Worker est un **gestionnaire de secret externe avec identité de workload**, et non un fichier `.env`, une commande, un gist, un secret copié dans le navigateur ou un crédential systemd stocké sur un volume non attesté chiffré. Au 16 octobre 2026, le Secrets Manager DigitalOcean n’est pas accessible au writer par une identité de workload attestée ; il ne peut donc pas encore remplir ce rôle.

Le fallback consistant à permettre une IP source ou à réutiliser les clés P-256 root-only déjà prévues pour l’enrôlement est explicitement refusé. Une éventuelle passerelle de signature locale serait une nouvelle surface persistante : elle exige un modèle de menace distinct, un privilège Unix minimal, une interface Unix socket fermée, une clé dédiée, des tests d’isolation conteneur et une revue externe. Elle n’est pas fournie par cette phase.

## Gates d’activation

Avant toute modification du Worker ou d’Access, toutes les conditions suivantes doivent être attestées :

1. fournisseur de secret géré disponible avec identité de workload du runtime Edge ;
2. identité machine dédiée, rotation et révocation testées ;
3. politique Access `service_auth` limitée à cette identité ;
4. requête canonique, TTL, nonce/ledger durable, allowlist et tests négatifs ;
5. binding write-only de la clé avec test d’échec sans binding ;
6. revue indépendante de sécurité et de code ;
7. attestation du déploiement Edge sans logs sensibles.

Même après toutes ces gates, cette identité ne déverrouille pas le fencing, la promotion, le runtime Hostinger, le Load Balancer, le routage ou la bascule automatique. Ces mécanismes restent soumis aux gates HA et au drill destructif séparé.
