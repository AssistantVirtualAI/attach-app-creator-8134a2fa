## Contexte

Corrections ciblées sur **`apps/planipret-mobile`** uniquement. Toutes les régressions signalées viennent de refactors récents du header et des flux d'auth/AVA.

## 1. Restaurer les contrôles du header (langue + thème)

Fichier : `apps/planipret-mobile/src/components/planipret/mobile/MobileHeaderControls.tsx`

La version actuelle n'affiche que Bell + Settings. Ajouter, à gauche de la cloche :
- Toggle **FR / EN** compact (pill 2 boutons) branché sur `useMplanipretLang()` — persiste dans `planipret_profiles.language` si `profile.user_id`.
- Toggle **thème clair / sombre** (icône `Sun` / `Moon`) qui bascule `document.documentElement.classList` + `localStorage.setItem("planipret_dark", …)`, aligné avec la logique existante dans `MMore.tsx`.

Conserver le layout : logo Planiprêt à gauche (déjà géré ailleurs), à droite dans l'ordre → Langue, Thème, Bell, Settings.

## 2. Restaurer la connexion Maestro dans Settings

Fichier : `apps/planipret-mobile/src/pages/planipret/mobile/MMore.tsx`

`<MaestroConnectCard />` est bien présent (l. 334) mais rendu à l'intérieur du `Section` "Intégrations" **après** la div de config détectée. Le composant a probablement une garde interne qui le masque. Vérifier `apps/planipret-mobile/src/components/planipret/mobile/MaestroConnectCard.tsx` :
- Retirer toute condition qui masque la carte si non-connectée.
- Toujours afficher au minimum : statut (`pending` / `connected` / `error`), bouton **"Connecter à Maestro"** ou **"Reconnecter"**, lien vers `/mplanipret/maestro-status`.

## 3. Corriger le sign-out

Fichier : `MMore.tsx` (fonction `logout`, l. 161-166)

`navigate("/login", …)` ne correspond à aucune route de l'app mobile → l'utilisateur retombe sur `/` (portail). Remplacer par :
- Après `supabase.auth.signOut()`, `navigate("/mplanipret", { replace: true })` puis `window.location.reload()` pour laisser `PlanipretMobile.tsx` détecter `accessError = "unauthenticated"` et afficher `MobileAuthScreen` (le vrai écran d'auth mobile).

## 4. Respecter la safe-area sur l'écran email

Fichier : `apps/planipret-mobile/src/pages/planipret/mobile/MMessages.tsx` (composant `EmailComposeSheet`, l. 1492+ et wrapper l. 1314)

Le portail plein écran a `paddingTop: env(safe-area-inset-top)` sur le conteneur racine, mais le header Outlook (l. 1581) applique **aussi** `paddingTop: calc(env(safe-area-inset-top) + 8px)` → double compensation OU header collé au notch selon la structure. Corriger :
- Retirer la duplication : garder la safe-area **uniquement** sur le header bleu Outlook.
- Le wrapper racine passe à `paddingTop: 0`.
- Idem pour la liste des emails ouverte (`MMessages` détail email) : envelopper dans `<MobileScreen>` (ou appliquer `env(safe-area-inset-top)` sur le header) pour ne plus rogner le notch iOS.

## 5. AVA chatbot : vraiment déclencher appels et SMS

Fichiers : `supabase/functions/ava-tool-executor/index.ts` + `apps/planipret-mobile/src/pages/planipret/mobile/MAvaChat.tsx`

Aujourd'hui AVA répond "envoyé" sans effet réel. Corriger :

**Backend** :
- `send_sms` doit invoquer directement `pp-ns-sms` (déjà nommé correctement) et **retourner l'erreur** si `success: false` au lieu d'annoncer succès.
- `make_call` (ou `place_call`) doit poster à `pp-ns-calls` avec `synchronous: yes` déjà en place, retourner `call_id` OU l'erreur exacte.
- Les tools `open_sms_composer` / `open_dialer` restent des tools "client-side" : le backend renvoie `client_action: { kind: "open_sms"|"open_dialer", payload }` dans la réponse.

**Frontend `MAvaChat.tsx`** :
- Après réception, si `data.client_action`, dispatcher un `CustomEvent("pp:ava-client-action", { detail })` capté par `PlanipretMobile.tsx` qui appelle `openDialer(n)` / navigue vers `/mplanipret/messages?to=X&text=Y`.
- Afficher un badge de résultat réel ("✅ SMS envoyé" / "❌ Échec : …") plutôt que le texte du LLM.

Aucune modification du prompt système : il attend déjà une confirmation écrite (mémoire actuelle).

## 6. Bouton "Rapport détaillé" sur Home (Claude)

Fichier : `apps/planipret-mobile/src/pages/planipret/mobile/MHome.tsx` + nouveau `supabase/functions/pp-ava-report/index.ts`

**UI** : dans MHome, sous le hero, ajouter une carte "Rapport de performance" avec 3 pills → **Aujourd'hui / Semaine / Mois**. Au tap : ouvre un bottom-sheet, appelle la fonction, streame/affiche le markdown formaté par Claude.

**Backend** : nouvelle edge function `pp-ava-report` :
- Input : `{ broker_id, range: "day"|"week"|"month" }`.
- Aggrège depuis Supabase : `planipret_phone_calls`, `planipret_sms_messages`, `planipret_email_messages`, `planipret_contacts`, `planipret_leads` sur la fenêtre.
- Envoie à Lovable AI Gateway avec `model: "anthropic/claude-sonnet-4-5"` (via `openai-compatible` + `LOVABLE_API_KEY`, cf. `ai-sdk-lovable-gateway` knowledge) — system prompt = "Tu es AVA, produit un rapport structuré (KPIs, tendances, recommandations) en français, format markdown".
- Retourne `{ report: string, generated_at }`. Enregistre dans `planipret_reports` (créer table si absente).

Pas de nouvelle dépendance NPM ; réutilise `supabase.functions.invoke("pp-ava-report", …)`.

## Détails techniques

- Tous les composants restent en dark-first ; le toggle thème réutilise la logique déjà en place dans `MMore` — pas de nouveau contexte.
- L'événement `pp:ava-client-action` sera écouté au niveau de `PlanipretMobile.tsx` (déjà racine avec accès à `openDialer` via `FabDialer` bus).
- `pp-ava-report` doit être ajouté à `supabase/config.toml` (`[functions.pp-ava-report] verify_jwt = true`) puis déployé.
- Aucune modif hors `apps/planipret-mobile` et `supabase/functions/` — respect strict de la mémoire `mplanipret-isolation-locked` et `landing-page-locked`.

## Livrables

1. Header enrichi (FR/EN + thème) sur toutes les pages mobiles.
2. Carte Maestro toujours visible dans Settings.
3. Sign-out → écran d'auth mobile natif.
4. Composer/lecteur d'email respectent la safe-area iOS.
5. AVA envoie réellement SMS/appels et rapporte le vrai statut.
6. Bouton "Rapport détaillé" Home → Claude → rapport Daily/Weekly/Monthly.
