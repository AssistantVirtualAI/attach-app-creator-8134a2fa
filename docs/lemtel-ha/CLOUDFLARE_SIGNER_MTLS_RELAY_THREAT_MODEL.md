# Lemtel — alternative mTLS pour l’identité du signer

> **Statut : source-only, non déployable.** Le source du relais ne crée aucun certificat, clé, secret, binding Worker, politique Access, socket, service ou route, et ne modifie pas le failover. Un bootstrap root-only séparé peut créer localement les deux credentials leaf chiffrés nécessaires au relais et conserver uniquement le certificat CA public requis par Cloudflare Access; sa clé CA reste éphémère. Il n’autorise ni installation ni activation.

## Problème résolu

Le signer de plateforme Cloudflare conserve la clé de signature write-only. Le runtime Edge DO ne dispose pas encore d’une identité de workload attestée pour l’appeler. L’identité mTLS proposée ici est une **identité client distincte** : elle n’est ni la clé de plateforme, ni une clé de nœud, ni un secret d’arbitre ou fournisseur.

Cloudflare Access peut protéger une application avec un certificat client et une politique `Service Auth` limitée à un Common Name précis. L’absence de certificat valide doit être refusée avant le Worker. [1]

## Frontières prévues

Le runtime Edge ne doit jamais accéder directement au certificat client ou à sa clé. Une éventuelle passerelle locale doit être root-only, accepter uniquement un socket Unix monté explicitement et n’écouter aucun port réseau. Le socket doit vérifier l’identité locale du pair avant toute sortie réseau ; son propriétaire, son mode et son montage doivent exclure les conteneurs non autorisés. Seul le rôle exact `do_writer` est accepté : `hostinger_standby` est refusé. Elle ne pourrait joindre que le hostname fixe du signer, par mTLS, pour une seule finalité : `node_enrollment_publication_delivery`. Une réponse doit être liée au `requestId`, au rôle, à l’empreinte du destinataire et au scellé d’origine, sinon elle est rejetée.

Le Worker signer reste limité à la remise de publication chiffrée. Il ne peut signer aucune commande de fencing, promotion, runtime, DNS, Load Balancer, téléphonie, clé, secret, arbitre ou action fournisseur.

Le relais devra imposer un schéma fermé avant toute requête sortante : taille maximale de 6144 octets, une requête concurrente, trois requêtes au plus par fenêtre de 60 secondes, délai local maximal de 3 secondes et délai sortant maximal de 5 secondes. `expiresAt` est un timestamp UTC entier, limité à 300 secondes et doit conserver au moins 30 secondes de marge locale bornée ; toute expiration ou TTL hors borne est refusé. Un pair local non autorisé, une taille/forme invalide, un timeout ou un résultat incertain doit être refusé sans retry implicite. Un résultat incertain se limite à l’enveloppe locale redacted `{"result":"unavailable"}` ; il ne permet pas une relance automatique.

## Gates obligatoires

Cette alternative reste bloquée tant qu’une revue de sécurité indépendante n’a pas validé le modèle, le stockage chiffré-at-rest de la clé cliente root-only, la révocation et rotation du certificat, l’isolation socket/conteneur, l’autorisation du pair local et les tests négatifs mTLS. La CA publique importée hors bande est seulement une précondition de confiance : sans rapprochement DER, émetteur durable et drills de rotation/révocation, le leaf éphémère de bootstrap ne permet pas d’activer le relais. Elle exige aussi un ledger durable, sans secret, de `requestId` et nonce retenus jusqu’à l’expiration du token, purgé au démarrage et à chaque claim, une canonicalisation stricte, une autorisation d’enrôlement sémantique à usage unique, les limites de taille/concurrence/débit et l’attestation Edge existante.

> L’existence d’un certificat mTLS ne valide ni un nœud Hostinger, ni un publisher, ni une promotion ou une bascule. Elle ne remplace jamais le drill de fencing, les vérifications L7, le routage Cloudflare, le failback et les preuves de retry client.

## État de l’activation

Tous les états d’activation demeurent `false`. Le source du relais local et un modèle systemd sans section d’installation sont fournis pour revue et tests locaux : le protocole n’accepte qu’un JSON de remise d’enrôlement `do_writer` depuis un UID local explicitement configuré, via socket Unix, vers le hostname et le chemin signer fixes. Le modèle crée exactement `RuntimeDirectory=lemtel-platform-signer` (`0711`) et `StateDirectory=lemtel-platform-signer` (`0700`), ce dernier contenant seulement le ledger root-only `0600`; `Restart=no` interdit toute relance implicite. Il reste impossible à démarrer sans une configuration root-only explicite et des credentials systemd chiffrés valides.

L’installateur DO source-only `lemtel-ha-do-writer-signer-mtls-relay-source-only-deploy.sh` est une copie locale strictement allowlistée du relais, de son contrat et de l’unité. Il exige le rôle DO exact et une approbation explicite, puis vérifie **uniquement les métadonnées** de deux sources de credentials mTLS chiffrées, préexistantes et root-only (répertoire `0700`, fichiers `0600`), sans lire leur contenu. Il ne crée ni configuration du relais ni credential, et n’invoque pas de rechargement systemd, activation, démarrage, timer, routage, failover, fournisseur ou runtime. Si les sources root-only sont absentes, liées symboliquement, ou ont un propriétaire/mode inattendu, il échoue avant toute écriture.

L’unité exige aussi ces deux chemins avant tout lancement, les charge comme credentials systemd chiffrés, et le processus vérifie de nouveau les métadonnées des sources puis des credentials chargés (`/run/credentials`, répertoire `0700`, fichiers root-only `0400`) **avant** de lire la configuration ou de créer le socket. Le bootstrap local `lemtel-ha-do-writer-signer-mtls-relay-root-only-bootstrap.sh` est documenté dans `DO_SIGNER_MTLS_ROOT_ONLY_BOOTSTRAP.md` : il est root-only, impose le rôle DO exact et un token explicite, génère une clé CA éphémère et un leaf P-256 à CN fixe dans un temporaire, puis conserve seulement le certificat CA **public** `root:root` `0644` à `/etc/lemtel-platform-signer/cloudflare-access-root-ca.pem`, les deux credentials leaf chiffrés (`0700`/`0600`) et une attestation publique sans clé privée. Il détruit la clé CA avant succès, supprime les temporaires et rollback aussi le nouveau certificat public si une étape ultérieure échoue; son diagnostic retourne seulement empreintes et états, sans lire ni afficher son PEM. Il n’appelle ni réseau, fournisseur, Cloudflare ou DNS, ni `systemctl`; il ne crée ni configuration active, socket, route, runtime, promotion, fencing, failover ou téléphonie. Planipret, PBX et les surfaces legacy sont explicitement hors périmètre. Les tests de bootstrap simulent les binaires crypto dans un tempdir; ceux du relais utilisent seulement des clés synthétiques en mémoire et un transport simulé.

## Références

[1]: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/ "Cloudflare Access mutual TLS authentication"
