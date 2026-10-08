# Lemtel Desktop — validation et publication

**État : chaîne de publication préparée.** Le workflow `.github/workflows/release-desktop.yml` valide les PR Desktop, mais ne construit et ne publie des installateurs qu’après la création d’un tag `vX.Y.Z` pointant sur un commit déjà fusionné dans `lemtel/integration`. Il ne publie rien lors d’une PR. Cette procédure ne modifie ni FusionPBX, ni Planiprêt, ni les applications mobiles.

## Portes préalables

1. Revoir et fusionner le changement Desktop dans `lemtel/integration`. Ne jamais fusionner Planiprêt dans cette branche et ne jamais partir de `Planipret` pour un tag Lemtel.
2. Vérifier la suite Desktop, le contrôle TypeScript, le build Electron et le contrat de lecture d’enregistrements sans PBX réel.
3. Le tag de release doit utiliser l’environnement GitHub `lemtel-hostinger-staging`. Les builds macOS et Windows reçoivent uniquement le profil approuvé (origine HTTPS Hostinger, clé publishable contrôlée et flags Lemtel), puis exécutent `scripts/lemtel-hostinger-client-config-filter.mjs`. Un profil manquant, Planiprêt ou historique bloque la release avant compilation.
4. Configurer les secrets GitHub Actions depuis des comptes propriétaires, sans exposer leurs valeurs :

| Secret                                                     | Utilisation                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`                     | Identité Apple Developer ID et mot de passe de son conteneur PKCS#12. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisation Apple de l’application macOS.                            |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Optionnel : certificat Authenticode Windows et son mot de passe.      |

Aucune clé ne doit être ajoutée au code, à un fichier `.env` versionné, à un ticket ou à un journal. Le dépôt d’auto-update est celui défini dans `electron-builder.yml` (`AssistantVirtualAI/attach-app-creator-8134a2fa`).

## Artefacts de publication

Chaque tag validé construit et vérifie :

- macOS x64 et arm64, signés et notarisés par Apple ;
- Windows x64 NSIS et son manifeste `latest.yml` ;
- macOS `latest-mac.yml` ;
- les hashes SHA-512 référencés par les manifests de mise à jour.

### État de signature Windows

Si `WIN_CSC_LINK` et `WIN_CSC_KEY_PASSWORD` sont présents, le job Windows vérifie une signature Authenticode valide.

S’ils sont absents, le propriétaire a approuvé un installateur Windows **non signé**. Le workflow désactive explicitement la découverte automatique de certificats, publie l’installateur uniquement si le `.exe` et `latest.yml` sont cohérents, et ajoute un avertissement public dans les notes de release : Windows peut afficher Microsoft SmartScreen. Aucun certificat ou signature Windows n’est alors revendiqué.

Quand un certificat Authenticode sera disponible, une version ultérieure et un nouveau tag devront être créés. Une release existante n’est jamais remplacée ni modifiée.

## Séquence opérateur après validation

1. Faire correspondre `apps/ava-softphone-desktop/package.json` et son lockfile à la nouvelle version, puis fusionner le commit dans `lemtel/integration`.
2. Vérifier que les contrôles CI de la PR passent, que l’environnement `lemtel-hostinger-staging` possède son profil complet, et que les secrets macOS/Apple sont présents. Vérifier les secrets Windows seulement si une signature Authenticode est attendue.
3. Créer et pousser un **nouveau** tag `vX.Y.Z` sur ce commit fusionné. Le job vérifie lui-même la version du paquet, l’appartenance à `lemtel/integration` et le profil Hostinger. Ne jamais réutiliser un tag existant.
4. Vérifier la release GitHub : `.dmg`, `.zip`, `.blockmap`, `latest-mac.yml`, `.exe`, `.blockmap` et `latest.yml`. Pour une release Windows sans certificat, vérifier aussi que l’avertissement SmartScreen est visible dans les notes avant diffusion.
5. Installer la version empaquetée sur un Mac réel, contrôler le téléchargement, le redémarrage et la version. Sur Windows, faire la même recette en tenant compte de l’avertissement SmartScreen lorsqu’aucun certificat Authenticode n’est configuré. Tester séparément l’accès refusé à un enregistrement d’un autre poste et un redémarrage/rollback opérationnel.

Une release créée n’établit ni que les machines des utilisateurs ont été mises à jour, ni que la route PBX ou le staging a changé. L’auto-update se valide uniquement avec une application empaquetée ; le mode Vite n’est pas une preuve de mise à jour installée.
