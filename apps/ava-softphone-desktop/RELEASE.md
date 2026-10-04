# Lemtel Desktop — validation et publication (phase 29D)

**État : préparation uniquement.** Le workflow `.github/workflows/release-desktop.yml` valide les PR Desktop, mais ne construit et ne publie les installateurs qu'après la création d'un tag `vX.Y.Z` pointant sur un commit déjà fusionné dans la branche par défaut `Planipret`. Il ne publie rien lors d'une PR. Cette procédure ne modifie ni FusionPBX, ni Planiprêt, ni les applications mobiles.

## Portes préalables

1. Revoir et fusionner d'abord la phase 29C. Vérifier que le contrat serveur 29B de lecture autorisée est effectivement déployé dans l'environnement prévu. Faire la recette avec deux comptes, deux postes, un CDR tiers, une déconnexion et une réponse réseau tardive. Aucun test simulé ne remplace cette recette.
2. Faire **révoquer/renouveler par le propriétaire** le mot de passe Apple d'application qui figurait en clair dans l'ancienne version du workflow. Le retrait du fichier courant ne supprime pas l'historique Git : considérer la valeur ancienne comme compromise, ne jamais la réutiliser, ne pas la recopier dans des tickets, des journaux ou le code.
3. Configurer les secrets GitHub Actions du dépôt depuis les comptes propriétaires, sans exposer leurs valeurs :

| Secret | Utilisation |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Certificat Apple Developer ID (lien ou contenu encodé accepté par electron-builder) et son mot de passe. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisation Apple de l'application macOS. |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Certificat de signature Windows et son mot de passe. |

L'accès de cette session à la **liste des secrets GitHub** a retourné HTTP 403 : leur présence n'a pas été vérifiée. Les jobs échouent fermés lorsqu'un secret requis manque. Aucune clé ne doit être demandée à Kenny ou Phil par courriel ni inscrite dans l'application. Le dépôt cible de l'auto-update est celui défini dans `electron-builder.yml` (`AssistantVirtualAI/attach-app-creator-8134a2fa`), **pas** un dépôt secondaire indiqué dans une ancienne procédure.

## Ce qui se passe dans GitHub Actions

Une PR modifiant `apps/ava-softphone-desktop`, le contrat d'enregistrement partagé ou le workflow lance : installation verrouillée (`npm ci`), **suite complète** Vitest, contrôle TypeScript du renderer (`npx tsc --noEmit -p tsconfig.json`), build Vite/Electron, tests Deno hors ligne du contrat de lecture et tests du validateur des artefacts. Un tag `vX.Y.Z` ajoute les jobs macOS x64/arm64 et Windows x64 sur des runners compatibles, contrôle les signatures, puis vérifie dans une étape commune les installateurs, les manifests `latest.yml` et `latest-mac.yml` et les SHA-512 des fichiers qu'ils référencent. Les deux builds doivent réussir avant création d'une seule release GitHub, initialement **en brouillon**; elle n'est rendue publique qu'après vérification de tous ses artefacts distants. Le workflow refuse de supprimer ou d'écraser une release existante. Il ne produit **pas** de paquet Linux.

**Ne créer aucun tag tant que la recette, les secrets, les certificats et la version ne sont pas validés.** Une publication GitHub réelle rend la mise à jour détectable par `electron-updater`. La création du tag de publication doit donc être un geste conscient après validation du paquet exact et du périmètre de déploiement; le simple merge de la PR n'est pas une publication.

## Séquence opérateur après validation

1. Faire correspondre `apps/ava-softphone-desktop/package.json` (et son lockfile si nécessaire) à la nouvelle version approuvée, puis fusionner le commit dans `Planipret` sans modifier `apps/planipret-mobile` ou les routes PBX.
2. Vérifier que la suite Desktop et le contrat serveur passent dans la PR, que les secrets sont en place et que les certificats sont valides.
3. Créer et pousser un **nouveau** tag `vX.Y.Z` sur ce commit fusionné. Le job de release vérifiera lui-même la version du paquet et l'appartenance à la branche par défaut. Ne pas réutiliser `v2.5.7`.
4. Vérifier dans la release GitHub les `.exe`, `.dmg`, `.zip`, `.blockmap`, `latest.yml` et `latest-mac.yml` ainsi que les résultats des signatures/notarisation; ne jamais lancer de release incomplète ou non signée.
5. Installer l'ancienne version sur de vrais postes Windows et macOS, laisser l'app vérifier la mise à jour, contrôler le téléchargement, le bouton de redémarrage, la nouvelle version installée, les appels et la lecture d'enregistrement du bon poste. Éprouver aussi un refus d'accès sur un autre poste et un redémarrage/rollback opérationnel. Consigner les retours des testeurs avant diffusion élargie.

Une release créée n'établit **ni** que les machines des utilisateurs ont été mises à jour, **ni** que la route PBX ou le nouveau staging a été changé. L'auto-update ne se teste correctement que sur une application empaquetée et signée; le mode Vite de développement n'est pas une preuve de mise à jour installée.
