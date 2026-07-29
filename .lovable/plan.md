## Plan: régler définitivement la boucle SIP 1001 / reconnect

### Problème confirmé
- Le provider Web SIP Planiprêt utilise déjà un guard `v4`, mais il laisse encore deux mécanismes se battre:
  - JsSIP reconnecte automatiquement le WebSocket.
  - Le watchdog custom peut reconstruire/reconnecter en même temps.
- Plusieurs chemins appellent encore `register()` directement après resume, token VoIP, unregistered, retry, watchdog.
- Le plugin natif iOS envoie aussi un REGISTER au démarrage WebSocket + un autre REGISTER via `beginNativeOwnership`, ce qui peut créer deux REGISTER successifs.
- Android génère un `Contact` différent à chaque REGISTER avec `UUID.randomUUID()`, ce qui peut laisser des contacts PBX fantômes et envoyer les appels vers voicemail.

### Correctifs à appliquer
1. **JS SIP provider**
   - Passer le guard à `v5`.
   - Laisser JsSIP propriétaire du premier reconnect WebSocket.
   - Transformer le watchdog en vérification différée seulement, puis takeover uniquement si JsSIP n’a pas récupéré.
   - Ajouter un wrapper global autour de `ua.register()` pour bloquer tous les REGISTER trop rapprochés, même ceux déclenchés par resume/token/watchdog.
   - Remplacer les `ua.register()` directs par un `guardedRegister(reason)` unique.

2. **iOS native keep-alive**
   - Supprimer le double REGISTER au moment du handoff background.
   - Garder un seul REGISTER initial après ouverture WebSocket.
   - Remplacer le ping OPTIONS immédiat `0.3s` par un délai configurable/plus stable, ou le désactiver si `keepAliveMs <= 0`.
   - Éviter qu’un `triggerReregister()` en background envoie un REGISTER si un REGISTER vient d’être accepté.

3. **Android native keep-alive**
   - Remplacer le `Contact` aléatoire par un contact stable basé sur l’extension.
   - Arrêter de demander un re-register JS à chaque heartbeat natif.
   - Conserver le service foreground, WakeLock/WifiLock, mais éviter les REGISTER concurrents.

4. **Config NetSapiens**
   - Augmenter le backoff minimum et le délai de vérification pour réduire les storms.
   - Garder un REGISTER expiry long, mais ne pas utiliser REGISTER comme keep-alive toutes les 60s si le socket est déjà enregistré.

5. **Protection / test de non-régression**
   - Mettre à jour le test existant pour vérifier:
     - pas de reconnect 1000ms;
     - pas de double socket;
     - pas de double `register()` dans une fenêtre courte;
     - contact Android stable dans le générateur.

### Validation
- Lancer le test SIP ciblé.
- Vérifier par recherche que les anciens patterns dangereux ne restent plus:
  - REGISTER manuel non gardé;
  - `UUID.randomUUID()` dans le Contact Android;
  - ping OPTIONS immédiat après REGISTER;
  - message legacy `sip reconnect scheduled in 1000ms`.