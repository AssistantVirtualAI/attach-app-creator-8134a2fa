# Audit iOS / Android — Planiprêt Mobile

Objectif : vérifier que tout ce qui a été livré (SIP/appels, Maestro, AVA, Microsoft 365, notifications, deep links) fonctionne aussi bien sur Android que sur iOS, et corriger les écarts.

## Constat actuel (vérifié)

- Le dossier `android/` n'existe pas dans le dépôt : seul iOS a un projet natif généré. Android n'a donc jamais été construit ni testé.
- `scripts/apply-native-config.mjs` génère bien du natif Android (permissions, intent-filters OAuth, `PpSipKeepAliveService`, `PpIncomingActionReceiver`, plugin Java), donc la base existe.
- Écarts iOS-only identifiés dans le code :
  - `nativePpSipService.ts` : 10 points de sortie `if (platform() !== "ios") return` (VoIP push, CallKit, keep-alive, écouteurs d'appel).
  - `ms365AuthSession.ts` : session d'auth native réservée à iOS.
  - `pp-voip-push-token` (Edge Function) rejette tout ce qui n'est pas `ios` (`invalid_platform`).
  - Aucun Firebase / `google-services.json` : pas de push FCM, donc pas de réveil de l'app Android quand elle est tuée.
- Pas d'équivalent Android à CallKit (`ConnectionService` / full-screen intent) branché côté JS.

## Plan d'audit et de correction

### 1. Générer et valider le projet Android
- Ajouter la plateforme Android (`cap add android` + `apply-native-config.mjs`), vérifier que le manifeste reçoit bien permissions, service et intent-filters.
- Étendre `scripts/audit-native.mjs` pour auditer Android au même niveau qu'iOS (service déclaré, permissions, deep links, `usesCleartextTraffic`, icônes/splash).

### 2. Matrice de parité fonctionnelle
Produire un document `docs/planipret-mobile-platform-parity.md` listant, pour chaque fonctionnalité, l'état iOS / Android et le mécanisme utilisé :
appels entrants (app ouverte / arrière-plan / tuée), appels sortants, audio et haut-parleur, Bluetooth, notification d'appel, Maestro call posting, AVA chat et voix, Microsoft 365, contacts, notifications push, deep links OAuth, permissions.

### 3. Réveil et appels entrants sur Android
- Chemin app ouverte / arrière-plan : conserver le keep-alive SIP (foreground service) et vérifier la ré-inscription au retour en premier plan.
- Chemin app tuée : brancher FCM (data message haute priorité) côté `ns-webhook-receiver`, en parallèle du VoIP push APNs déjà en place, et lever la restriction `invalid_platform` de `pp-voip-push-token` pour accepter `android` avec un token FCM.
- UI d'appel entrant : full-screen intent Android (notification pleine écran + activité) équivalent au CallKit iOS, avec boutons Répondre / Refuser reliés aux mêmes handlers JS que sur iOS.

### 4. Généraliser les chemins iOS-only du JS
- Dans `nativePpSipService.ts`, remplacer les gardes `platform() !== "ios"` par des capacités détectées (plugin disponible ?) afin qu'Android utilise ses équivalents quand ils existent, et retombe proprement sur JsSIP sinon.
- Vérifier `audioRouter.ts` (haut-parleur / écouteur / Bluetooth) sur Android et compléter la route manquante.
- Microsoft 365 : valider le flux OAuth Android via Custom Tab + intent-filter `capacitor://localhost/auth/...`, et ajouter le fallback si `ms365AuthSession` n'est pas disponible.

### 5. Fonctionnalités non téléphoniques
Vérifier sur Android : posting d'appels Maestro (règles 1-4), AVA chat avec pagination, bouton de relink Maestro, contacts, enregistrements, brief AVA, écrans de diagnostic, safe-areas / anti-zoom du header.

### 6. Tests et CI
- Ajouter un workflow CI Android (build web + `cap sync android` + audit natif), calqué sur celui existant.
- Ajouter des tests Vitest de garde sur la détection de plateforme (aucune régression iOS-only sur les chemins partagés).
- Checklist de test manuel sur appareil Android réel dans `docs/`.

## Détails techniques

- Nouveaux fichiers prévus : `docs/planipret-mobile-platform-parity.md`, checklist Android, snippets natifs Android (full-screen intent activity, FCM service) dans `native-config/`.
- Fichiers modifiés : `scripts/apply-native-config.mjs`, `scripts/audit-native.mjs`, `src/lib/planipret/sip/nativePpSipService.ts`, `src/lib/planipret/audio/audioRouter.ts`, `src/lib/ms365AuthSession.ts`, Edge Functions `pp-voip-push-token` et `ns-webhook-receiver`.
- Tout changement est miroité entre l'app principale et `apps/planipret-mobile/`.
- FCM nécessitera une clé serveur / compte de service à ajouter en secret backend.

## Question ouverte

Le push Android (app tuée) exige Firebase. Si vous ne voulez pas encore ajouter Firebase, l'audit livrera la matrice de parité et tout le reste, et Android fonctionnera app ouverte/arrière-plan seulement.
