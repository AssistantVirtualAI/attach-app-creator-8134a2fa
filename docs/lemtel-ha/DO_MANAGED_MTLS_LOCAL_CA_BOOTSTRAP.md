# Lemtel — CA locale durable mTLS du writer DO

> **Statut : source-only, sans import ni activation.** Ce bootstrap est le repli local approuvé après le refus de créer un coffre HCP Vault facturable. Il crée seulement une nouvelle autorité de certification locale chiffrée root-only sur le writer DigitalOcean. Il ne remplace pas l’ancienne CA bootstrap, n’émet aucun certificat client et n’active aucune fonction de haute disponibilité.

## Frontière de sécurité

La clé privée de la CA est générée P-256 exclusivement dans un répertoire temporaire `0700` sous `/run`, qui doit être attesté `tmpfs`. Le seul état persistant est son credential `systemd-creds --with-key=host` chiffré, root-only, à `/etc/lemtel-platform-signer/managed-ca/root-ca-key.pem.cred` (`0600`, `root:root`). Son nom interne est exactement `root-ca-key.pem.cred`, soit le nom complet du fichier, afin que systemd-creds refuse fermé toute substitution de credential. Le credential est intentionnellement lié au writer DO : il échoue fermé sur une autre machine. La clé n’est jamais placée dans une variable d’environnement, une ligne de commande, un log, une attestation, un dépôt, un artefact ou un échange réseau. Elle est supprimée du tmpfs immédiatement après chiffrement ; elle ne touche jamais le stockage persistant.

Le certificat public correspondant est le seul PEM **persistant** créé par le bootstrap. Il est conservé à `/etc/lemtel-platform-signer/cloudflare-access-managed-root-ca.pem` avec `root:root` et le mode `0644`. Il est distinct de la CA bootstrap historique, dont la clé privée a été détruite. Le certificat public est nécessaire plus tard pour un transfert signé et un import Access strictement séparé. L’existence de ce fichier ne donne aucun accès au signer.

Le répertoire `/etc/lemtel-platform-signer/managed-ca` doit être `root:root` `0700` et ne contenir que le credential chiffré. Toute sortie, fichier, lien symbolique ou répertoire préexistant inattendu fait échouer le script. Après un succès attesté, une nouvelle invocation vérifie les trois sorties, leur ownership/mode/lien unique et l’empreinte DER publique. Elle déchiffre aussi le credential dans un répertoire `0700` sous `/run` qui doit être `tmpfs`, vérifie silencieusement qu’il correspond au certificat public, puis détruit ce fichier clair volatile. Cette vérification échoue fermée si le credential n’est pas lié à l’hôte, est corrompu, contient une autre clé, ou si `/run` n’est pas un `tmpfs`. Seul cet état complet permet le no-op `already_complete`.

L’échec après la création d’une sortie tente de supprimer uniquement les sorties créées par cette invocation puis le temporaire. Cette suppression logique est *best effort* : si elle échoue, le script garde un échec non ambigu et écrit `rollback_cleanup_incomplete=true` avec l’étape concernée. Il ne peut alors jamais annoncer un succès ; l’opérateur doit isoler le writer et faire examiner les sorties signalées. Aucun nettoyage ne prétend à l’effacement physique d’un support de stockage.

## Invocation et attestation

Le script `lemtel-ha-do-writer-managed-mtls-local-ca-bootstrap.sh` est root-only, sans argument et limité au rôle exact `digitalocean_writer`. Il exige un token d’exécution exact, non affiché par le script. Avant le premier appel système, il impose `/usr/sbin:/usr/bin:/sbin:/bin` et vide les variables de configuration OpenSSL influençables. Le déploiement puis l’exécution se font dans deux transactions distinctes : aucun lanceur réseau ne doit télécharger ou exécuter une source non vérifiée.

Le succès écrit une attestation publique `0644` dans `/var/lib/lemtel-platform-signer/managed-mtls-local-ca.attestation`. Elle contient uniquement le type d’émetteur, l’empreinte SHA-256 DER du certificat public, les chemins fixes, des modes/ownership et les assertions négatives suivantes : import Access absent, aucun leaf émis, aucune policy Service Auth et relais local désactivé. Elle ne contient jamais le PEM ni une clé privée.

Le mode diagnostic lit seulement les métadonnées de fichiers et l’attestation. Il ne lit ni le certificat PEM ni le credential chiffré et ne retourne aucune empreinte, aucun secret, aucune clé ou aucun certificat.

Si le writer est perdu, réinstallé ou reconstruit, le credential lié à l’hôte ne doit **jamais** être copié ni restauré ailleurs. La CA locale devient indisponible ; il faut alors créer une nouvelle CA sous une approbation séparée, importer son certificat public, retirer les ancres précédentes dans Access et refaire l’ensemble des drills de leaf, rotation et révocation. Cette procédure ne redémarre jamais le relais ou le failover.

Un test isolé de `systemd-creds --with-key=host` a confirmé le round-trip et le refus de substitution par nom, mais a aussi émis l’avertissement que le secret d’hôte local n’était pas situé sur un support chiffré. Cet avertissement du sandbox ne prouve pas l’état du writer DO. Une attestation fraîche de protection au repos du secret hôte DO est donc une gate distincte et obligatoire avant tout import de la nouvelle CA, leaf, policy ou relais. Sans cette attestation, le fallback peut rester source-only mais ne peut jamais autoriser le failover.

## Séquence obligatoire après le bootstrap

1. Transférer **uniquement** le certificat public par un protocole authentifié à défi unique, puis rapprocher son empreinte DER avec l’attestation DO. Ne pas exporter le credential de clé.
2. Importer ce nouveau certificat CA public dans Cloudflare Access, associé seulement à `signer.lemtel.assistantvirtualai.com`, après lecture des métadonnées de l’objet importé. L’ancienne CA bootstrap reste inchangée tant que l’import distinct n’est pas attesté.
3. Concevoir et tester un émetteur d’intermédiaire à durée de vie courte : clé intermédiaire temporaire, certificat CA public importé séparément, leaf P-256 à CN exact `lemtel-do-signer-mtls-relay`, EKU `clientAuth`, durée d’au plus 24 heures et credential leaf chiffré root-only. Un remplacement d’intermédiaire doit être atomique et son état de révocation durable.
4. Créer une policy Access `Service Auth` limitée au CN exact, puis exécuter un test positif et des refus pour : absence de certificat, CN faux, empreinte non attendue et certificat révoqué. Chaque test se fait avant le raccordement du Worker ou du relais.
5. Réaliser un drill de rotation borné et un drill de révocation en supprimant l’ancre intermédiaire concernée dans Access, avec une nouvelle vérification de refus. La destruction d’un fichier local, l’expiration présumée ou un succès HTTP ne sont pas des preuves de révocation.
6. Attester séparément le JWKS, le ledger anti-rejeu Durable Object, l’isolation du socket local et le rollback. Alors seulement, une revue humaine peut examiner le relais source-only. Aucun de ces éléments n’active le failover.

## Exclusions garanties

Le bootstrap n’ouvre aucun réseau et ne contacte pas HCP, Cloudflare, DigitalOcean, Hostinger, DNS, Load Balancer, PostgreSQL ou un service de téléphonie. Il n’importe pas la CA, n’émet pas de leaf, ne crée aucune policy, ne lance ni ne configure de relais, et n’installe ou ne gère aucune unité systemd. Il ne réalise ni enrollment, publication de statut, démarrage runtime, promotion, fencing, routage, failover ou failback.

La protection apportée par cette option est inférieure à un HSM/KMS externe : une compromission root du writer peut compromettre la CA locale. Cette option reste acceptable seulement en combinaison avec un rôle root fortement restreint, credentials chiffrés par machine, certificats leaf très courts, intermédiaires dédiés et drills de révocation attestés. Elle ne doit pas être présentée comme équivalente à un HSM externe.
