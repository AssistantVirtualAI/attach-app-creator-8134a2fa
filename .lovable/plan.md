## Diagnostic confirmé

Le log ne montre **aucun VoIP push reçu ni aucun INVITE reçu pendant l’appel**. Il montre plutôt :

- l’envoi du token PushKit échoue continuellement avec `FunctionsFetchError`;
- en arrière-plan, le service reste longtemps en `background_handoff_pending` sans inscription SIP confirmée;
- au retour dans l’app, plusieurs REGISTER sont supprimés par le garde anti-doublon, puis les sockets JsSIP sont fermées en `1001`;
- le natif finit par recevoir `native_register_200`, mais trop tard pour l’appel déjà envoyé vers la messagerie.

Selon `docs/netsapiens/devices.md`, un mobile dont le push n’est pas disponible et dont le Device est non enregistré tombe vers l’étape suivante, typiquement la boîte vocale. Selon `docs/netsapiens/registrations.md`, la vérité réseau est l’état d’inscription du Device sur le core.

Il existe aussi un défaut certain dans la prise d’appel : le service Swift actuel sait répondre `180 Ringing`, mais ne sait pas établir l’appel avec un `200 OK + SDP`. Le bouton CallKit signale seulement l’action à JsSIP; si l’INVITE appartient au socket natif, `ppSipProvider.answer()` n’a aucune session correspondante et ne fait rien.

## Correctif ciblé

1. **Fiabiliser l’enregistrement PushKit**
   - Protéger `pp-voip-push-token` avec validation, réponses CORS sur toutes les erreurs et journalisation exploitable.
   - Dédupliquer les envois côté application : un seul upload en vol par token, persistance du dernier token confirmé et retry avec backoff.
   - Ne jamais marquer localement le token comme confirmé tant que le backend ne l’a pas réellement persisté.

2. **Supprimer la fenêtre sans inscription en arrière-plan**
   - Corriger le handoff pour que le service natif commence immédiatement après la libération confirmée de JsSIP, sans attendre un deuxième événement réseau/app-state.
   - Conserver un propriétaire SIP unique et un REGISTER single-flight afin de ne pas recréer le `1001` par doubles transports.
   - Lors du retour au premier plan, garder le natif inscrit jusqu’au `REGISTER 200` réel de JsSIP, puis seulement fermer le natif.

3. **Rendre la prise d’appel réelle et atomique**
   - Ne plus afficher comme répondable un appel dont JsSIP ne possède pas l’INVITE actif.
   - Corréler CallKit, PushKit et la session SIP par `Call-ID`.
   - Mettre l’action Answer en attente jusqu’à l’arrivée de la session correspondante, avec expiration/CANCEL explicite; journaliser et fermer CallKit si le PBX a déjà annulé la branche.
   - Faire retourner à `ppSipProvider.answer()` un succès/échec réel au lieu d’un no-op silencieux.

4. **Ajouter des protections de non-régression**
   - Tests unitaires pour : upload PushKit dédupliqué, handoff sans double REGISTER, Answer avant/après INVITE, Call-ID incorrect et appel annulé.
   - Audit de build iOS vérifiant que les plugins SIP/PushKit et leurs méthodes sont inclus après chaque `cap sync`.
   - Logs structurés minimaux permettant de suivre `push → wake → REGISTER 200 → INVITE → Answer/200 OK` avec le même Call-ID.

5. **Valider le scénario exact**
   - Build/sync iOS Planiprêt uniquement.
   - Vérifier en foreground, background et écran verrouillé : sonnerie avant messagerie, annonce d’enregistrement, décroché avec audio, rejet et fin d’appel.
   - Confirmer l’absence de doubles REGISTER et de nouvelles boucles `1001`.

## Limites strictes

- Aucun changement aux DID.
- Aucun changement aux answer rules, SimRing ou routage NetSapiens.
- Aucun changement de core (`core1` reste épinglé), identifiants SIP ou autres applications.
- Seuls le flux iOS Planiprêt, le token PushKit et sa fonction dédiée seront modifiés.