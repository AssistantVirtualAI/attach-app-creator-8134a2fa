## Contexte

Les appels entrants tombent en boîte vocale car, à certains moments, **aucun contact SIP n'est enregistré** sur le PBX. Deux causes cumulables :

1. **Gap d'enregistrement au passage en arrière-plan** — la WebView se désenregistre avant que le service natif ait confirmé un REGISTER 200 OK.
2. **Contact/Via natifs en `.invalid`** — NetSapiens peut rejeter ou ignorer ces AOR non routables.

Bonus lié : les devices créés à la volée (self-heal) n'étaient pas ajoutés à la règle de sonnerie.

## Étape 1 — Handoff sans trou d'enregistrement (déjà appliqué)

Fichiers : `src/hooks/useMplanipretSoftphone.ts` + copie `apps/planipret-mobile/...`

- `handoffToNative()` démarre le service natif puis **attend une confirmation réelle** (`status = registered` ou `protected`) via `getPlanipretSipKeepAliveStatus()`, sondage 1 s pendant 12 s.
- La WebView n'appelle `releaseForBackground()` **que si** la confirmation arrive.
- 3 tentatives avec backoff (2 s, 4 s, 6 s) ; annulation propre si un nouveau handoff démarre (`handoffSeq`).
- Si aucun 200 OK natif : `forceReregister()` — la WebView garde l'enregistrement plutôt que de laisser l'extension nue.

```text
background → start natif → poll status (12s)
  ├─ registered/protected → release WebView   (1 AOR actif en continu)
  └─ timeout/error → retry x3 → fallback WebView registered
```

## Étape 2 — Domaine SIP réel côté natif (déjà appliqué)

Fichier : `apps/planipret-mobile/scripts/apply-native-config.mjs`

- Android : `Contact: <sip:{login}@{domain};transport=wss>` (avant : `@android-xxx.planipret.invalid`).
- Android : `Via: SIP/2.0/WSS {domain}` (avant : `planipret-mobile.invalid`).
- iOS (même classe de bug) : `stableContactHost()` retourne le domaine réel, et les `Via` REGISTER/OPTIONS utilisent `{domain}`.

## Étape 3 — Règle de sonnerie resynchronisée après self-heal (déjà appliqué)

- `ns-resolve-sip-credentials` : après création self-heal d'un device, appel fire-and-forget de `pp-sync-answering-rules` avec `broker_id`, encapsulé dans `EdgeRuntime.waitUntil` (n'allonge pas la résolution des credentials).
- `pp-sync-answering-rules` : nouveau chemin d'auth interne (`x-internal-call: 1` + service role), l'accès admin normal reste inchangé.

## Étape 4 — Validation (à faire côté device)

1. `npm run build` dans `apps/planipret-mobile` → régénère les sources natives + `verify-sip-bundle.mjs`.
2. Xcode / Android Studio : vérifier dans les logs que le REGISTER natif contient le domaine réel (aucun `.invalid`).
3. Portail NetSapiens : après mise en arrière-plan, l'AOR `<ext>_mobile` doit rester **Registered** en continu (aucune fenêtre à 0 device).
4. Appel entrant app fermée → doit sonner avant le timeout `forward-no-answer`.
5. Nouveau broker jamais provisionné → vérifier que la règle de sonnerie est créée automatiquement au premier login.

## Détails techniques

- Aucun changement de schéma DB ni de politique RLS.
- Fonctions à redéployer : `ns-resolve-sip-credentials`, `pp-sync-answering-rules`.
- `verify-sip-bundle.mjs` continue de bloquer les régressions (Contact aléatoire, re-REGISTER sur INVITE, OPTIONS trop rapide).
- Typecheck du projet : OK.

## Reste à surveiller (causes 3 et 4 de l'investigation)

- Latence PushKit iOS au démarrage à froid vs `forward-no-answer` : à mesurer une fois #1/#2 confirmés stables.
- Devices WSS/WebRTC activés dans le portail NetSapiens (vérification manuelle).
