# Plan — SSO Microsoft sur Auth + perfs

## 1. SSO Microsoft natif sur la page /auth

Objectif : un seul bouton « Continuer avec Microsoft » qui connecte l'utilisateur ET lie automatiquement son compte MS365 (Mail, Calendar, Teams) sans passer par un second flow OAuth manuel.

- Activer le provider **Azure** dans Lovable Cloud Auth (via `supabase--configure_social_auth` si dispo pour azure, sinon garder le flow OAuth managé existant).
- Ajouter dans `src/pages/Auth.tsx` et `apps/planipret-mobile/src/pages/...Auth` un bouton **« Continuer avec Microsoft 365 »** qui :
  1. Lance `supabase.auth.signInWithOAuth({ provider: 'azure', scopes: 'openid profile email offline_access Mail.Read Calendars.ReadWrite ChannelMessage.Send Chat.ReadWrite User.Read' })`.
  2. Au retour (callback), une nouvelle edge function `ms365-link-from-auth` récupère le `provider_token` + `provider_refresh_token` de la session Supabase et les persiste dans `planipret_integration_secrets` pour l'utilisateur/org courant → l'intégration MS365 est marquée connectée immédiatement.
  3. Hook côté client dans `useAuth` : après login, si `session.provider_token` et provider = azure, appeler l'edge function une seule fois.
- Fallback : garder le flux `connectMs365()` existant pour les comptes créés en email/password qui veulent lier MS365 après coup.
- Mettre à jour `Ms365StatusBadge` pour refléter l'état lié via SSO.

## 2. Accélération de la page /auth

Causes actuelles probables (à confirmer à l'implémentation) : bundle Auth chargé avec tout App.tsx, polices bloquantes, `initSentry`/`perfMetrics`/`buildVersionPoller` exécutés avant mount, `consumeAppLoginToken` bloque le render.

- **Lazy-load** la page Auth via `React.lazy` + `Suspense` avec un skeleton léger (déjà partiel — vérifier `App.tsx`).
- **Rendre React avant** `consumeAppLoginToken()` : lancer le token consume en tâche de fond après mount, montrer un skeleton si un token est présent.
- Décaler `initSentry`, `initPerfMetrics`, `scheduleIdlePrefetch`, `buildVersionPoller`, `reloadDiagnostics`, `styleHealthGuard`, `devPreviewGuard` dans un `requestIdleCallback` (fallback `setTimeout(…, 0)`) après le premier paint.
- Précharger uniquement les polices **critiques** (Urbanist 600 + Epilogue 400), `font-display: swap`, retirer les poids non utilisés au-dessus du fold sur /auth.
- Supprimer l'import synchrone des icônes lucide non utilisées sur Auth (tree-shake déjà en place, vérifier).
- Ajouter `<link rel="preconnect">` vers Supabase + CDN polices dans `index.html`.

## 3. Accélération globale (autres pages)

- **Route-level code splitting** : auditer `src/App.tsx` et `apps/planipret-mobile/src/App.tsx` — convertir tous les `import Page from …` restants en `lazy(() => import(…))`. Grouper les pages admin lourdes dans un chunk séparé via `/* webpackChunkName */` (Vite : `/* @vite-ignore */` + `manualChunks`).
- **`manualChunks`** dans `vite.config.ts` : séparer `react`, `@radix-ui`, `recharts`, `@supabase`, `lucide-react` en vendor chunks pour caching long-terme.
- **Prefetch intelligent** : étendre `scheduleIdlePrefetch` à la première page probable après login (Mobile home, Admin overview) — déjà en place, à vérifier pour /auth → next route.
- **Requêtes réseau au boot** : batcher les appels initiaux (org, roles, integrations) en un seul edge function `bootstrap-session` renvoyant tout en 1 round-trip; utiliser `react-query` `staleTime` long + `placeholderData`.
- Ajouter `<link rel="modulepreload">` pour le chunk du dashboard après authentification.
- Activer la compression Brotli/HTTP2 push si pas déjà fait côté hosting (Lovable gère normalement).
- Skeletons dédiés (au lieu de spinners plein écran) sur : Auth, MHome, MContacts, MMessages, Admin Overview.

## Détails techniques

### Fichiers créés
- `supabase/functions/ms365-link-from-auth/index.ts` — persiste provider_token/refresh_token Azure du SSO dans `planipret_integration_secrets`.
- `src/lib/bootstrap.ts` — orchestrateur d'appels initiaux non-bloquants.

### Fichiers modifiés
- `src/pages/Auth.tsx` + variante mobile : bouton MS365 SSO en tête, layout skeleton.
- `src/hooks/useAuth.tsx` + `apps/planipret-mobile/src/hooks/useAuth.tsx` : ajouter `signInWithMicrosoft365SSO()` avec les scopes Graph, et hook post-login qui appelle `ms365-link-from-auth`.
- `src/main.tsx` : rendre React d'abord, différer `consumeAppLoginToken`, `initSentry`, `initPerfMetrics`, `scheduleIdlePrefetch` via `requestIdleCallback`.
- `src/App.tsx` + `apps/planipret-mobile/src/App.tsx` : `lazy()` sur toutes les routes non-critiques.
- `vite.config.ts` (racine + planipret-mobile) : `build.rollupOptions.output.manualChunks` pour split vendor.
- `index.html` : `preconnect` Supabase, `font-display: swap`, preload chunk Auth.
- `src/components/planipret/Ms365StatusBadge.tsx` : refléter statut « lié via SSO ».

### Hors scope
- Refonte visuelle de la page Auth.
- Migration du provider Google.
- Changement du modèle RLS.

## Action requise après merge
Reconnecte-toi via « Continuer avec Microsoft 365 » sur /auth pour que le SSO lie automatiquement Mail/Calendar/Teams.
