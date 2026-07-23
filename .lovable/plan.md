
# Softphone — Appels internes, réception background, hold/transfer, UI

## Problèmes constatés (capture 223 → 300)

1. **L'appelé (300) ne sonne pas / ne peut pas répondre** en interne, ni en foreground ni en background sur Android/iOS.
2. **L'affichage de l'appel interne** montre l'URI SIP brute (`"Kenny Rooney" <sip:223@lemtel.lemtel.tel>`) au lieu d'un affichage propre (nom + extension + badge "Interne").
3. **Hold et Transfer** ne sont pas exposés/opérationnels de façon fiable pour les appels internes.
4. **Réception en arrière-plan** : parité iOS (PushKit/APNs) et Android (SipConnectionService + FCM data push) à consolider pour que le poste sonne toujours quand l'app est fermée ou l'écran verrouillé.

## Plan par plateforme

### 1. Réception des appels internes (routage FusionPBX)
- Vérifier via `fusionpbx-proxy` que le dialplan interne (ext→ext) route bien via **Sofia mobile profile** (WSS 7443 pour Android JsSIP, port 5060 TLS pour PJSIP iOS, port 8082 Verto pour Android Verto), pas seulement via un profil "internal" 5060 sans WS/Verto.
- Ajouter un check dans `repair-verto-extension-routing` (Android) qui s'assure que le user_record de l'extension 300 pointe vers le contact WS actif ; sinon `sofia profile mobile flush_inbound_reg`.
- Ajouter côté iOS : quand PushKit reçoit un `INVITE` push, forcer un re-REGISTER **avant** d'accepter, sinon FusionPBX envoie le INVITE au vieux contact (cause probable du 300 muet).

### 2. iOS — sonnerie background/verrouillé
- `CapacitorSip.swift` : vérifier que `PKPushRegistry` reçoit bien un `pushRegistry(_:didReceiveIncomingPushWith:for:completion:)` et **immédiatement** :
  - Reporte l'appel via `CXProvider.reportNewIncomingCall` (CallKit) — sinon iOS 13+ tue l'app.
  - Puis pousse un event `incomingCall` vers le JS via Capacitor `notifyListeners`.
- Ajouter CallKit minimal (déjà partiellement présent) : `CXProvider` + `CXCallController`, actions Answer/End/Hold branchées sur PJSIP.
- S'assurer que le topic APNs `com.lemtel.softphone.voip` est bien envoyé par FusionPBX (déjà corrigé) — ajouter un log serveur `push-diag` pour tracer chaque push émis vers 300.

### 3. Android — sonnerie background/verrouillé
- `SipConnectionService.kt` : promouvoir le service en `phoneCall` foreground type dès qu'un `verto.invite` arrive (déjà présent) + réveiller la WebView via `PowerManager.PARTIAL_WAKE_LOCK` **avant** de dispatcher l'event JS.
- Ajouter fallback **FCM data-push** (haute priorité) déclenché côté serveur si Verto WS est mort (>30 s sans pong) → réveille l'app, force reconnect Verto, puis accepte l'INVITE.
- Ajouter une `HeadsUpNotification` (full-screen intent) pour afficher `IncomingCallSheet` même si l'écran est verrouillé.

### 4. UI d'appel interne
- `ActiveCallSheet.tsx` + `IncomingCallSheet.tsx` : formatter proprement :
  - Extraire `user` de `sip:USER@domain` → afficher **"Kenny Rooney"** en grand + **"Poste 223 · Interne"** en sous-titre.
  - Badge visuel "Interne" quand `remoteParty` matche une extension de l'org (via cache `pbx_softphone_users`).
  - Retirer complètement l'URI SIP brute de l'écran.
- Timeline (COMPOSITION → SONNERIE → TONALITÉ → CONNECTÉ) : masquer sur appel entrant, garder seulement sur sortant.

### 5. Hold + Transfer (interne et externe)
- `useSoftphone.ts` : exposer `hold/unhold` sur les 3 providers (jssip, verto, native-pjsip) — actuellement `hold` n'est branché que pour JsSIP.
- Ajouter `attendedTransfer(target)` et `blindTransfer(target)` :
  - JsSIP : `session.refer(target)`.
  - Verto : `verto.modify` avec `action: 'transfer'` + `dest_number`.
  - PJSIP iOS : `pjsua_call_xfer`.
- Ajouter boutons **Hold** et **Transférer** dans `ActiveCallSheet` avec une feuille de sélection d'extension (autocomplete sur les postes de l'org).

## Détails techniques

- Fichiers modifiés :
  - `apps/ava-softphone-mobile/src/components/ActiveCallSheet.tsx`, `IncomingCallSheet.tsx`
  - `apps/ava-softphone-mobile/src/hooks/useSoftphone.ts`, `useSoftphoneNative.ts`, `useSoftphoneVerto.ts`
  - `apps/ava-softphone-mobile/src/lib/sip/{jssipProvider,vertoProvider,nativeSipProvider}.ts`
  - `apps/ava-softphone-mobile/ios/App/App/CapacitorSip.swift` (+ CallKit provider)
  - `apps/ava-softphone-mobile/android/app/src/main/java/.../SipConnectionService.kt` (+ full-screen intent)
- Edge functions : nouveau `pbx-fcm-wake` (Android fallback) + amélioration `repair-verto-extension-routing`.
- Nouveau util `formatSipParty(remoteUri, orgExtensions)` partagé pour l'affichage.

## Ordre d'exécution
1. Util `formatSipParty` + refactor UI (`ActiveCallSheet` / `IncomingCallSheet`) — impact visuel immédiat.
2. Hold/Transfer sur les 3 providers + boutons UI.
3. iOS : CallKit + re-REGISTER sur PushKit.
4. Android : full-screen intent + FCM wake fallback.
5. Diagnostic serveur `push-diag` + validation 223↔300 en background.
