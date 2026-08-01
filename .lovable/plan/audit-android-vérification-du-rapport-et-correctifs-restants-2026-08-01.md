# Audit Android — vérification du rapport et correctifs restants

## Constat après relecture du code réel

Vérifications faites dans le dépôt avant d'écrire ce plan :

| Point du rapport | État vérifié dans le dépôt |
| --- | --- |
| 1. `_shared/fcm.ts` + FCM dans `ns-webhook-receiver` | Déjà présent. `supabase/functions/_shared/fcm.ts` existe ; `ns-webhook-receiver/index.ts` importe `parseServiceAccount` / `sendFcmDataMessage` et appelle `sendAndroidCallPush(userId, inboundPushPayload)` juste après `sendVoipPush` (data message high-priority, TTL 30 s, purge des tokens `UNREGISTERED`). |
| 2. Tokens Android jamais lus | Faux : `sendVoipPush` reste iOS/APNs, mais `sendAndroidCallPush` lit `mobile_push_tokens` filtré sur `platform = 'android'`. |
| 3. `foregroundServiceType` microphone | Moitié fait. Le manifeste généré déclare bien `phoneCall\|microphone` (`apply-native-config.mjs`, ligne ~102), **mais** l'appel Java `startForeground` (ligne ~350 du même script) passe encore uniquement `FOREGROUND_SERVICE_TYPE_PHONE_CALL`. C'est le vrai bug restant : Android 14 coupe le micro en arrière-plan. |
| 4. Gate `verify:android` | Présent dans `package.json`. |
| 5. Mirroring JS | Présent (`audit-parity.mjs`). |
| 6. `docs/ios-android-parity.md` | Déjà présent dans `apps/planipret-mobile/docs/` (le rapport a regardé la racine `docs/`). |
| `google-services.json` placeholder | Le dossier `apps/planipret-mobile/android/` n'existe pas dans le dépôt (généré par `cap add android` en local). `verify-android.mjs` signale déjà l'absence du fichier. |

Conclusion : une seule correction de code est réellement nécessaire, plus deux petits alignements.

## Ce qui sera fait

### Phase 1 — Micro en arrière-plan (Android 14+)
Dans `apps/planipret-mobile/scripts/apply-native-config.mjs`, dans le gabarit Java de `PpSipKeepAliveService`, passer :

`FOREGROUND_SERVICE_TYPE_PHONE_CALL` → `FOREGROUND_SERVICE_TYPE_PHONE_CALL | FOREGROUND_SERVICE_TYPE_MICROPHONE`

et ajouter l'import `android.content.pm.ServiceInfo` s'il manque. Le manifeste déclare déjà les deux types, donc les deux resteront cohérents.

### Phase 2 — Alias `fcm_push`
Dans `src/lib/planipret/sip/nativePpSipService.ts` (et son miroir web), accepter explicitement `"fcm_push"` comme raison de réveil au même titre que `"voip_push"`, pour que les logs et le chemin de réveil soient identiques iOS/Android.

### Phase 3 — Durcir la vérification Android
Étendre `scripts/verify-android.mjs` pour échouer (au lieu d'une simple note) si `google-services.json` est un placeholder (`project_id` contenant `placeholder` ou clé `PLACEHOLDER_...`), et pour vérifier que le `startForeground` généré contient bien les deux types. Mettre à jour `docs/ios-android-parity.md` avec la checklist Firebase demandée.

## Rapport
À la fin de chaque phase, je fournirai un rapport détaillé : fichier, lignes modifiées, avant/après, et effet attendu sur l'appareil.

## Action de votre côté (hors Lovable)
1. Créer le projet Firebase, télécharger le vrai `google-services.json` et le placer dans `android/app/` après `npx cap add android`.
2. Ajouter la clé de service account Firebase Admin SDK comme secret `FCM_SERVICE_ACCOUNT_JSON` (ou dans `planipret_integration_secrets.config.fcm_service_account_json`).

Sans ces deux étapes, les appels entrants app tuée ne réveilleront pas Android, même après les correctifs.
