# Déploiement révisé — réparation transactionnelle Lemtel

> **Statut : paquet local, revue obligatoire.** Ce flux cible exclusivement le **writer DigitalOcean** déjà actif. Il ne contacte pas Hostinger, Resend, Cloudflare, DNS, un load balancer, une couche de failover, ni une plateforme de téléphonie. Il ne crée aucune clé ni snapshot.

## Limites de sécurité

Le paquet transporte uniquement du code Lemtel, la migration `0019`, les manifests correspondants et un build statique de portail déjà revu. Il ne contient **aucune** valeur de configuration ni aucun secret.

Le lanceur macOS ne contient aucun hôte, URL ou secret : la cible SSH est fournie au lancement, et deux confirmations explicites sont requises : revue du déploiement puis attestation opérateur d'un snapshot chiffré existant. L'attestation ne crée pas de snapshot.

### Configuration d'environnement

Les sources utilisent ces **noms seulement** :

| Catégorie | Noms à configurer et valider hors bande |
|---|---|
| Expéditeur | `LEMTEL_WELCOME_FROM`, ou `LEMTEL_EMAIL_SENDER_NAME` et `LEMTEL_EMAIL_SENDER_ADDRESS` |
| Visuel et liens | `LEMTEL_EMAIL_LOGO_URL`, `LEMTEL_DOWNLOAD_IOS_URL`, `LEMTEL_DOWNLOAD_ANDROID_URL`, `LEMTEL_DOWNLOAD_DESKTOP_URL` |
| Livraison | `RESEND_API_KEY` |
| Webhook futur seulement | `RESEND_WEBHOOK_SECRET` |

Les valeurs d'expéditeur, logo et liens doivent respecter la validation déjà présente dans `lemtelTransactionalEmail.ts` : expéditeur Lemtel valide, HTTPS strict pour logo/liens, sans credentials, query ni fragment.

**Décision fail-closed sur la nouvelle clé Resend :** les conventions self-hosted présentes dans ce dépôt exposent un volume de fonctions et un redémarrage Docker, mais aucun mécanisme documenté de secret store ni de setter Edge persistant accepté via stdin TTY. Écrire une clé dans un fichier Compose/environnement, la passer en argument, ou inventer un endpoint serait contraire à cette révision. Le déployeur ne demande donc pas de clé, n'accepte aucune clé et n'en configure aucune.

Une nouvelle clé Resend ne peut être saisie **que** dans une invite cachée du TTY sur le writer, par un mécanisme de secret store Edge déjà approuvé et documenté hors de ce dépôt. Cette étape est séparée, doit être revue séparément et ne doit jamais faire transiter la clé par le lanceur, l'archive, une variable d'environnement locale, un fichier, l'historique, les logs, stdout/stderr ou MCP. En l'absence de ce mécanisme, l'état correct est `resend_secret_tty_injection=unsupported_by_documented_edge_runtime` et la livraison demeure inerte.

Le déployeur ne montre jamais de valeur d'environnement : il ne retourne qu'un statut de validation de configuration.

## Construire un paquet local déterministe

1. Produire et examiner le build statique du portail Lemtel avec la configuration de build approuvée. Le générateur n'exécute pas Vite et ne lit pas l'environnement afin que son entrée soit un répertoire statique explicite et revu.
2. Générer l'archive dans un emplacement temporaire :

```bash
node scripts/lemtel-transactional-email-deploy-package.mjs \
  --portal-dir dist-lemtel-portal \
  --output /tmp/lemtel-transactional-email-package.tar \
  --source-revision "$(git rev-parse HEAD)"
```

Le résultat est une archive ustar à ordre, ownership, mode et mtime fixes, plus le fichier voisin `.sha256`. À entrées identiques, l'archive est identique octet pour octet. Le générateur refuse les liens symboliques, les chemins non sûrs, un portail sans `lemtel-portal.html` ou sans asset, et tout fichier hors allowlist.

Le manifest interne SHA-256 couvre les sources, migration, portal archive, manifests et déployeur. Le checksum externe couvre l'archive complète. Le déployeur distant vérifie les deux avant toute écriture cible.

## Lancement macOS après revue

```bash
bash scripts/lemtel-transactional-email-deploy-macos.sh <cible-ssh> /tmp/lemtel-transactional-email-package.tar
```

Le lanceur demande explicitement :

1. `REVIEWED_WRITER_DEPLOYMENT` ;
2. `FRESH_ENCRYPTED_WRITER_SNAPSHOT_VERIFIED`.

Il copie l'archive sans secret, vérifie son checksum local, transmet son checksum non secret au writer et exécute le déployeur en TTY. Le déployeur impose `root`, le rôle exact `digitalocean_writer`, le checksum externe et interne, le verrou exclusif, l'attestation de snapshot et l'état PostgreSQL non-réplique.

## Ce que le déployeur applique

Après les validations, il :

- valide le routeur Edge et l'import map déjà montés ;
- stage puis valide les sources Deno si le runtime Deno est présent ;
- applique `0019_lemtel_transactional_email_delivery_states.sql` de façon transactionnelle/idempotente et contrôle les deux contraintes d'état ;
- sauvegarde les fichiers Edge et portail ;
- remplace les sources onboarding, reset, helper transactionnel et source webhook ;
- remplace le bundle statique du portail ;
- redémarre seulement le conteneur Edge déjà existant.

La source webhook est copiée **inerte**. Aucun endpoint Resend n'est créé ou activé, aucun secret webhook n'est injecté et aucune configuration chez Resend n'est touchée. Aucun email, welcome ou password reset n'est déclenché pendant l'installation.

## Rollback et récupération

En cas d'échec après le début des remplacements, le script restaure automatiquement les fichiers Edge, les répertoires créés et le portail à partir de `/var/lib/lemtel-ha/transactional-email/backups`. Il redémarre ensuite Edge seulement pour restaurer les fichiers.

La migration `0019` ne peut pas être automatiquement annulée après son commit : elle met notamment à jour l'ancien état historique `sent`. Le script l'indique explicitement en cas d'échec ultérieur. La récupération de base de données relève exclusivement du snapshot chiffré attesté par l'opérateur ; le script n'en crée ni n'en restaure aucun.

## Vérifications locales sans cible

```bash
node --test scripts/lemtel-transactional-email-deploy-package.test.mjs
bash -n scripts/lemtel-transactional-email-deploy-macos.sh \
  infra/lemtel-self-hosted/transactional-email-deploy/lemtel-transactional-email-do-writer-deploy.sh
git diff --check
```

Ces commandes ne font aucune connexion SSH, aucun déploiement, aucun appel réseau, aucun appel Resend et aucune création de clé.
