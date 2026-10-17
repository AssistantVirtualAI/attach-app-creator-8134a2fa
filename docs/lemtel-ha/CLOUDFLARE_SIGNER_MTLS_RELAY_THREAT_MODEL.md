# Lemtel — alternative mTLS pour l’identité du signer

> **Statut : source-only, non déployable.** Cette alternative ne crée aucun certificat, clé, secret, binding Worker, politique Access, socket, service ou route. Elle ne modifie pas le failover.

## Problème résolu

Le signer de plateforme Cloudflare conserve la clé de signature write-only. Le runtime Edge DO ne dispose pas encore d’une identité de workload attestée pour l’appeler. L’identité mTLS proposée ici est une **identité client distincte** : elle n’est ni la clé de plateforme, ni une clé de nœud, ni un secret d’arbitre ou fournisseur.

Cloudflare Access peut protéger une application avec un certificat client et une politique `Service Auth` limitée à un Common Name précis. L’absence de certificat valide doit être refusée avant le Worker. [1]

## Frontières prévues

Le runtime Edge ne doit jamais accéder directement au certificat client ou à sa clé. Une éventuelle passerelle locale doit être root-only, accepter uniquement un socket Unix monté explicitement et n’écouter aucun port réseau. Le socket doit vérifier l’identité locale du pair avant toute sortie réseau ; son propriétaire, son mode et son montage doivent exclure les conteneurs non autorisés. Elle ne pourrait joindre que le hostname fixe du signer, par mTLS, pour une seule finalité : `node_enrollment_publication_delivery`.

Le Worker signer reste limité à la remise de publication chiffrée. Il ne peut signer aucune commande de fencing, promotion, runtime, DNS, Load Balancer, téléphonie, clé, secret, arbitre ou action fournisseur.

Le relais devra imposer un schéma fermé avant toute requête sortante : taille maximale de 4096 octets, une requête concurrente, trois requêtes au plus par fenêtre de 60 secondes, délai local maximal de 3 secondes et délai sortant maximal de 5 secondes. Un pair local non autorisé, une taille/forme invalide, un timeout ou un résultat incertain doit être refusé sans retry implicite.

## Gates obligatoires

Cette alternative reste bloquée tant qu’une revue de sécurité indépendante n’a pas validé le modèle, le stockage chiffré-at-rest de la clé cliente root-only, la révocation et rotation du certificat, l’isolation socket/conteneur, l’autorisation du pair local et les tests négatifs mTLS. Elle exige aussi un ledger durable de nonce, un TTL court, une canonicalisation stricte, les limites de taille/concurrence/débit et l’attestation Edge existante.

> L’existence d’un certificat mTLS ne valide ni un nœud Hostinger, ni un publisher, ni une promotion ou une bascule. Elle ne remplace jamais le drill de fencing, les vérifications L7, le routage Cloudflare, le failback et les preuves de retry client.

## État de l’activation

Tous les états d’activation demeurent `false`. Le source du relais local et un modèle systemd sans section d’installation sont fournis pour revue et tests locaux : le protocole n’accepte qu’un JSON de remise d’enrôlement depuis un UID local explicitement configuré, via socket Unix, vers le hostname et le chemin signer fixes. Il reste impossible à démarrer sans une configuration root-only explicite et des credentials systemd chiffrés valides.

Ce source ne fournit ni commande d’installation, ni génération de matériel cryptographique, ni configuration active, ni certificat, ni clé, ni binding, ni politique Access, ni déploiement persistant. Les tests utilisent seulement des clés synthétiques en mémoire et un transport simulé.

## Références

[1]: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/ "Cloudflare Access mutual TLS authentication"
