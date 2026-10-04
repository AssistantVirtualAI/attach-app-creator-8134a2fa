# Lemtel — phase 30C : builds natifs de préflight, sans publication

**Portée :** continuer après 29C → 29D → 30A → 30B, sans toucher Planiprêt, effectuer de migration ou modifier FusionPBX réel. Cette phase prépare des **builds natifs non distribuables** en CI à partir du dépôt existant et corrige un risque dans la configuration de signature Android. Elle ne déploie pas les fonctions Edge de 30A ni ne lance un appel téléphonique.

## Ce qui est préparé

| Contrôle | Résultat attendu | Ce que cela ne démontre pas |
| --- | --- | --- |
| Android : `npm ci` → `npm run build` → `npx cap sync android` → `:app:assembleDebug` | APK **debug**, signé seulement par la clé de développement éphémère du runner; existence vérifiée. Artefact GitHub Actions conservé 3 jours, accessible selon les **droits de lecture du dépôt**. | Pas un AAB release, pas de signature de téléversement, pas d'essai SIP, pas d'installation sur appareil. |
| Android : `:app:bundleRelease --dry-run` sans secrets | Échec **obligatoire** avant compilation avec un message qui demande les quatre entrées de signature; les APK debug continuent de construire sans clé release. | Ni création, ni changement, ni rotation de la véritable clé Android. |
| iOS : `npm ci` → `npm run build` → `npx cap sync ios` → `xcodebuild -sdk iphoneos` | Application **cible appareil**, compilée avec `CODE_SIGNING_ALLOWED=NO`, présence vérifiée. | Pas un IPA, pas une application installable sur iPhone, pas de signature Apple, pas un dépôt TestFlight ni un test sur simulateur. |
| Client | Suite complète mobile, typage et contrats Edge déjà bloquants dans la CI Lemtel 30B. | Aucune validation réseau PBX/WSS/TURN réelle. |

Le workflow `.github/workflows/lemtel-mobile-native-preflight.yml` n'est déclenché que par les changements **Lemtel mobile**, par sa propre définition ou manuellement. Ses opérations `cap sync` et les fichiers produits restent **sur les runners CI**; aucun projet natif local n'est synchronisé ou commité par le workflow. Il n'utilise aucun secret de signature ni intégration de boutique. L'APK inclut la configuration cliente : **aucun secret serveur ne doit être présent dans le bundle**. La configuration Firebase cliente versionnée doit faire l'objet d'une vérification de restrictions de clé côté Google avant distribution.

**Résultat du premier essai CI :** `android-actions/setup-android@v3` a échoué en cherchant l'ancien package SDK `tools`, absent du gestionnaire actuel; la CI utilise maintenant le SDK du runner Ubuntu et installe uniquement API/build-tools 36 si nécessaires. Sur macOS, la compilation pour simulateur ARM64 a atteint le lien final mais la dépendance PJSIP/OpenSSL précompilée inclut une bibliothèque **iOS appareil**, non **iOS simulateur**. La CI compile donc la cible appareil **sans signature**. Pour rendre un simulateur disponible plus tard, il faudra fournir des bibliothèques séparées par plateforme dans un XCFramework, conformément à la [distinction rappelée par Apple](https://origin-devforums.apple.com/forums/thread/819001); ne pas masquer cette incompatibilité par un réglage d'architecture au hasard.

## Protection de la signature Android

La configuration Gradle contenait auparavant **des mots de passe de signature en clair** et un chemin vers le poste d'un développeur. Ces valeurs ont été retirées du build actuel; `.jks`, `.keystore` et `keystore.properties` sont désormais ignorés dans le projet Android. Pour une future release, fournir par canal privé un keystore valide et les quatre variables d'environnement `LEMTEL_ANDROID_KEYSTORE_FILE`, `LEMTEL_ANDROID_STORE_PASSWORD`, `LEMTEL_ANDROID_KEY_ALIAS`, `LEMTEL_ANDROID_KEY_PASSWORD`. Aucune valeur ne doit être inscrite dans le dépôt, les journaux CI ou ce document.

**Action du propriétaire de l'application avant toute distribution :** déterminer si le mot de passe précédemment versionné protégeait la clé de téléversement actuellement utilisée. Son retrait du fichier courant **ne l'efface pas de l'historique Git** et ne constitue pas une rotation. Si cette clé est utilisée, coordonner la rotation du mot de passe/keystore ou la procédure de remplacement de clé de téléversement avec l'administrateur Play; ne pas créer une nouvelle clé au hasard, car elle pourrait empêcher les mises à jour de l'application existante. Aucun changement de clé ou de console Play n'a été effectué ici. Voir les [recommandations officielles Android sur la sécurité des clés](https://developer.android.com/studio/publish/app-signing).

## Reprises après CI

1. Faire revoir et intégrer les PR empilées **29C → 29D → 30A → 30B → 30C**. Si un build natif échoue, le corriger **sans** dégrader la sécurité du client ni ajouter de secrets au dépôt. Un succès CI garantit seulement que le code source se compile sur les runners choisis.
2. Avec Kenny et Phil : obtenir les paramètres SIP/WSS/TLS, le réseau/TURN, l'association utilisateurs/postes, les droits sur les CDR et un staging Lemtel isolé avec deux comptes de test. Déployer d'abord les fonctions serveur autoritaires 30A dans ce staging autorisé.
3. Ensuite signer des builds internes appropriés et les installer sur appareils iPhone/Android, exécuter la [matrice de confidentialité et de téléphonie 30B](./phase-30b-regressions-native-preflight.md), y compris changement de compte en cours de lecture et tenue WSS en arrière-plan. La compilation iOS non signée et l'APK debug CI ne remplacent pas ces essais.
4. Enfin seulement : décider des versions/build numbers, confirmer la propriété et la signature Apple/Google, préparer les distributions **TestFlight interne** et **Google Play interne**. Aucun envoi en boutique ni publication n'est réalisé dans cette phase.

La séquence « construire le web, synchroniser Capacitor, puis compiler le natif » suit la [documentation officielle Capacitor](https://capacitorjs.com/docs/basics/workflow).
