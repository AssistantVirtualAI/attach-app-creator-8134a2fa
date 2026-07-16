## Pourquoi Android reste en idle alors qu’iOS fonctionne

Le code actuel n’utilise pas le même chemin SIP selon la plateforme:

- iOS utilise le SIP natif PJSIP et peut s’enregistrer correctement.
- Android est censé utiliser JsSIP via WSS dans la WebView.
- L’écran SIP Debug Android lit actuellement le mauvais champ (`sp.sipStatus` au lieu de `sp.snap.status`), donc il peut afficher `idle` même si le hook a un autre état.
- Android force aussi des endpoints WSS hardcodés au lieu de prioriser l’URL WSS retournée par les credentials backend.
- Il y a une contradiction dans le projet: Android contient maintenant un plugin natif PJSIP, mais le JS le désactive pour Android et démarre JsSIP. Il faut verrouiller une seule stratégie Android.

## Plan de correction

### 1. Corriger l’état affiché dans l’app
- Corriger `SipDebugScreen` pour lire `sp.snap.status`.
- Corriger la ligne `SIP Debug` dans `MoreScreen` pour lire `sp.snap.status`.
- Corriger l’affichage de la dernière erreur pour utiliser `lastPersistedError.error`.
- Ajouter un affichage clair: provider utilisé, plateforme, WSS actif, extension, domaine, dernière raison d’échec.

### 2. Verrouiller Android sur une seule stratégie SIP
- Garder Android sur JsSIP/WSS, puisque la demande concerne le Via header WSS.
- Limiter PJSIP natif à iOS seulement dans le dispatcher JS.
- Empêcher tout appel Android accidentel au plugin natif PJSIP depuis les flows SIP.

### 3. Corriger la config REGISTER Android
- Confirmer explicitement `hack_via_tcp = false` sur Android.
- Garder `hack_wss_in_transport = true`.
- Ajuster le `contact_uri` Android pour ne plus annoncer `transport=ws` si le transport réel est WSS.
- Ajouter un garde/log qui confirme au démarrage: `Android JsSIP provider`, `transport=WSS`, `hack_via_tcp=false`.

### 4. Utiliser les vrais endpoints WSS des credentials
- Prioriser `creds.wssUrl` et `creds.wssUrls` retournés par le backend.
- Garder `wss://pbxnode.lemtel.tel:7443` et `wss://node.lemtelcloud.net:7443` seulement comme fallbacks.
- Logger quel endpoint est tenté et quel endpoint réussit.

### 5. Éliminer le faux idle causé par credentials/hydration
- Si `extension` ou `sipPassword` manque, afficher/logguer `config.missing` au lieu de rester silencieusement en idle.
- Après hydration des credentials, forcer un reconnect SIP propre.
- Ajouter un état visible “credentials loading / missing SIP password” dans le debug screen.

### 6. Renforcer reconnexion Android
- Sur `appStateChange`, `visibilitychange`, `online`, et changement Wi-Fi/LTE: relancer REGISTER uniquement si l’état n’est pas `registered`.
- Éviter les doubles reconnects concurrents.
- Garder le watchdog REGISTER: si aucun `registered`/`registrationFailed` n’arrive, passer en `error` avec raison claire, jamais rester en idle.

### 7. Ajouter tests ciblés Android
- Test Android: `createSIPUA` ne met jamais `hack_via_tcp`.
- Test Android: WSS credentials backend sont prioritaires sur les fallbacks hardcodés.
- Test UI: SIP Debug affiche `sp.snap.status`.
- Test hook: quand `sipConfig` passe de `null` à valide après hydration, l’enregistrement démarre.

### 8. Validation finale sur appareil Android
- Ouvrir SIP Debug.
- Vérifier la séquence attendue:

```text
idle/config-loading → connecting → ws.connected → register.ok → registered
```

- Si échec, l’écran doit montrer une raison précise: WSS unreachable, auth failed, timeout, SSL, DNS, etc.
- Comparer côté PBX que le REGISTER Android arrive bien via WSS/7443 et non TCP/5060.