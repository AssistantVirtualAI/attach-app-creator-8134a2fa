## Objectif

Trouver pourquoi les appels entrants tombent immédiatement sur la boîte vocale, garantir que chaque DID est bien lié au bon poste, et que l'enregistrement SIP tient en tout temps (app fermée / arrière-plan) sur iOS et Android.

## Ce que la vérification a déjà montré

- `planipret_did_assignments` contient 1 ligne par poste (ex. `+14388427218 → 1001`, domaine `planipret.ca`), mais la colonne `callerid_name` contient une **ligne CSV complète non parsée** (`source = file_sync`, jamais revalidée). Le mapping numéro→poste est donc *présumé* correct mais **jamais confronté à l'état réel du PBX**.
- Aucun profil n'a `ns_linked = true` et `sip_username` est `NULL` partout — l'app dépend entièrement de la résolution dynamique des identifiants.
- `pp-sync-answering-rules` écrit la route DID en aveugle (PUT sur 3 variantes d'endpoint) **sans relecture** : si le PBX ignore le payload, on ne le sait pas.
- La règle de réponse sonne **uniquement** `sip:{ext}_mobile@domaine` (`include-user-extension: no`, `ring-all-user-phones: no`). Si le mobile n'est pas enregistré à cet instant → aucun terminal ne sonne → renvoi immédiat vers la messagerie. C'est le comportement exact décrit.
- Côté client, l'enregistrement repose sur JsSIP dans la WebView (`register_expires: 300`, ping OPTIONS 25 s). Dès que l'OS suspend la WebView (app en arrière-plan/fermée), le socket meurt et le contact expire. Le relais natif (`PpSipKeepAlive` / `PpVoipCall`) répond souvent `UNIMPLEMENTED` dans les builds, donc il n'y a aucun filet.

## Plan

### 1. Audit réel DID → poste (lecture seule, aucun changement)
Étendre `pp-inbound-diagnostic` pour produire, par courtier, un rapport comparant :
- le DID stocké en base vs le(s) numéro(s) réellement présents sur le PBX (`/domains/{d}/phonenumbers`),
- l'application de destination réelle du DID (doit être `to-user` → `{ext}@{domaine}`, pas messagerie/SpeakAccount/AI),
- la règle de réponse réellement stockée (sim-ring, cibles, timeout, DND, renvois),
- les terminaux (`/users/{ext}/devices`) et **lesquels sont réellement enregistrés** (contact, expires, user-agent).

Sortie : verdict par poste (`OK`, `DID_MAL_ROUTE`, `AUCUN_DEVICE_ENREGISTRE`, `REGLE_INERTE`) + liste des écarts.

### 2. Réparation vérifiée des DID
- Dans `pp-sync-answering-rules`, ajouter une **relecture après écriture** de chaque DID : si la destination n'est pas `to-user → {ext}@domaine`, réessayer les variantes de champs, puis remonter l'échec explicitement (aujourd'hui il est silencieux).
- Réimporter proprement `planipret_did_assignments` depuis le PBX (source `ns_live`) pour corriger les lignes CSV mal parsées, avec le poste et le domaine comme clé.

### 3. Fin du « voicemail immédiat »
- Réintroduire un repli sûr dans la règle : sonner `{ext}_mobile` **et** `{ext}` (poste) simultanément, timeout 35 s, messagerie seulement après expiration.
- Si aucun terminal mobile enregistré n'est détecté au moment du sync, appliquer le repli `<OwnDevices>` plutôt qu'une cible morte.
- Vérification après écriture que la règle stockée contient bien le sim-ring et les cibles (déjà partiellement présent, la rendre bloquante et remontée dans l'UI d'admin).

### 4. Enregistrement SIP permanent
- **iOS** : arrêter de dépendre de l'enregistrement WebView en arrière-plan. Le chemin fiable est le **push VoIP (PushKit) + CallKit** : le PBX notifie, l'app est réveillée, se réenregistre et affiche l'appel. Vérifier de bout en bout que `pp-voip-push-token` reçoit bien un token (aujourd'hui `UNIMPLEMENTED`), que le plugin natif est bien injecté au build, et que `ns-webhook-receiver` envoie le push APNs avant que la règle n'expire.
- **Android** : service de premier plan persistant (equivalent de celui de l'app Lemtel) qui garde le socket SIP + WakeLock/WifiLock, exemption d'optimisation batterie, réenregistrement au changement réseau.
- Côté commun : `register_expires` aligné (180 s) entre JS et natif, réenregistrement immédiat au retour au premier plan et sur changement de réseau, sans double enregistrement.
- Écran de diagnostic : afficher l'état réel « enregistré depuis / dernier REGISTER / contact vu par le PBX » pour pouvoir constater la persistance.

### 5. Validation
- Test A : app au premier plan → appel entrant sonne.
- Test B : app en arrière-plan 10 min → appel entrant sonne (push VoIP iOS / service Android).
- Test C : app tuée → iOS via push VoIP, Android via service redémarré.
- Test D : appel non répondu → messagerie seulement après 35 s.
- Rapport final `pp-inbound-diagnostic` sans écart pour tous les postes.

## Détails techniques

Fichiers concernés : `supabase/functions/pp-inbound-diagnostic`, `pp-sync-answering-rules`, `ns-webhook-receiver`, `pp-voip-push-token`, `_shared/planipret-ns.ts`, `src/lib/planipret/sip/ppSipProvider.ts` + miroir `apps/planipret-mobile/...`, `nativePpSipService.ts`, config native iOS/Android (`apply-native-config.mjs`, snippets manifest/Info.plist), table `planipret_did_assignments`.
