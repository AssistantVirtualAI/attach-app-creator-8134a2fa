## Objectif

Garantir que **Planiprêt mobile** (NetSapiens / SIP-over-WSS / JsSIP) et **Lemtel mobile** (FreeSWITCH / Verto / port 8082) restent **strictement séparés**, et que les deux apps peuvent, en arrière-plan comme fermées :

1. Rester enregistrées auprès de leur PBX respectif.
2. Recevoir un appel entrant qui **sonne** et **affiche un écran d'appel natif** (CallKit iOS / full-screen notification Android) avec le bon nom/numéro.
3. Permettre à l'utilisateur de **répondre** depuis le lockscreen/notification et retrouver l'appel actif dans l'UI React.

Aucun mélange entre les deux stacks : Planiprêt ne doit jamais toucher à Verto, Lemtel ne doit jamais toucher à NetSapiens.

---

## Étape 1 — Audit de séparation des stacks

- Confirmer par `rg` qu'aucune référence croisée n'existe :
  - Planiprêt (`apps/planipret-mobile/**` + `src/pages/planipret/**` + `src/lib/sip/pp*`) : aucun `verto.*`, `8082`, `FreeSWITCH`.
  - Lemtel (`apps/ava-softphone-mobile/**`) : aucun `NetSapiens`, `JsSIP`, `ns-api`.
- Vérifier les services natifs distincts :
  - Planiprêt Android : `PpSipKeepAliveService.java` (SIP WSS + REGISTER MD5).
  - Planiprêt iOS : `PpSipKeepAlive.swift` (URLSessionWebSocketTask + REGISTER).
  - Lemtel Android : `SipConnectionService.kt` (Verto WebSocket).
  - Lemtel iOS : `CapacitorSip.swift` + PJSIP + CallKit.
- Documenter dans chaque fichier natif un en-tête « DO NOT MERGE WITH <autre app> ».

## Étape 2 — Planiprêt : appels entrants en arrière-plan (NetSapiens)

- Étendre `PpSipKeepAliveService.java` pour :
  - Parser les `INVITE` SIP entrants sur le WebSocket persistant (aujourd'hui il ne fait que REGISTER).
  - Émettre une notification full-screen intent avec actions Répondre/Refuser.
  - Broadcaster l'INVITE (Call-ID, From display + user, SDP) au WebView via un `PpSipEvents` plugin.
- Étendre `PpSipKeepAlive.swift` pour :
  - Détecter INVITE côté iOS et déclencher `CXProvider.reportNewIncomingCall` (nouveau `PpCallKitManager`).
  - Relayer l'action Answer CallKit vers le JS via un plugin `PpCallKit`.
- Côté JS (`src/lib/sip/ppSipProvider.ts` + hook `useSoftphonePp.ts` si absent) :
  - Ajouter `adoptNativeInboundInvite(callId, sdp, from)` pour reprendre l'appel dans JsSIP quand la WebView se réveille.
  - Mapper l'état à `ringing-in` pour que l'écran d'appel Planiprêt (équivalent `ActiveCallSheet`) affiche Répondre/Refuser.

## Étape 3 — Lemtel : consolidation du chemin déjà en place (Verto)

- Vérifier que `SipConnectionService.kt` diffuse bien `verto.invite` → notification full-screen + `answerNativeCall/hangupNativeCall` (fait précédemment).
- Vérifier iOS PJSIP → `CallKitManager.reportIncoming` (fait précédemment) et que `on_incoming_call` fonctionne app tuée.
- Ajouter un test de non-régression : `formatSipParty` sur URIs `<sip:223@...>` et `+1514...` doit produire « Poste 223 » / numéro formaté.

## Étape 4 — Persistance de l'enregistrement en arrière-plan

- Planiprêt : refresh REGISTER natif toutes les `expires/2` (typ. 60s) dans les deux services natifs, wakelock Android + `BGProcessingTask` iOS.
- Lemtel : refresh `verto.login` toutes les 4 min + ping 15s (déjà en place) — juste valider.
- Ajouter dans chaque app un écran debug (`MSipDebug` Lemtel existe déjà ; créer `PPSipDebug` Planiprêt) montrant : état socket, dernier REGISTER 200 OK, dernier INVITE reçu.

## Étape 5 — Validation

- `rg` de séparation (étape 1) doit rester vide après changements.
- Scénarios manuels documentés dans le plan :
  1. App fermée → appel entrant → sonnerie + écran natif → Répondre → audio 2 voies.
  2. App en background → idem.
  3. App ouverte → écran React `ringing-in` avec Répondre/Refuser.
- Répéter pour Planiprêt (poste NetSapiens) et Lemtel (poste FreeSWITCH) séparément.

---

## Détails techniques

- **Planiprêt PBX** : NetSapiens, `wss://<core>/ns-api/wss`, digest MD5, JsSIP côté JS.
- **Lemtel PBX** : FreeSWITCH mod_verto, `wss://<host>:8082`, JSON-RPC `verto.login/invite/answer`, PJSIP natif iOS pour CallKit.
- Nouveaux plugins Capacitor à créer si nécessaire : `PpSipEvents` (Android+iOS) pour Planiprêt uniquement.
- Aucun changement aux edge functions ni à la DB.

## Livrables

- Services natifs Planiprêt étendus (INVITE + notif + CallKit + bridge JS).
- Services natifs Lemtel vérifiés/durcis (pas de refonte).
- Écran debug SIP par app.
- Note d'architecture en tête de chaque fichier natif rappelant la séparation.
