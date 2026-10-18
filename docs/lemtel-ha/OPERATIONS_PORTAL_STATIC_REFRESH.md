# Refresh statique du portail Exploitation Lemtel

Ce chemin met à jour **uniquement** les fichiers statiques de la page Exploitation sur le writer DigitalOcean existant. Il n’est pas le package d’observabilité trafic : il ne déploie ni migration, ni source Edge, ni collecteur, ni timer.

## Provenance GitHub retenue jusqu’au writer

Le workflow `.github/workflows/lemtel-operations-portal-build.yml` crée le ZIP immuable `lemtel-operations-portal-<run-id>` et émet son attestation de provenance GitHub native. Toutes les actions exécutées par ce workflow (`checkout`, `setup-node`, `upload-artifact`, `attest`) sont épinglées à des SHA de commit vérifiés. Le packageur ne reçoit jamais un dossier Vite local. Il télécharge le ZIP de ce run précis, contrôle le digest API, valide son central directory sans extraction permissive, puis vérifie la provenance GitHub avec le dépôt, le workflow, la branche `lemtel/integration`, le SHA source et le refus des runners self-hosted.

Il télécharge ensuite le bundle d’attestation et la racine de confiance Sigstore, puis vérifie de nouveau **hors ligne** le ZIP avec ce bundle. La vérification inclut aussi l’identifiant immuable du dépôt présent dans le certificat. L’archive scellée conserve le même ZIP, le bundle, la racine de confiance, les métadonnées et un manifeste SHA-256. Elle ne contient ni secret, ni donnée métier, ni métrique.

## Application transactionnelle DO

Le writer ne télécharge rien. Une release root-only doit installer le déployeur ainsi que les deux helpers Python versionnés, à `0755`, avec le manifeste de source correspondant. L’archive scellée et son sidecar doivent être à `0600` dans un répertoire root-only non accessible au groupe ni aux autres utilisateurs. Le verrou de refresh est créé sous le répertoire d’état root-only du package, jamais sous un répertoire global inscriptible par d’autres utilisateurs locaux; il est ouvert en append sans remplacement d’inode avant `flock`.

Avant toute écriture, le déployeur vérifie l’archive et son manifeste, puis exécute localement `gh attestation verify` avec le ZIP, le bundle et la racine de confiance inclus. Il applique les mêmes contraintes de workflow, branche, commit et identité de dépôt. Sans GitHub CLI compatible, bundle, racine ou vérification cryptographique valide, il s’arrête avant toute modification.

La route Caddy existante doit déjà contenir au moins un marqueur de propriété Lemtel et **un seul** bloc fonctionnel `handle @lemtel_operations_portal`, qui sert explicitement `/etc/caddy/lemtel-portal` avec le préfixe et le fallback attendus. La répétition du commentaire marqueur est non sémantique et ne suffit jamais à valider une route : toute ambiguïté du bloc `handle` ou de ses directives reste un refus. Le déployeur ignore seulement la ligne vide terminale ajoutée par le rendu Docker après l’énumération de son unique montage `/etc/caddy`; il conserve le refus si zéro ou plusieurs sources non vides sont présentes. Le `Caddyfile` doit être root-owned et non inscriptible par le groupe ou les autres utilisateurs; aucun `Caddyfile` n’est modifié ou rechargé.

L’extracteur ZIP refuse les liens, fichiers spéciaux, chemins absolus ou traversants, doublons, contenu chiffré, nombre excessif de fichiers et taille décompressée excessive. Il écrit seulement `lemtel-portal.html` et les assets autorisés avec des répertoires `0755` et des fichiers `0644`, ce qui reste lisible par l’identité Caddy. L’arbre live est copié dans un backup root-only vérifié avant le changement.

Un journal transactionnel root-only est fsyncé avant l’échange. L’échange utilise `renameat2(RENAME_EXCHANGE)` sur deux répertoires frères du même filesystem : le chemin live ne disparaît donc jamais. Si le processus est interrompu après l’échange et avant le commit, le trap ou la prochaine exécution détecte les inodes journalisés, restaure atomiquement l’arbre antérieur et supprime le stage non committé. Le journal n’est supprimé qu’après validation du nouveau tree et commit explicite.

## Construction hors ligne

```sh
node scripts/lemtel-operations-portal-static-refresh-package.mjs \
  --github-run-id <run-id> \
  --source-revision <sha> \
  --output /chemin-prive/lemtel-operations-portal-static-refresh.tar
```

La construction et l’application sont distinctes. Le packageur ne déploie rien; l’application nécessite une revue opérationnelle root-only séparée. Une réussite ne rend pas actif le trafic Hostinger, la téléphonie, la promotion, le fencing ni le failover automatique.

Le refresh statique ne dépend pas d’une affirmation sur le chiffrement des snapshots Droplet. Les snapshots fournisseur et leur restauration sont des protections indépendantes; toute restauration reste manuelle et destructive.
