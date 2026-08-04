# Appels entrants et sortants — diagnostic complet et correction

Audit fait fichier par fichier (plugins natifs iOS, bridge JS, hooks React, Edge Functions NetSapiens, docs NS-API). Voici ce que l'audit a confirmé et le plan pour régler ça pour de bon.

## Ce qui est confirmé (vérifié dans le code)

1. **Conflit de transport TLS vs WSS sur la même AOR `<ext>M`**
   - Le PBX provisionne l'appareil `<ext>M` en **WSS** : `ns-provision-broker-devices/index.ts:213-218` et `ns-resolve-sip-credentials/index.ts:379-381` forcent `transport: "WSS"` / `device-sip-transport-type: "WSS"`.
   - Le moteur natif s'enregistre en **TLS 5061** sur la même AOR : `PpPjsipEngine.swift:240,248` (`;transport=tls`).
   - NetSapiens garde le contact/registration par appareil : l'enregistrement natif ne correspond pas au transport déclaré sur l'objet Device → les appels entrants ne sont pas forkés vers ce contact.

2. **Le binaire PJSIP est absent du dépôt**
   - `ios/App/App/Plugins/PpPjsip/Frameworks/` n'existe pas. `build-pjsip-ios.sh` doit tourner sur macOS.
   - Sans lui, `PpPjsip.swift:47-55` log `FATAL — module pjsua is not importable`, `isEngineLinked()` = false, et tout retombe sur JsSIP/WSS.

3. **Le noeud core n'est pas épinglé pour le chemin natif**
   - WSS est épinglé sur `core1` (`sipEdgePolicy.ts:12-14,36-47`), mais le natif utilise `creds.sip_proxy ?? creds.sip_core_server` (`nativeSipService.ts:169-171`) — donc potentiellement `core2` ou le portail, ce qui casse l'invariant single-core.

4. **Course d'arbitrage AOR encore ouverte**
   - `preclaimNativeAor` (`aorArbitration.ts:187-206`) revendique l'AOR avant de confirmer le moteur; fenêtre de blocage JsSIP.
   - `PpSipKeepAlive.swift:280-313` ne laisse que 1,5 s à JsSIP après un push VoIP avant de faire son propre REGISTER WSS → collision / fermeture 1001.

5. **Non vérifié (à valider en live, pas depuis le code)**
   - Contenu réel des answering rules par courtier (`<OwnDevices>`, `forward-when-unregistered`).
   - État réel de l'abonnement webhook NS (`model=call`, post-url, secret).
   - Valeur réelle de `core-server` sur les devices `<ext>M` en production.

## Plan de correction

### Étape 1 — Trancher le transport : un seul transport par AOR
Choix retenu : **le device `<ext>M` devient un device TLS** (natif iOS/Android PJSIP), et le WebView JsSIP utilise une AOR distincte `<ext>W` en WSS.
- `ns-provision-broker-devices` : `<ext>M` → `transport: "TLS"`, `device-sip-transport-type: "TLS"`, port 5061; `<ext>W` reste WSS 9002.
- `ns-resolve-sip-credentials` : arrêter de forcer WSS sur `<ext>M`; retourner `transport` selon l'AOR demandée.
- Résultat : plus jamais deux transports concurrents sur la même AOR → fin des fermetures 1001 et des entrants perdus.

### Étape 2 — Épingler le core node pour le chemin natif
- `nativeSipService.ts` : passer par la même politique que `sipEdgePolicy` (préférence `core1`, fallback `core2`, rejet du portail `voice.ava-telecom.ca`), au lieu de faire confiance à `core-server` renvoyé par NS.
- Ajouter le même filtre côté `ns-resolve-sip-credentials` pour le champ `sip_proxy`.

### Étape 3 — Rendre l'arbitrage AOR déterministe
- Comme chaque pile a désormais son AOR (`<ext>M` natif / `<ext>W` WebView), supprimer le pré-claim spéculatif et le watchdog 20 s dans `aorArbitration.ts`.
- `PpSipKeepAlive.swift` : ne plus faire de REGISTER WSS sur `<ext>M` — le keep-alive natif se limite à `<ext>M` en TLS.

### Étape 4 — Garantir la présence du binaire PJSIP
- `apply-native-config.mjs` : si `libpjsip.xcframework` est absent, écrire un marqueur explicite et forcer le mode JsSIP dès le boot (pas de pré-claim natif) — pas de mode « moitié natif ».
- Ajouter `npm run ios:doctor` qui affiche en clair : xcframework présent ou non, TLS activé (`PJ_HAS_SSL_SOCK=1`), transport du device, core-server, AOR active.

### Étape 5 — Valider la configuration PBX en live
Script/fonction de diagnostic `pp-ns-call-doctor` qui, pour une extension donnée, retourne :
- les devices et leur `device-sip-transport-type` + `device-sip-registration-*` (doc `devices.md`),
- l'answering rule active avec présence de SimRing/`<OwnDevices>` et `forward-when-unregistered` (doc `answerrules.md`),
- l'état de l'abonnement webhook (`model=call`, post-url) (doc `webhooks.md`),
- le routage du DID vers l'utilisateur (doc `phonenumbers.md`, avec l'invariant `dial-rule-translation-destination-user`).
Ce rapport est affiché dans `MSipDebug.tsx` pour pouvoir diagnostiquer sans Xcode.

### Étape 6 — Sortants
- Vérifier que l'appel sortant natif passe bien par `pjsua_call_make_call` avec le CID configuré, et que le fallback JsSIP utilise `pp-ns-calls` en mode synchrone.
- Corriger le raccrochage : code `0` (CANCEL/BYE) sortant, `603` entrant, avec fermeture CallKit garantie même si PJSIP échoue.

## Critère de succès
Sur un vrai téléphone iOS et Android, avec l'app en arrière-plan et écran verrouillé :
1. appel entrant → sonnerie CallKit/ConnectionService < 5 s, bouton Décrocher fonctionne, audio bidirectionnel;
2. appel sortant depuis le clavier → sonnerie chez l'appelé, audio bidirectionnel, raccrochage propre des deux côtés;
3. `pp-ns-call-doctor` retourne 100 % vert pour l'extension testée.

## Détails techniques
Fichiers touchés : `supabase/functions/ns-provision-broker-devices`, `ns-resolve-sip-credentials`, nouvelle fonction `pp-ns-call-doctor`; `apps/planipret-mobile/src/lib/planipret/sip/{nativeSipService,aorArbitration,sipEdgePolicy,ppSipProvider}.ts`; `useMplanipretSoftphone.ts`; `MSipDebug.tsx`; `ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift`; `PpPjsipEngine.swift`; `scripts/apply-native-config.mjs`.

Après approbation, ordre d'exécution : Étape 5 (diagnostic, non destructif) → Étape 1 → 2 → 3 → 6 → 4.
