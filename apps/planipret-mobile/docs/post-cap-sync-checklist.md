# Checklist post-génération / post `cap sync` — Planiprêt Mobile

Les projets natifs (`ios/App/App/Info.plist`, `android/app/src/**`) ne sont **pas**
versionnés : ils sont régénérés localement par Capacitor. La source de vérité est
`scripts/apply-native-config.mjs` + `native-config/*.snippet.xml`, qui réinjectent
permissions, services, deep links et entitlements après chaque `cap sync`.

## 1. Génération (une seule fois par poste)

```bash
cd apps/planipret-mobile
npm install
npm run cap:add:ios       # ou npm run cap:add:android
```

## 2. Build + sync (à chaque livraison)

```bash
npm run preflight:ios         # ou preflight:android — bloque si un test échoue
npm run ios:build-sync        # ou npm run android:build-sync
```

Ces scripts enchaînent : `check:imports` → `vite build` → `precheck:build` →
`verify:sip:bundle` → `cap sync` → `apply-native-config` → vérifications natives.

## 3. Vérifications après `cap sync`

### iOS — `ios/App/App/Info.plist`
- [ ] `NSMicrophoneUsageDescription`, `NSContactsUsageDescription`,
      `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
      `NSLocalNetworkUsageDescription`, `NSSpeechRecognitionUsageDescription`
- [ ] `UIBackgroundModes` = `audio`, `voip`, `remote-notification`, `fetch`
- [ ] `CFBundleURLTypes` contient `planipret` et `capacitor`
- [ ] `ITSAppUsesNonExemptEncryption` = `false`
- [ ] `App.entitlements` : `aps-environment` = `production`
- [ ] Capability « Associated Domains » : `applinks:avastatistic.ca`
- [ ] `SceneDelegate.swift` présent (`npm run verify:ios:scene`)
- [ ] Version : `CFBundleShortVersionString` + `CFBundleVersion` incrémentés

### Android — `android/app/src/main/AndroidManifest.xml`
- [ ] `RECORD_AUDIO`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`,
      `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`,
      `RECEIVE_BOOT_COMPLETED`
- [ ] `PpSipKeepAliveService` avec `android:foregroundServiceType="phoneCall|microphone"`
- [ ] `PpIncomingActionReceiver` déclaré
- [ ] Intent-filter deep link `android:scheme="planipret"`
- [ ] `android/app/google-services.json` réel (pas un placeholder)
- [ ] `versionCode` / `versionName` incrémentés (`npm run apply:version`)

## 4. Contrôles applicatifs
- [ ] `npm run audit:native` — parité portail ↔ app (commissions, tâches incluses)
- [ ] `reports/endpoints.json` généré et revu (endpoints edge appelés par l'app)
- [ ] `npm run verify:aor:mobile` — séparation AOR natif/web
- [ ] Connexion Microsoft 365 + reconnexion Maestro testées sur appareil
- [ ] Appel entrant app en arrière-plan et app tuée (FCM / VoIP push)
- [ ] Suppression de compte accessible (Plus → Supprimer mon compte)

## 5. Soumission
- [ ] iOS : Archive → App Store Connect, métadonnées + captures FR/EN
- [ ] Android : `./gradlew bundleRelease` → piste interne → production
- [ ] URLs légales en ligne : `/privacy`, `/terms`, `/support`
