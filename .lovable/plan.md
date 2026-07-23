## 4 fixes pour l'app mobile Planiprêt

### 1. Header : un seul logo Planiprêt + 1 bell + 1 settings
Actuellement `MobileHeaderControls` rend Bell + Settings + Lang + Theme + Profil (MH), en plus du bloc gauche Planiprêt+REST dans `PlanipretMobile.tsx`. La capture montre en plus une barre AVA (logo AVA + REST + settings + bell) — c'est une deuxième instance héritée de l'ancien header brand.

Correction :
- Dans `PlanipretMobile.tsx` (l. 943–969) garder **uniquement** : logo Planiprêt (56×56, à gauche, en grand) + un point live/REST, et à droite **une seule** cloche (notifications) + **un seul** engrenage (settings/more). Lang, Theme et avatar MH déplacés dans la page More (déjà accessible via l'engrenage).
- Dans `MobileHeaderControls.tsx` : supprimer les boutons Lang, Theme, avatar Profil (et le `MobileProfileSheet`) pour ne laisser que Bell + Settings. Retirer aussi l'éventuel logo/statut AVA si présent ailleurs (grep confirmera qu'il n'y a pas un second header monté par un layout parent).

### 2. FabDialer : masquer partout sauf Home et Calls
Aujourd'hui `FabDialer` n'est caché que sur `/messages` et `/ava`. Il cache le bouton d'envoi sur d'autres pages (contacts, more, pipeline, etc.).

Correction dans `PlanipretMobile.tsx` (l. 522) : remplacer le test `isChatSurface` par une allow‑list — n'afficher le FAB que si `pathname` correspond à `/mplanipret` (home) ou `/mplanipret/calls`. Sur toutes les autres routes → `return null`.

### 3. Microsoft SSO : erreur « Code verifier PKCE introuvable » (image 270)
Le flux ouvre Microsoft dans Safari/Browser Capacitor, revient via deep link, mais le `code_verifier` stocké au démarrage n'est pas retrouvé au callback. Causes possibles :
- Sur iOS, `openMs365Authorize` stocke le verifier via `localStorage` alors que le callback lit via `@capacitor/preferences` (ou l'inverse) → pas la même clé/storage entre les deux contextes (SFSafariViewController vs WKWebView).
- Le `state` passé à Microsoft ne correspond pas à la clé utilisée pour retrouver le verifier.
- Le retour arrive dans un **nouvel onglet Safari** (image 267 : `dev.planipret.com` ouvert dans Safari externe au lieu de l'app), donc aucun storage partagé.

Correction :
- Auditer `ms365OAuth.ts` (`openMs365Authorize`, `getRememberedMs365CodeVerifier`) et harmoniser sur `@capacitor/preferences` **des deux côtés**, avec la clé dérivée du `state`.
- Persister aussi le verifier côté serveur (table `pp_ms365_oauth_states` déjà utilisée pour Maestro) et le récupérer dans `pp-ms-auth-callback` en fallback si le storage local est vide → règle définitivement le cas « app relancée depuis un lien Universal ».
- Vérifier que `capacitor.config.ts` a bien `com.planipret.mobile://…` en scheme ET l'Universal Link `dev.planipret.com/auth/microsoft/callback` déclaré dans `apple-app-site-association`, sinon iOS ouvre le retour dans Safari externe (image 267).

### 4. Maestro : connexion toujours KO
Même famille de problèmes que MS365 :
- Vérifier que `maestro-oauth-start` renvoie bien une URL HTTPS absolue valide (le message Safari « l'adresse n'est pas valide » indique une URL vide/mal formée retournée par l'edge function).
- Vérifier le `redirect_uri` envoyé : doit être `https://dev.planipret.com/auth/maestro/callback` (Universal Link) **et** enregistré côté Maestro. Le scheme `planipret://` fonctionne uniquement si l'app est installée avec les entitlements — sur Safari web ça produit l'alerte de l'image 267.
- `MaestroCallback.tsx` : ajouter le même fallback serveur (récupération verifier via table `planipret_maestro_oauth_states`) et loguer précisément la cause d'échec dans `PAMaestroStatus`.

### Détails techniques
- Fichiers : `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx`, `apps/planipret-mobile/src/components/planipret/mobile/MobileHeaderControls.tsx`, `apps/planipret-mobile/src/lib/ms365OAuth.ts`, `apps/planipret-mobile/src/lib/ms365AuthLogin.ts`, `apps/planipret-mobile/src/pages/planipret/Ms365Callback.tsx`, `supabase/functions/pp-ms-auth-start`, `supabase/functions/pp-ms-auth-callback`, `supabase/functions/maestro-oauth-start`, `supabase/functions/maestro-oauth-callback`, `apple-app-site-association`, `capacitor.config.ts`.
- Aucune modif à `/mplanipret` routing, `MplanipretGuard`, `OrganizationContext` (verrous respectés).

Confirmer et je passe en build.