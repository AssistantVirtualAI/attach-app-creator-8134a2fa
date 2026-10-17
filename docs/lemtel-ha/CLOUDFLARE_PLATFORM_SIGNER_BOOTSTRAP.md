# Lemtel — bootstrap du signer Cloudflare externe

> **Statut : coffre créé, signer inerte.** Cette phase crée un magasin de secrets Cloudflare et y génère une clé P-256 privée write-only destinée au signer de plateforme. Elle n’attache pas encore cette clé à un Worker, n’expose aucune URL, ne signe aucune donnée et n’active aucun composant HA.

## Précondition satisfaite

Le compte Cloudflare possède un Secrets Store avec une capacité disponible. Le magasin Lemtel ne contient qu’une clé privée de signer générée directement pour Cloudflare. La valeur privée n’est ni demandée, ni lue, ni affichée, ni écrite dans le dépôt, un fichier, un gist, une commande, une variable durable, le portail ou les logs.

## Worker prévu

Le Worker logique `lemtel-platform-signer` est séparé de `lemtel-failover-arbiter`. Son bootstrap respecte les propriétés suivantes :

- `workers.dev` désactivé ;
- aucune route, aucun domaine, aucun timer, aucun Durable Object et aucune KV ;
- observabilité désactivée ;
- réponse 404 pour toute requête ;
- aucune lecture du secret ni opération cryptographique ;
- aucune API fournisseur, DNS, Load Balancer, promotion, runtime, téléphonie ou failover.

Le fait qu’une clé existe dans le coffre ne signifie pas qu’un Worker peut la lire ou signer. La clé reste non liée jusqu’à une phase d’activation distincte.

## Phase suivante, non réalisée ici

Avant de lier le secret et d’ajouter une route de signature, il faut concevoir et faire valider :

1. Une authentification indépendante Edge→Worker. Le signer ne peut pas accepter un appel issu d’un navigateur, d’un nœud ou d’un réseau source sans identité cryptographiquement vérifiable.
2. Un format canonique de requête signé, une durée courte, un nonce et un ledger anti-rejeu durable. Un simple header statique ou l’adresse IP ne suffit pas.
3. Une allowlist de finalité limitée à la livraison chiffrée d’enrôlement. Le signer ne doit jamais être une oracle générique de signature, une API de contrôle ou une passerelle vers des fournisseurs.
4. Une vérification des pins de clé publique des nœuds via le canal hors bande déjà requis par l’enrôlement Lemtel.
5. Les tests positifs et négatifs, une revue de code indépendante et une attestation du déploiement Edge avant tout changement runtime.

Même après ces étapes, le signer autoriserait au plus l’enrôlement de publication redacted. Il ne remplacerait jamais les gates L7, Node Status, trafic, fencing, promotion, runtime Hostinger, routage Cloudflare, failback ni retry client requis pour un failover automatique.

## Rollback

Le rollback du bootstrap est volontairement simple : conserver le Worker sans route ni binding, ou supprimer séparément le Worker et le secret. Une suppression de clé implique une nouvelle chaîne de pins et d’enrôlement ; elle doit donc faire l’objet d’une procédure de révocation distincte, jamais d’un nettoyage automatique.
