# Plan — Fix « Ringing + Offline » et bouton End Call qui reste en ringing

## Diagnostic

Deux bugs distincts se cumulent :

### A. Statut « Offline / Idle » alors qu'un appel sonne
- La pastille de statut (`MMore.tsx`) est calculée uniquement à partir de `profile.ns_jwt` (présence d'un JWT NS-API). Elle n'inspecte **jamais** l'état réel de l'enregistrement SIP (`ppSipProvider` → `snap.status`).
- Résultat : la registration SIP peut être `disconnected` / `unregistered` sans que l'UI le signale, tandis qu'une ligne `planipret_phone_calls.status='ringing'` remontée par la webhook fait apparaître l'overlay « Ringing ».
- Aucune reconnexion « best-effort » n'est déclenchée quand la registration tombe > quelques secondes.

### B. Le bouton End Call ne coupe pas l'overlay
- `PlanipretMobile.hangupActive()` appelle `softphone.hangup()` + edge `pp-ns-calls disconnect` mais **ne met pas à jour** `planipret_phone_calls.status` en local.
- L'overlay se ferme uniquement quand un `postgres_changes` amène la ligne vers `completed/ended/cancelled/failed/no_answer`. Si l'edge répond OK sans mettre à jour la ligne (fréquent quand NS ferme l'appel côté trunk asynchronement), la ligne reste `ringing` et **`refreshActive` re-sélectionne la même ligne** → l'overlay se rouvre.
- `ActiveCallOverlay.hangup()` fait bien un `onClosed()` optimiste, mais le parent réattache aussitôt le call à cause de la subscription realtime.

## Correctifs

### 1. Pastille de connexion = état SIP réel
- Dans `MMore.tsx` et le header mobile : brancher la pastille sur `ppSipProvider.snap.status` via `useMplanipretSoftphone()`. `nsConnected = jwtOk && (snap.status === 'registered' || snap.status === 'connected')`.
- Ajouter 3 états visuels : `Connecté` (registered), `Connexion…` (connecting/disconnected < 5s), `Hors ligne` (error/disconnected > 5s).

### 2. Auto-recovery SIP agressive
- Ajouter dans `useMplanipretSoftphone` un watchdog : si `snap.status ∈ {disconnected, error}` pendant > 10 s, forcer :
  1. `ppSipProvider.forceReregister()`
  2. Si toujours KO après 20 s → re-`invoke("ns-resolve-sip-credentials")` + `ppSipProvider.init(...)` (déjà supporté via l'event `pp:sip-force-reregister`).
- Sur reprise (visibilitychange visible / online / focus) : forcer un `register()` immédiat.

### 3. End Call fiable + anti-rebond de l'overlay
- `PlanipretMobile.hangupActive()` :
  1. `softphone.hangup()`
  2. Marquer localement `endedCallIds.add(activeCallId)` (ref) et faire `setActiveCallId(null)` immédiatement.
  3. `UPDATE planipret_phone_calls SET status='ended', ended_at=now() WHERE id=activeCallId` (via RPC ou direct update — même id est déjà scopé par RLS user).
  4. Appeler `pp-ns-calls disconnect` en arrière-plan (best-effort).
- `refreshActive()` : ignorer toute ligne dont l'id appartient à `endedCallIds` **pendant 30 s** ; ignorer aussi les lignes `ringing` de plus de 2 minutes (stales orphelines).
- `ActiveCallOverlay` : mêmes garde-fous locaux (bouton hangup pose un flag qui masque immédiatement l'overlay quoi qu'il arrive dans la subscription realtime).

### 4. Nettoyage cohérent après hangup
- Assurer que `endSession()` (déjà présent dans le hook) écrit bien `state='ended'` dans `planipret_call_sessions` **et** que la ligne `planipret_phone_calls` est bien terminée : ajouter dans l'edge `pp-ns-calls` (action `disconnect`) un `UPDATE planipret_phone_calls SET status='ended'` si NS renvoie OK.

## Détails techniques

### Fichiers modifiés
- `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` — watchdog SIP + expose `sipConnected`.
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx` — `hangupActive` optimiste, ref `endedCallIds`, filtre stale.
- `apps/planipret-mobile/src/components/planipret/mobile/ActiveCallOverlay.tsx` — `dismissed` local + verrou anti re-mount.
- `apps/planipret-mobile/src/pages/planipret/mobile/MMore.tsx` — pastille basée sur snap.status.
- `apps/planipret-mobile/src/lib/planipret/sip/ppSipProvider.ts` — expose `ensureRegistered()` déclencheur (déjà via `forceReregister`).
- `supabase/functions/pp-ns-calls/index.ts` — sur action `disconnect` réussie, `UPDATE planipret_phone_calls status='ended', ended_at=now()`.

### Hors scope
- Refonte du provider SIP.
- Changement des schémas DB (uniquement des UPDATE existants).
- UI/UX de l'overlay au-delà du fix de fermeture.

## Résultat attendu
- La pastille reflète en temps réel la registration SIP (plus jamais « Offline » pendant qu'un appel sonne).
- Une registration perdue est reprise seule en < 20 s.
- Appuyer sur End Call ferme l'overlay immédiatement et de manière définitive, même si l'edge NS répond lentement ou si la ligne DB n'est pas mise à jour côté webhook.
