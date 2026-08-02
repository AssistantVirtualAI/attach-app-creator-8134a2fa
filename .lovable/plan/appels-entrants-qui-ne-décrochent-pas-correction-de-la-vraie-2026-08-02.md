# Appels entrants qui ne décrochent pas — correction de la vraie cause

## Ce que les logs prouvent (pas d'hypothèse)

Ligne par ligne dans le log Xcode fourni :

1. La socket SIP meurt en arrière-plan : `ws disconnected code 1001`, puis
   `[PpSipKeepAlive] REGISTER send failed: POSIX 57 Socket is not connected`,
   puis `REGISTER skipped: ws_not_open` (x2).
2. Le push VoIP arrive et réveille l'app (`VoIP push wake`), l'app affiche la sonnerie.
3. Au moment du décrochage, le backend répond :
   `registration: { mobile_aor: "113M", registered_aors: [], count: 0, mobile_registered: false }`
   → **le poste n'est PAS enregistré au PBX**. Aucun INVITE ne peut donc arriver.
4. La tentative de récupération est bloquée par les anti-rebonds :
   `urgent REGISTER suppressed (352ms < 800ms)` puis
   `explicit REGISTER suppressed (0ms < 5000ms)` et `(408ms/409ms < 5000ms)`.
   `forceReregister()` croit encore être `registered` (état JS périmé) donc il fait
   un simple refresh au lieu de reconstruire la socket morte.
5. Résultat : `no confirmed SIP dialog … refusing false REST answer` → l'appelant
   reste sur le message d'accueil → boîte vocale.
6. Bonus visible : `stopSipService` est appelé pendant le handoff foreground alors
   qu'une sonnerie est en cours, ce qui achève la registration restante.

Note importante : le build testé est ancien (`BUILD MARKER pp-build-2026-08-02-callkit32`,
message « after 8s » qui n'existe plus dans le code). Une partie des correctifs
précédents n'était donc pas dans l'app testée — mais la cause ci-dessus, elle,
est bien présente dans le code actuel.

## Ce que je vais corriger

### 1. Réveil push = reconstruction autoritaire du transport (cœur du fix)
- Nouvelle méthode `wakeForIncoming(callId)` dans `ppSipProvider` :
  - ignore l'état JS `registered` (jugé non fiable après un 1001) ;
  - ferme et reconstruit la WebSocket immédiatement (rebuild dur), sans passer par
    les anti-rebonds ;
  - attend l'évènement `registered` réel avant de considérer le poste joignable ;
  - met en file l'intention de réponse (`pendingAnswer`) qui survit au rebuild.
- Le chemin push (`nativePpSipService` / hook) appelle `wakeForIncoming()` **dès la
  réception du push**, pas au moment du tap sur « Répondre ».

### 2. Anti-rebonds contournables en priorité « appel entrant »
- `guardedRegister(reason, { priority: true })` : les raisons liées à un appel entrant
  (`push_wake`, `incoming_answer`) ne sont jamais supprimées par le debounce.
- Si la socket n'est pas ouverte, on reconstruit au lieu de logger « skipped ».

### 3. Ne jamais couper le SIP pendant une sonnerie
- `stopSipService` / handoff background↔foreground refusent d'arrêter le service
  quand un appel entrant est en cours (`activeInvite`/`pendingAnswer` présents),
  côté JS et côté natif (`PpSipKeepAlive.swift` + template `apply-native-config.mjs`).

### 4. Fenêtre de réponse alignée sur la reconstruction
- `PP_PENDING_ANSWER_TIMEOUT_MS` reste à 30 s, mais le compte à rebours ne démarre
  qu'une fois la socket rouverte, pour ne pas expirer pendant un rebuild lent.

### 5. Maestro (visible dans le même log)
- `maestro_reconnect_required` : le refresh token est mort → l'écran affiche un état
  clair « reconnexion requise » et le bouton lance la session native.
- `Unable to display URL` : provient encore de `Browser.open` dans le build testé ;
  le code actuel utilise déjà `ASWebAuthenticationSession`. J'ajoute un repli
  explicite + log de diagnostic pour confirmer quel chemin s'exécute.
- On arrête les 3 tentatives de post d'appel en boucle quand `needs_reauth = true`
  (mise en file au lieu de réessais immédiats).

### 6. Marqueur de build
- Nouveau `BUILD MARKER` incrémenté pour qu'on puisse vérifier en 2 secondes, dans
  les logs Xcode, que le device exécute bien la nouvelle version.

## Fichiers touchés
- `src/lib/planipret/sip/ppSipProvider.ts` + copie `apps/planipret-mobile/…`
- `src/hooks/useMplanipretSoftphone.ts` + copie mobile
- `apps/planipret-mobile/src/lib/planipret/sip/nativePpSipService.ts`
- `apps/planipret-mobile/ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift`
- `apps/planipret-mobile/scripts/apply-native-config.mjs` (templates natifs)
- `MaestroConnectCard.tsx` + `maestroCallPosting.ts`

## Vérification après build
`git pull && npx cap sync ios`, puis dans les logs Xcode on doit voir :
`BUILD MARKER` neuf → `push wake → transport rebuild` → `registered` →
`INVITE received` → `200 OK sent (answer)`, et `mobile_registered: true`
dans `pp-sip-registration-check`.
