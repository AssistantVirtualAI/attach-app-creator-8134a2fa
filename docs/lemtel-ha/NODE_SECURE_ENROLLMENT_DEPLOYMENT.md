# Déploiement des prérequis d’enrôlement signé des nœuds

## Statut et périmètre exact

Ce document décrit **uniquement** le package root-only du writer DigitalOcean qui installe les prérequis serveur déjà fusionnés pour l’enrôlement signé Lemtel. Il concerne exclusivement :

- la migration additive `0021_lemtel_node_secure_enrollment.sql` ;
- les deux modules Edge partagés d’enrôlement ;
- les sources et manifests des fonctions `lemtel-node-enrollment`, `lemtel-node-enrollment-admin` et `lemtel-node-status-signed-ingest` ;
- l’extension source et le manifest existants de `lemtel-onboarding-admin` nécessaires à l’administration d’enrôlement.

> Le package est **préparé et testé seulement**. Sa présence, sa somme de contrôle ou le redémarrage Edge ne constituent ni activation de l’enrôlement, ni autorisation d’enrôler un nœud, ni autorisation de déployer vers un endpoint réel.

Le paquet est construit depuis le worktree détaché `origin/lemtel/integration` au SHA `cb9c175568530ccaee8be9ea6cf44c3cc355feaa`. Le générateur est offline : il n’exécute aucun sous-processus, ne contacte aucun réseau et vérifie que le SHA demandé est le `HEAD` détaché local avant de lire les sources.

## Gates non contournables

Le déployeur échoue avant toute écriture sauf si **toutes** les conditions suivantes sont satisfaites :

1. l’appelant est `root` ;
2. `LEMTEL_HA_ROLE=digitalocean_writer` ;
3. `LEMTEL_NODE_ENROLLMENT_DEPLOY_EXECUTE=deploy_verified_node_enrollment` ;
4. `LEMTEL_NODE_ENROLLMENT_SNAPSHOT_ATTESTATION=FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED` ;
5. l’archive et son fichier `.sha256` sont des fichiers root-owned, non liés symboliquement et non inscriptibles par le groupe ou les autres ;
6. l’archive ustar contient **exactement** l’allowlist attendue, dans l’ordre déterministe, et uniquement des fichiers réguliers ;
7. `manifest.sha256` est explicitement admis comme membre d’archive, mais ne se signe pas lui-même : il contient une somme SHA-256 pour chacun des fichiers payload et aucun autre ;
8. le conteneur PostgreSQL résolu sans ambiguïté et le conteneur Edge existant `supabase-edge-functions` sont déjà en cours d’exécution ;
9. le PostgreSQL est bien le writer (`pg_is_in_recovery() = false`) ;
10. le schéma `0020` node-status est **entièrement installé** selon ses six objets de catalogue. Il est seulement vérifié, **jamais appliqué** par ce déployeur.

Aucun gate ne peut être remplacé par une valeur par défaut ou une détection réseau. Un état ambigu, un conteneur absent, un montage invalide, un hash divergent ou un schéma partiel échoue fermé.

## Préparation offline contrôlée

La génération s’effectue localement, sans déploiement :

```bash
node scripts/lemtel-node-secure-enrollment-deploy-package.mjs \
  --source-revision cb9c175568530ccaee8be9ea6cf44c3cc355feaa \
  --output /chemin/root-only/lemtel-node-secure-enrollment.tar
```

Le résultat est une archive ustar déterministe et `/chemin/root-only/lemtel-node-secure-enrollment.tar.sha256`. Les payloads sont limités à la migration `0021`, aux 10 fichiers Edge listés ci-dessus, à `deployment-manifest.json` renommé dans l’archive, aux métadonnées de déploiement et à `manifest.sha256`.

L’opérateur doit conserver l’archive et son `.sha256` sous propriété `root`, permissions `0600` ou plus restrictives, puis obtenir une approbation séparée pour toute exécution. Cette documentation ne fournit pas d’autorisation ni d’instruction de déploiement sur un endpoint réel.

## Comportement du déployeur autorisé

Après vérification cryptographique locale, de catalogue et des manifests :

1. Il confirme que `0020` est complet, sans exécuter son SQL et sans lire aucune observation, table métier ou payload.
2. Pour `0021`, il interroge seulement les objets de catalogue. **Absent** : il applique `0021`. **Complet** : il le saute. **Partiel** ou illisible : il refuse.
3. Il sauvegarde sous `/var/lib/lemtel-ha/node-secure-enrollment/backups`, root-only, les seuls fichiers Edge préexistants de l’allowlist.
4. Il crée uniquement les nouveaux dossiers Edge `_shared`, `lemtel-node-enrollment`, `lemtel-node-enrollment-admin` et `lemtel-node-status-signed-ingest` s’ils n’existent pas. Le dossier et `index.ts` de `lemtel-onboarding-admin` doivent déjà exister.
5. Il remplace seulement les dix sources Edge autorisées et redémarre uniquement le runtime Edge **déjà actif** `supabase-edge-functions`.
6. Toute erreur après écriture restaure les sources Edge remplacées (ou retire les nouveaux fichiers) puis tente seulement le même redémarrage Edge. La migration `0021` est **additive** et n’est pas annulée.

Le rollback ne promet donc jamais un rollback SQL. Toute remédiation du schéma doit faire l’objet d’une migration revue et d’une approbation distincte.

## Exclusions fortes

Ce package et ce déployeur ne font aucun appel HTTP, ne contactent aucun service externe et ne lisent ni données métier ni observations. Ils ne lisent, n’impriment ni ne créent aucune valeur de secret.

Sont explicitement hors périmètre :

- écriture de secret ou de configuration de publication ;
- installation, activation ou exécution d’agent, service ou timer ;
- configuration de publisher, génération de clés, envoi de statut, enrôlement effectif ou activation de route ;
- changement Caddy, route/proxy, Cloudflare, DigitalOcean API, Hostinger, DNS ou téléphonie ;
- démarrage du standby, promotion, fencing, failover automatique ou commande distante ;
- création de runtime, `docker compose`, démarrage de conteneur, modification de base hors `0021` lorsque son état est absent.

Les préconditions restantes avant toute future exécution comprennent notamment l’approbation séparée de schéma/route/activation, la liaison du signer et des pins publics par une procédure distincte, la revue de logs/redaction, les limites de débit et délais proxy, le lock de dépendances, et les tests RBAC/concurrence sur PostgreSQL cible. Elles ne sont ni satisfaites ni modifiées par ce package.
