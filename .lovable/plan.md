# SIP natif iOS (PJSIP) pour tous les courtiers — Planiprêt Mobile

## Constats vérifiés avant le plan

- `@capacitor-community/pjsip` **n'existe pas** sur npm (404), et `capacitor-pjsip` non plus. L'étape 1 du prompt ne peut pas être appliquée telle quelle : il faut un plugin local, pas un `npm install`.
- Un squelette de plugin local existe déjà, mais dans l'autre app : `apps/ava-softphone-mobile/capacitor-pjsip/` (méthodes `initAccount/makeCall/hangup/answer/...`, actuellement des stubs Objective-C sans moteur PJSIP).
- `ns-resolve-sip-credentials` retourne bien des identifiants par courtier authentifié, mais les noms de champs diffèrent du prompt : `sip_username`, `sip_password`, `sip_domain`, `sip_proxy` / `sip_core_server`, `sip_ws_url(s)`, `display_name`. Il n'y a **pas** de `sip_outbound_proxy`.
- Convention d'AOR actuelle : `<ext>M` (ex. `113M`), **pas** `113_mobile` — imposée côté NS-API par `_shared/pp-device-ids.ts` et documentée comme invariant (le `_` casse le provisionnement).
- Le device mobile est provisionné en `device-sip-transport-type: WSS` (core1, port 9002), pas en TCP 5060.

Conséquence : je garde l'architecture demandée (moteur SIP natif + repli REST), mais avec les valeurs réelles du système, et le moteur PJSIP proprement dit devra être compilé localement (Xcode), pas ici.

## Ce que je vais livrer

1. **Plugin local `capacitor-pjsip` pour Planiprêt**
   - Nouveau dossier `apps/planipret-mobile/capacitor-pjsip/` (package local référencé en `file:./capacitor-pjsip`, aucun paquet npm inexistant).
   - API TypeScript : `initialize`, `register`, `unregister`, `makeCall`, `answerCall`, `hangupCall`, `setMute`, `setSpeaker`, événements `registrationState`, `incomingCall`, `callState`.
   - Côté iOS : implémentation Swift qui expose l'API et se branche sur PJSIP quand le binaire est présent ; sinon elle renvoie `unavailable` proprement (l'app continue en REST).
   - L'intégration du binaire PJSIP (podspec `vendored_frameworks` + build de pjproject) est documentée dans un fichier `docs/pjsip-ios-setup.md` — étape à exécuter sur ta machine avec Xcode.

2. **`apps/planipret-mobile/src/lib/native/NativeSipService.ts`**
   - Singleton comme dans ton prompt, mais mappé sur les vrais champs : `sip_username`, `sip_password`, `sip_domain`, proxy = `sip_proxy || sip_core_server`, transport WSS (`sip_ws_url`) avec repli TCP 5060 si le plugin le demande.
   - Retries bornés (3 × 30 s), diffusion des `CustomEvent` `sip-registration-state`, `sip-incoming-call`, `sip-call-state`.
   - Ne s'initialise que sur natif ; le portail web n'est pas touché.

3. **Initialisation après authentification** dans `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx` (`useEffect` sur la session, natif uniquement).

4. **Décrochage** dans `apps/planipret-mobile/src/components/InboundCallOverlay.tsx`
   - Bouton vert : `nativeSip.answer()` si enregistré, sinon repli click-to-call REST déjà en place (`pp-ns-calls`, action `callback`, `auto_answer`).
   - Bouton rouge : `nativeSip.hangup()` puis repli `reject` / `DELETE` existant.

5. **Entitlements et Info.plist iOS**
   - Vérification/ajout de `UIBackgroundModes` = `voip`, `audio`, `remote-notification` et des clés VoIP, appliqués via `scripts/apply-native-config.mjs` pour qu'un `cap sync` ne les efface pas.

6. **Affichage du statut** sur l'écran d'accueil mobile (`MHome.tsx`) : écoute de `sip-registration-state` → « ● En ligne — Ext {ext} » (vert) / « ● Prête (REST) » (vert) / « ● Hors ligne » (rouge). Aucun jeton de debug affiché.

## Points techniques

- Aucun identifiant en dur : tout vient de `ns-resolve-sip-credentials` avec `client_type: 'mobile'`, donc valable pour les 355 courtiers du domaine `planipret.ca` sans configuration par courtier.
- Coexistence avec l'existant : quand le moteur natif détient l'AOR, `PpSipKeepAlive` et JsSIP ne doivent pas ré-enregistrer. Je branche `NativeSipService` sur l'arbitrage de propriété déjà en place (`declareJsOwnsAor` / grace window) pour éviter de recréer une guerre de REGISTER et des fermetures WSS 1001.
- Le repli REST reste le chemin par défaut tant que PJSIP n'est pas compilé : aucun risque de régression sur le comportement actuel.

## Limite à connaître

Je ne peux pas compiler PJSIP ni valider un appel réel depuis cet environnement. Après le merge, il faudra sur ta machine : `git pull`, build de pjproject pour iOS (script fourni), `npx cap sync ios`, puis test d'appel entrant app fermée. Tant que le binaire n'est pas là, l'app reste en mode REST — fonctionnelle, mais sans le décrochage natif.
