# Correctifs log Xcode — Planiprêt Mobile (01 août 2026)

## Note importante sur le P1 du rapport

Le rapport demande de forcer `wss://voice.ava-telecom.ca:9002`. **C'est l'inverse de la règle opérateur en vigueur.** `voice.ava-telecom.ca` résout vers `portal1.cluster1.ucstack.io` : le REGISTER y est accepté mais n'est pas utilisé pour livrer les appels entrants → boîte vocale directe. L'opérateur a exigé l'enregistrement sur `core1`/`core2`. Le comportement observé (`core1.cluster1.ucstack.io:9002`) est donc **correct et voulu** — `sipEdgePolicy.ts` fonctionne comme prévu.

Le P1 ne sera donc pas appliqué tel quel. Ce qui reste vrai, c'est le symptôme du P2 (échec de la 1re socket, fermeture 1001, ~5 s perdues au démarrage) : on le traite comme un problème de robustesse de connexion, pas de changement de serveur.

## Ce qui sera corrigé

### 1. Démarrage SIP plus rapide (P2)
- `PpSipKeepAlive.swift` : ne pas envoyer le REGISTER tant que la socket n'a pas confirmé son ouverture (attendre l'état `open` au lieu d'envoyer immédiatement) — supprime `REGISTER send failed: Socket is not connected`.
- Premier retry ramené à ~1 s (au lieu de 5 s) uniquement pour la toute première tentative après lancement; le backoff 5 s → 60 s reste inchangé ensuite.
- Bascule automatique sur `core2` si `core1` échoue deux fois d'affilée au démarrage (les deux sont des nœuds de traitement d'appels valides).

### 2. Debounce du moniteur réseau (P3 du rapport)
- Dans `startPathMonitor()`, ignorer toute mise à jour survenant moins de 2 s après la précédente, et ne logger/agir que sur un vrai changement d'état (`up != wasUp`). Supprime les ~30 « network available » consécutifs.

### 3. `pp-ava-e2e-check` (P4)
- La fonction existe dans le dépôt mais son blob n'est pas déployé (404 `NOT_FOUND_FUNCTION_BLOB`). Redéploiement de la fonction, puis vérification par un appel réel.

### 4. Exception JS avant `bootstrap:start` (P5)
- Ajout d'un `window.onerror` très tôt dans `index.html` qui logge message + source + ligne dans la console native, afin d'identifier le script fautif au prochain lancement (l'exception est non fatale aujourd'hui).
- Nettoyage des références résiduelles `window.__PP_*` si elles apparaissent comme cause.

### 5. APNs sandbox (P6)
- Aucun changement de code : c'est le comportement normal d'un build Debug lancé depuis Xcode. À revalider via un build Archive/TestFlight, où `environment` passera à `production`. Sera documenté dans la checklist de release.

## Détails techniques

Fichiers touchés :
- `apps/planipret-mobile/ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift`
- `apps/planipret-mobile/scripts/apply-native-config.mjs` (si le plugin y est régénéré)
- `apps/planipret-mobile/index.html`
- `supabase/functions/pp-ava-e2e-check` (redéploiement)

Après application, un `npm run build && npx cap sync ios` est nécessaire côté Mac pour que le code natif prenne effet.
