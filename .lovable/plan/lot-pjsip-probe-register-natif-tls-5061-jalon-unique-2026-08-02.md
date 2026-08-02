# Lot PJSIP probe — REGISTER natif TLS 5061 (jalon unique)

## Constats vérifiés dans CE dépôt (avant de coder)

Trois affirmations du prompt ne correspondent pas à l'état réel du dépôt. Elles doivent être corrigées, sinon le lot repartirait au mauvais endroit.

- Il n'existe **pas** de dossier `ios/` à la racine, ni `src/index.tsx`, ni `scripts/patch-xcode-plugins.mjs`. Le projet iOS Planiprêt est `apps/planipret-mobile/ios/App/App/`, avec les plugins existants `PpAuthSession`, `PpSipKeepAlive`, `PpVoipCall`. Le `capacitor.config.ts` de l'app (`com.planipret.mobile`, `webDir: dist`) est dans `apps/planipret-mobile/`. Le bundle iOS est donc bien produit depuis `apps/planipret-mobile/src/`, pas depuis `src/` à la racine.
- Le marqueur de build vit dans `apps/planipret-mobile/src/index.tsx` ligne 153, et vaut aujourd'hui `pp-build-2026-08-02-pjsip2` (pas `ring19`).
- `rtp probe` : **0 occurrence** dans tout le dépôt, ni dans `src/lib/planipret/sip/ppSipProvider.ts` (1279 lignes) ni dans la copie mobile (1296 lignes). La copie mobile est la plus récente des deux, pas l'inverse.

Ce que je retiens du prompt sans réserve : transport **TLS 5061** (pas WSS 9002, pas TCP 5060), un seul jalon (REGISTER), AOR de test distincte, aucun branchement sur le chemin d'appel.

## Limite annoncée d'emblée

Je **ne peux pas compiler pjproject** ici : pas de macOS, pas de Xcode, pas de SDK iOS dans cet environnement. Le `libpjsip.xcframework` doit être produit sur ta machine. Je livre donc :

- un script de build reproductible que tu lances sur le Mac ;
- le plugin Swift avec l'implémentation `pjsua_*` **réellement écrite** (pas des corps vides), compilée sous `#if canImport(pjsua)` ;
- l'échec explicite `binary_missing` (message clair, pas `unavailable`) tant que le framework n'est pas là.

Autrement dit : le code d'appel PJSIP est complet et relisible dès ce lot ; seule l'édition de liens dépend de ton Mac.

## Travail

1. **Script de build** `apps/planipret-mobile/scripts/build-pjsip-ios.sh`
   - clone pjproject, écrit `config_site.h` (`PJ_CONFIG_IPHONE 1`, `PJMEDIA_HAS_VIDEO 0`, TLS activé via OpenSSL, **aucun** `PJSIP_TRANSPORT_WSS`), compile device arm64 + simulateur, assemble `libpjsip.xcframework` dans `apps/planipret-mobile/ios/App/App/Plugins/PpPjsip/Frameworks/`.

2. **Plugin natif** `ios/App/App/Plugins/PpPjsip/PpPjsip.swift` + `PpPjsip.m`
   - une seule méthode `registerTest({ username, password, domain, server, port, transport })`.
   - Implémentation réelle : `pjsua_create` → `pjsua_init` (log level 5, writer redirigé vers `NSLog`) → `pjsua_transport_create(PJSIP_TRANSPORT_TLS, port 0)` → `pjsua_start` → `pjsua_acc_add` avec AOR de test → `on_reg_state2` remonte le code SIP effectif via un `resolve` de promesse.
   - Contexte thread : entrée dans PJSIP par `pjsua_schedule_timer2()` (délai 0), pas de GCD à travers la frontière.
   - **Aucune** manipulation d'`AVAudioSession` (laisse `PpVoipCall` tranquille).
   - **AOR de test distincte** : `<ext>MPROBE` avec `Contact` portant un `+sip.instance` propre, pour ne jamais voler l'enregistrement de `113M`. Le natif ne se déclare pas propriétaire de l'AOR dans ce lot.
   - Enregistrement dans le projet Xcode par **extension** de `apps/planipret-mobile/scripts/apply-native-config.mjs` (qui injecte déjà `PpSipKeepAlive` / `PpVoipCall`) et de `AppBridgeViewController.swift`. Pas de nouveau script.

3. **Déclenchement TS** `apps/planipret-mobile/src/lib/native/PpPjsipProbe.ts`
   - récupère les identifiants via `ns-resolve-sip-credentials` (`client_type: 'mobile'`), appelle `registerTest` avec `transport: 'TLS'`, `port: 5061`, serveur `core1.cluster1.ucstack.io`, journalise le résultat.
   - Bouton **manuel** ajouté dans `MSipDebug.tsx` (panneau de diagnostic existant). Aucun REGISTER natif au démarrage.
   - `NativeSipService.ts` n'est pas branché sur le chemin d'appel.

4. **Marqueur** `pp-build-2026-08-02-pjsip-probe1` dans `apps/planipret-mobile/src/index.tsx`.

## Intouchable dans ce lot

`ppSipProvider.ts` (les deux copies), `useMplanipretSoftphone.ts`, tout le chemin JsSIP, `PpSipKeepAlive.swift`. Aucun Click-to-Call REST sur le décrochage.

## Vérifications que je ferai et rapporterai

- `grep -c 'pjsua_init\|pjsua_acc_add\|pjsua_transport_create' PpPjsip.swift` > 0
- 0 occurrence de `PJSIP_TRANSPORT_WSS` et de `:9002` dans le nouveau code
- `PpPjsip` référencé par `apply-native-config.mjs` et `AppBridgeViewController.swift`
- diff limité à `apps/planipret-mobile/**` (+ ce plan) ; `ppSipProvider.ts` et `useMplanipretSoftphone.ts` inchangés
- marqueur présent dans le bundle
- typecheck vert

Le critère « `200 OK` visible dans la console Xcode » ne pourra être constaté que par toi, après build du framework et `cap sync` — je le dirai tel quel dans le rapport.

## Question de cadrage

Le prompt impose `src/` racine + `ios/` racine. Ici ces chemins ne construisent pas l'app iOS. Je pars donc sur `apps/planipret-mobile/`, qui est le vrai bundle. Si ton dépôt local a une arborescence différente de celle-ci, dis-le avant que je code.
