# Lemtel Softphone — release mobile contrôlée

> **Portée :** Lemtel uniquement. Les builds utilisent le profil Hostinger approuvé et une copie privée identique est déposée sur le secours DigitalOcean. Ce mécanisme ne démarre pas le secours, ne change pas le DNS et ne crée pas de basculement automatique.

## 1. Préconditions de build

- La branche source est `lemtel/integration`; aucune branche Planiprêt ne doit être fusionnée globalement.
- Le profil de build Lemtel doit contenir uniquement `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_LEMTEL_TARGET` et `VITE_LEMTEL_EMAIL_ONLY_SIGNIN=approved`.
- Les fonctions d’authentification Hostinger doivent avoir été vérifiées avec les méthodes HTTP attendues avant une recette authentifiée.
- Les paramètres SIP/WSS/TURN restent configurés séparément après réception et validation des données FusionPBX. Aucun endpoint PBX n’est introduit par ce guide.

## 2. Builds privés Hostinger + DigitalOcean

Chaque merge Lemtel touchant le mobile lance **Lemtel Hostinger — private test builds** :

1. la WebView Android/iOS est construite avec le profil Hostinger;
2. un APK Android de débogage et un `.app` iOS non signé sont produits pour contrôle;
3. le même bundle chiffrable est déposé sur Hostinger primaire puis sur DigitalOcean standby;
4. aucun artefact iOS n’est distribué aux utilisateurs et aucune app n’est installée à cette étape.

Le résultat confirme la cohérence des entrées de build, **pas** une disponibilité de téléphonie, de notifications entrantes ou de failover automatique.

## 3. Bêta iOS TestFlight interne

Le workflow **Lemtel iOS — TestFlight internal beta** n’est disponible qu’en lancement manuel. Il exige la confirmation `confirm_testflight_upload=true` et un environnement GitHub protégé `lemtel-ios-testflight`.

Secrets requis dans cet environnement :

| Nom                                 | Contenu                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `APPSTORE_CERTIFICATES_FILE_BASE64` | Certificat **Apple Distribution** exporté au format `.p12`, encodé Base64 |
| `APPSTORE_CERTIFICATES_PASSWORD`    | Mot de passe du `.p12`                                                    |
| `APPSTORE_API_PRIVATE_KEY`          | Contenu de la clé App Store Connect `AuthKey_*.p8`                        |
| `VITE_SUPABASE_PUBLISHABLE_KEY`     | Clé publique Lemtel Hostinger                                             |

Variables requises :

| Nom                             | Contenu                               |
| ------------------------------- | ------------------------------------- |
| `APPLE_TEAM_ID`                 | Identifiant d’équipe Apple            |
| `APPSTORE_ISSUER_ID`            | Issuer ID App Store Connect           |
| `APPSTORE_API_KEY_ID`           | Key ID App Store Connect              |
| `VITE_LEMTEL_TARGET`            | Cible Lemtel approuvée                |
| `VITE_SUPABASE_URL`             | URL HTTPS Hostinger Lemtel            |
| `VITE_LEMTEL_PRIVATE_DIRECTORY` | Indicateur de répertoire privé Lemtel |
| `VITE_LEMTEL_AUTH_REDIRECT_URL` | URL de retour autorisée Lemtel        |

Le workflow importe le certificat, obtient un profil `IOS_APP_STORE` pour `com.lemtel.softphone`, archive une IPA **Release**, puis la téléverse uniquement dans TestFlight. Il ne soumet pas l’application à l’App Store public.

## 4. Recette sur iPhone réel

Avant de promouvoir une bêta, vérifier au minimum :

- connexion e-mail/mot de passe et récupération;
- mot de passe temporaire → mot de passe personnel → nouvelle session → bootstrap;
- Dark et Daylight, anglais et français;
- microphone, haut-parleur, Bluetooth et changement Wi-Fi/LTE/5G;
- appels entrants en arrière-plan, PushKit/CallKit et FCM/Android séparément, une fois les données FusionPBX/TURN validées.

Ne pas affirmer le comportement Ringotel ou les appels en arrière-plan avant ces tests physiques et les paramètres FusionPBX/WSS/TURN réels.
