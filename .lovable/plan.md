## Objectif
Réduire drastiquement le temps de chargement de toutes les pages (admin, portail client, mobile Planiprêt, landing).

## Diagnostic actuel
- `src/App.tsx` charge probablement beaucoup de routes en synchrone → bundle initial gros.
- Les pages admin (PAOverview, PARecordings, PAAvaAgent, etc.) font plusieurs `supabase.functions.invoke` en série au mount.
- Pas de cache partagé côté web admin (contrairement au mobile qui a `useAutoSync` + `prefetch`).
- Pas de skeleton immédiat → l'écran reste blanc pendant le fetch.
- Vite `manualChunks` n'est configuré que sur mobile, pas sur l'app web principale.

## Plan d'optimisation

### 1. Code-splitting agressif (bundle initial)
- Convertir toutes les routes de `src/App.tsx` en `lazyWithRetry(() => import(...))` (déjà dispo dans `src/lib/lazyWithRetry.ts`).
- Wrapper `<Suspense>` global avec un skeleton neutre (utiliser `LoadingSkeleton` existant).
- Ajouter `manualChunks` dans `vite.config.ts` racine : vendor-react, vendor-supabase, vendor-radix, vendor-recharts, vendor-lucide, vendor-tanstack.

### 2. Cache + dédup des appels edge functions (web admin)
- Créer `src/lib/edgeCache.ts` : wrapper autour de `supabase.functions.invoke` avec TTL configurable, dédup in-flight, et `stale-while-revalidate` (inspiré de `ppContactsCache.ts` et `useAutoSync` mobile).
- Migrer les appels lourds répétés (`pp-admin-ava-elevenlabs`, `pp-ns-contacts`, `ava-agent-config`, stats overview) vers ce cache.

### 3. Parallélisation des fetch au mount
- Auditer les pages admin (`PAOverview`, `PARecordings`, `PAAvaAgent`, `PAContacts`, etc.) : remplacer les `await` séquentiels par `Promise.all`.
- Rendre le premier paint immédiat (skeleton) puis hydrater au fur et à mesure.

### 4. Prefetch inter-pages (navigation)
- Adapter le pattern `prefetchForTab` du mobile pour le web : au hover/focus d'un lien de la sidebar admin, précharger le chunk de la route + la première requête de données.

### 5. Skeletons systématiques
- Remplacer les écrans blancs par `StatCardSkeleton`, `TableSkeleton`, `ChartCardSkeleton` (déjà présents) sur toutes les pages qui font un fetch au mount.

### 6. Micro-optims
- `reportCompressedSize: false` + `chunkSizeWarningLimit: 800` dans vite web.
- Ajouter `<link rel="preconnect">` vers Supabase dans `index.html`.
- Lazy-import de `recharts` uniquement dans les composants qui l'utilisent.

## Détails techniques
- Aucune modif backend, aucune migration.
- Zéro changement fonctionnel — uniquement performance et UX de chargement.
- Compatible avec le comportement existant (auth, RLS, impersonation).

## Livrables
- `src/App.tsx` : routes lazy + Suspense global.
- `vite.config.ts` (racine) : manualChunks + flags perf.
- `src/lib/edgeCache.ts` (nouveau) : cache TTL + dédup.
- Pages admin critiques migrées vers le cache + Promise.all + skeletons.
- `index.html` : preconnect Supabase.

## Question rapide avant d'implémenter
Veux-tu que j'applique ces optimisations à **toutes les surfaces** (admin web + portail client + landing + mobile Planiprêt) ou seulement à l'**admin web** (là où tu passes le plus de temps) pour un premier lot rapide et mesurable ?
