# PJSIP iOS — intégration du moteur SIP natif

Le plugin local `apps/planipret-mobile/capacitor-pjsip` expose déjà l'API JS
(`initialize`, `register`, `answerCall`, `hangupCall`, …). Tant que le binaire
PJSIP n'est pas lié, chaque méthode répond `unavailable` et l'application
retombe automatiquement sur le click-to-call REST : aucune régression.

Ces étapes doivent être faites sur un Mac avec Xcode.

## 1. Déclarer le plugin local

Dans `apps/planipret-mobile/package.json` (déjà fait) :

```json
"capacitor-pjsip": "file:./capacitor-pjsip"
```

Puis :

```bash
cd apps/planipret-mobile
npm install
npm run ios:build-sync
```

## 2. Compiler pjproject pour iOS

```bash
git clone https://github.com/pjsip/pjproject.git
cd pjproject
cat > pjlib/include/pj/config_site.h <<'EOF'
#define PJ_CONFIG_IPHONE 1
#define PJMEDIA_HAS_VIDEO 0
#define PJSIP_TRANSPORT_WSS 1
#include <pj/config_site_sample.h>
EOF
export IPHONESDK=iPhoneOS.sdk
ARCH='-arch arm64' ./configure-iphone --disable-video --disable-libyuv
make dep && make clean && make
```

Assembler ensuite un `libpjsip.xcframework` (device + simulateur) et le copier
dans `apps/planipret-mobile/capacitor-pjsip/ios/Frameworks/`.

## 3. Activer le lien dans le podspec

Dans `CapacitorPjsip.podspec`, décommenter :

```ruby
s.vendored_frameworks = 'ios/Frameworks/libpjsip.xcframework'
s.pod_target_xcconfig = { 'OTHER_SWIFT_FLAGS' => '-DPJSIP_AVAILABLE' }
```

## 4. Implémenter les callbacks

Dans `ios/Plugin/CapacitorPjsip.swift`, bloc `#if PJSIP_AVAILABLE` :

- `pjsipCreateAccount()` : `pjsua_create` / `pjsua_init` / `pjsua_transport_create`
  (TLS-WSS vers `sip_proxy` port 9002, ou TCP 5060 selon le transport reçu),
  puis `pjsua_acc_add` avec l'AOR `sip:<ext>M@planipret.ca`.
- `on_reg_state2` → `emitRegistration(state:code:)`
- `on_incoming_call` → `emitIncoming(callId:remoteNumber:remoteName:)`
- `on_call_state` / `on_call_media_state` → `emitCallState(_:callId:)`
- `pjsipAnswer` → `pjsua_call_answer(callId, 200, NULL, NULL)`
- `pjsipHangup` → `pjsua_call_hangup(callId, 0, NULL, NULL)`

## 5. Arbitrage de propriété de l'AOR

Un seul composant doit tenir le REGISTER. Dès que le moteur natif s'initialise,
`NativeSipService` émet `pp:sip-native-owns-aor` ; `PpSipKeepAlive` et JsSIP
doivent alors cesser leurs propres REGISTER (sinon NetSapiens ferme la branche
WSS en 1001).

## 6. Vérification

1. `npx cap sync ios` puis build sur appareil réel.
2. Log attendu : `[SIP] Initializing native engine for: 113M WSS core1.cluster1.ucstack.io`
   puis `[SIP] Registration: registered`.
3. Écran d'accueil : « ● En ligne — Ext 113 ».
4. Appel entrant application fermée : sonnerie CallKit, décrochage réel, audio bidirectionnel.
