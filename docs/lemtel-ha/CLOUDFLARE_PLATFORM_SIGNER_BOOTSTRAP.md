# Lemtel — bootstrap du signer Cloudflare externe

> **Statut : coffre créé, hostname Access-protégé, signer inerte.** Cloudflare conserve une clé P-256 privée write-only pour le futur signer de plateforme. Le Worker est accessible uniquement sous un hostname dédié protégé par Cloudflare Access **default-deny**. Il ne lit pas encore la clé, ne signe aucune donnée et n’active aucun composant HA.

## Préconditions satisfaites

Le compte Cloudflare possède un Secrets Store avec une capacité disponible. Le magasin Lemtel contient une clé privée de signer générée directement pour Cloudflare. La valeur privée n’est ni demandée, ni lue, ni affichée, ni écrite dans le dépôt, un fichier, un gist, une commande, une variable durable, le portail ou les logs.

Un hostname dédié, `signer.lemtel.assistantvirtualai.com`, est attaché exclusivement au Worker `lemtel-platform-signer` :

- `workers.dev` et les URL de preview sont désactivés ;
- Cloudflare Access protège le hostname avec une application non visible dans le launcher ;
- l’application ne possède encore aucune politique, donc tout appel est refusé par défaut avant le Worker ;
- aucun service token n’existe encore ;
- le hostname ne participe pas au portail, aux pools, au Load Balancer, au DNS/routage de failover ou au trafic téléphonique.

## Worker inerte

Le Worker de bootstrap respecte les propriétés suivantes :

- aucune route de failover, aucun timer, aucun Durable Object et aucune KV ;
- observabilité désactivée ;
- réponse 404 pour toute requête qui aurait déjà passé Access ;
- aucune lecture du secret ni opération cryptographique ;
- aucune API fournisseur, DNS de failover, Load Balancer, promotion, runtime, téléphonie ou failover.

Le fait qu’une clé existe dans le coffre et qu’un hostname soit protégé ne signifie pas que le Worker peut signer. La clé reste non liée jusqu’à une phase d’activation distincte.

## Phase suivante, non réalisée ici

Avant de lier le secret et d’ajouter une route de signature, il faut concevoir et faire valider :

1. Un service token Access dédié, à durée limitée et de privilège minimal. Son secret doit être placé seulement dans le runtime DO Edge, jamais dans un fichier, une commande, le dépôt, un gist ou le portail.
2. Une politique Access `service_auth` liée uniquement à ce token. Aucun accès utilisateur, réseau ou navigateur ne doit être accepté.
3. Un format canonique de requête signé, une durée courte, un nonce et un ledger anti-rejeu durable. Un simple header statique ou l’adresse IP ne suffit pas.
4. Une allowlist de finalité limitée à la livraison chiffrée d’enrôlement. Le signer ne doit jamais être une oracle générique de signature, une API de contrôle ou une passerelle vers des fournisseurs.
5. Une vérification des pins de clé publique des nœuds via le canal hors bande déjà requis par l’enrôlement Lemtel.
6. Les tests positifs et négatifs, une revue de code indépendante et une attestation du déploiement Edge avant tout changement runtime.

Même après ces étapes, le signer autoriserait au plus l’enrôlement de publication redacted. Il ne remplacerait jamais les gates L7, Node Status, trafic, fencing, promotion, runtime Hostinger, routage Cloudflare de failover, failback ni retry client requis pour un failover automatique.

## Rollback

Le rollback du bootstrap est volontairement simple : supprimer l’application Access et détacher le hostname du Worker, ou conserver la protection `default-deny`. Une suppression de clé implique une nouvelle chaîne de pins et d’enrôlement ; elle doit donc faire l’objet d’une procédure de révocation distincte, jamais d’un nettoyage automatique.
