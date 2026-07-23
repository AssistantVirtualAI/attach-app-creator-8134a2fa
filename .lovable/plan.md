## Objectif

Re-vérifier que les 6 livrables du tour précédent sont bel et bien en place, fonctionnels, et que toutes les intégrations (Maestro, Microsoft 365, AVA tools, Claude report) sont connectées.

## Étapes de vérification

### 1. Header mobile (FR/EN + thème)
- Lire `apps/planipret-mobile/src/components/planipret/mobile/MobileHeaderControls.tsx`
- Confirmer présence : logo Planiprêt, toggle FR/EN (via `useMplanipretLang`), toggle thème (Sun/Moon + `localStorage planipret_dark`), Bell, Settings
- Vérifier ordre visuel et absence de doublons

### 2. Settings — carte Maestro visible
- Lire `apps/planipret-mobile/src/pages/planipret/mobile/MMore.tsx` (section Intégrations)
- Confirmer `<MaestroConnectCard />` rendu inconditionnellement
- Vérifier `MaestroConnectCard.tsx` — pas de garde masquant la carte
- Vérifier bouton "Se connecter à Maestro" présent

### 3. Sign-out
- Vérifier `logout()` dans `MMore.tsx` : `supabase.auth.signOut()` → `navigate("/mplanipret", { replace: true })` + `window.location.reload()`
- Confirmer que `PlanipretMobile.tsx` bascule sur `MobileAuthScreen` quand `accessError = "unauthenticated"`

### 4. Safe-area emails (iOS)
- Lire `MMessages.tsx` — `EmailComposeSheet` et détail email
- Confirmer safe-area appliquée uniquement sur le header Outlook (pas de double padding)

### 5. AVA chatbot — SMS/appels réels
- Lire `supabase/functions/ava-tool-executor/index.ts`
  - `send_sms` → invoque `pp-ns-sms`, retourne erreur si `success:false`
  - `make_call` → invoque `pp-ns-calls` avec `synchronous:yes`, retourne `call_id` ou erreur
  - `open_sms_composer` / `open_dialer` → renvoient `client_action`
- Lire `MAvaChat.tsx` : dispatch `pp:ava-client-action` sur réception + badge résultat réel
- Lire `PlanipretMobile.tsx` : listener de l'événement → `openDialer` / navigation
- Tester via `supabase--curl_edge_functions` un appel `send_sms` factice pour valider le retour d'erreur

### 6. Rapport de performance (Claude)
- Lire `apps/planipret-mobile/src/components/planipret/mobile/PerformanceReportCard.tsx`
- Lire `MHome.tsx` — carte présente avec 3 pills Jour/Semaine/Mois
- Lire `supabase/functions/pp-ava-report/index.ts` — utilise Lovable AI Gateway avec `anthropic/claude-sonnet-4-5`, agrège les tables Planiprêt
- Vérifier `supabase/config.toml` : `[functions.pp-ava-report] verify_jwt = true`
- Tester déploiement via `supabase--edge_function_logs` ou `curl` avec payload minimal

### 7. Intégrations connectées (backend)
- Vérifier secrets présents : `LOVABLE_API_KEY`, `planipret_integration_secrets` (Maestro machine token)
- Lister edge functions déployées : `maestro-oauth-*`, `pp-ns-sms`, `pp-ns-calls`, `pp-ms-auth-*`, `pp-maestro-telecom`, `pp-ava-report`, `ava-tool-executor`
- Vérifier logs récents sans erreurs 500

## Livrable

Un rapport concis par point (✅ / ⚠️ + détail), avec les correctifs immédiats si régression détectée.
