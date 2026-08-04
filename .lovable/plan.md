# Appels iOS — analyse du log et correctifs définitifs

## Ce que le log prouve (05:23 → 05:26)

Bonne nouvelle : la pile native fonctionne réellement dans ce log.

- REGISTER TLS 5061 vers `core1.cluster1.ucstack.io` → **200 OK**, Contact `sip:113M@99.217.176.66:64352;transport=TLS`.
- Appel **entrant** : `INVITE` reçu sur PJSIP TLS (ligne 1326) → `100` → `180 Ringing` → CallKit → `200 OK` → `ACK` → `CONFIRMED` → média PCMU bidirectionnel. **Ça marche.**
- Appel **sortant** : `INVITE` → `407` → ré-INVITE authentifié → `180` → `200 OK` → média → `BYE` + `200 OK`. **Ça marche aussi.**

Donc le problème n'est plus « ça ne sonne pas ». Ce sont 4 défauts identifiés qui cassent l'expérience et re-cassent la pile après coup.

## Défaut 1 — Le double écran d'appel sur les sortants

Au tout premier événement de l'appel sortant, le log montre :

```text
TO JS {"callId":"1","remoteNumber":"5144942888","state":"ringing","direction":"in"}
[PpPjsip] outgoing INVITE → sip:5144942888@planipret.ca callId=1
```

La direction annoncée est `in` sur un appel **sortant**. Cause : dans `PpPjsipEngine.swift`, le callback d'état `CALLING` est déclenché par PJSIP **avant** que `outgoingCall = newCall` soit affecté au retour de `pjsua_call_make_call`. Le JS reçoit donc un « appel entrant qui sonne » et ouvre l'UI d'appel entrant par-dessus l'UI d'appel sortant.

Correctif : marquer l'appel comme sortant **avant** l'INVITE (pré-réservation d'un drapeau « sortie en cours » consommé par le premier callback), et n'émettre l'événement `callState` qu'après avoir résolu la direction.

## Défaut 2 — Le keep-alive WSS re-REGISTER la même AOR pendant que PJSIP la tient

Fin de log :

```text
[PpSipKeepAlive] startSipService skipped — PJSIP owns the AOR
[PpSipKeepAlive] ws open
TO JS {"reason":"native_register_200","status":"registered"}
[PpSipKeepAlive] socket closed: ... Code=57 → reconnect in 5s
```

Le garde `nativeEngineOwnsAor` n'existe que dans `startSipService` et le réveil push. Le chemin `scheduleReconnect` → `connect` → `sendRegister` n'est pas gardé : une fois la socket ouverte, le keep-alive continue de REGISTER `113M` en WSS 9002 en boucle, en concurrence avec la registration TLS de PJSIP. NetSapiens ne garde qu'un binding utile par AOR : c'est exactement le scénario qui envoie les entrants suivants en messagerie.

Correctif : garder `nativeEngineOwnsAor` dans `connect()`, `scheduleReconnect()` et `sendRegister()` — si le natif possède l'AOR, la socket WSS est fermée et aucun REGISTER n'est envoyé, sans boucle de reconnexion.

## Défaut 3 — La sonde de diagnostic condamne PJSIP à tort

```text
[PpPjsip] REGISTER response acc=1 code=403 reason=Forbidden   (AOR 113MPROBE)
[PpPjsipProbe] result {"ok":false,"code":403}
Preferences set → [AOR] propriétaire = JsSIP — pp_pjsip_enabled=false
[AOR] transport device remis en WSS
```

La sonde s'enregistre avec une AOR fictive `113MPROBE` qui n'existe pas côté NetSapiens : un `403 Forbidden` est la réponse **normale et attendue**, pas une panne. Ce verdict « échec » pousse à couper l'interrupteur `pp_pjsip_enabled`, ce qui rend l'AOR à JsSIP et rebascule le device NetSapiens en WSS — la pile fonctionnelle est désactivée par un faux négatif.

Correctifs :
- La sonde utilise l'AOR réelle `<ext>M` en mode « registration test » court (expires bas) au lieu d'une AOR fictive, et n'est autorisée que si PJSIP ne tient pas déjà la registration ; sinon elle renvoie directement l'état de la registration native en cours.
- Un `403` sur AOR de test n'est plus présenté comme une panne du moteur : le verdict distingue « moteur lié + transport TLS OK » de « identifiants refusés ».
- L'interrupteur `pp_pjsip_enabled` ne peut plus être basculé à `false` tant qu'une registration native est active : demande de confirmation explicite, et sortie de secours documentée.

## Défaut 4 — Vagues de REGISTER au démarrage

Entre 05:23:10 et 05:23:22, le log contient 3 déclenchements de « reprovision TLS immédiat » et 4 REGISTER avec `Expires: 0` (désenregistrement) suivis de ré-enregistrements. Chaque fenêtre `Expires: 0` laisse l'extension sans binding : un appel arrivant à cet instant part en messagerie.

Correctif : le re-provisioning déclenché par le 200 OK du REGISTER natif devient idempotent — une seule exécution par session tant que le contact observé n'a pas changé (garde de déduplication sur `contact + transport`), et pas de réémission sur les renouvellements de registration.

## Nettoyages associés (bruit constaté dans le log)

- `Capacitor plugin "PpPjsip" already registered` (3 occurrences) : le plugin est enregistré via `registerPlugin` à plusieurs endroits du bundle. Centralisation dans un module unique exporté.
- `JS Eval error A JavaScript exception occurred` au boot, juste avant le premier paint : sérialisation de l'erreur pour qu'elle soit lisible dans le log au lieu d'un objet vide.

## Détails techniques

Fichiers touchés :

- `apps/planipret-mobile/ios/App/App/Plugins/PpPjsip/PpPjsipEngine.swift` — direction sortante déterministe.
- `apps/planipret-mobile/ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift` — garde AOR sur connect/reconnect/register.
- `apps/planipret-mobile/scripts/apply-native-config.mjs` — mêmes correctifs dans les templates natifs pour survivre à `cap sync`.
- `apps/planipret-mobile/src/lib/native/PpPjsipProbe.ts` — sonde non destructive.
- `apps/planipret-mobile/src/pages/planipret/mobile/MSipDebug.tsx` — interrupteur protégé, verdict de sonde clarifié.
- `apps/planipret-mobile/src/lib/planipret/sip/nativeSipService.ts` — re-provisioning idempotent, enregistrement unique du plugin.

Après application : `git pull && npm run ios:oneclick`, Clean Build Folder, puis test sur iPhone réel. Les preuves à vérifier dans le log : un seul `reprovision TLS` par session, aucun `[PpSipKeepAlive] ws open` tant que PJSIP possède l'AOR, et `direction":"out"` dès le premier événement d'un appel sortant.
