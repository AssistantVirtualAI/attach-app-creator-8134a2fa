## Objectif
Garantir qu'en basculant FR/EN, **100 %** des textes changent — écran par écran — et que le **brief AVA** et le **chatbot AVA** répondent dans la langue choisie.

## Constat vérifié
- Les pages mobiles utilisent déjà `useMplanipretLang().t(...)`, mais l'usage est très inégal : `MConnections` (4 clés), `MExtensionSync` (2), `MMs365Diagnostics` (5), `MMaestroSync` (7), `MSipDebug` (10) → quasi tout est encore en dur, alors que `MMessages` (185) ou `MCalls` (119) sont largement traduits.
- `pp-ava-brief` : prompt figé « Génère un brief court, professionnel, **en français du Québec** » — aucun paramètre de langue.
- `pp-ava-chat` : prompts système figés « Réponds **en français** », et appel interne à `pp-ava-report` avec `language: "fr"` codé en dur.

## Plan

### 1. Audit page par page (mobile Planiprêt)
Passer chaque écran et extraire tout littéral visible vers le dictionnaire :
MHome, MCalls, MMessages, MContacts, MVoicemail, MStats, MPipeline, MSearch, MAvaChat, MAvaNotifications, MMore, MConnections, MMaestroSync, MMs365Diagnostics, MExtensionSync, MSipDebug, MDeepLinkDebug + composants partagés (header, nav, sheets d'appel, dialogues, toasts, états vides, messages d'erreur, placeholders, libellés `aria-label`, formats de date/heure).

### 2. Dictionnaire
Compléter `src/lib/i18n/mplanipret.ts` (et le miroir `apps/planipret-mobile`) avec les clés manquantes en **fr** et **en**, structurées par écran. Ajouter un script de contrôle qui échoue si une clé existe dans une langue et pas dans l'autre.

### 3. Brief AVA — plus détaillé + bilingue
- `pp-ava-brief` : accepter `language: 'fr' | 'en'` (envoyé par le client depuis la langue active), prompt et libellés de sections générés dans cette langue.
- Enrichir le contenu : appels (entrants/sortants/manqués/durée moy.), SMS envoyés/reçus, courriels non lus, voicemails, rendez-vous du jour, dossiers du pipeline à relancer, comparaison vs la veille/semaine, top 3 actions prioritaires nommées.
- Même traitement pour `pp-ava-report` et les schedulers (matin/soir) : utiliser la langue du profil courtier.

### 4. Chatbot AVA bilingue
- `pp-ava-chat` : recevoir `language` et remplacer les prompts figés par une consigne dynamique (« Réponds en français » / « Reply in English »), y compris le prompt de résumé et l'appel à `pp-ava-report`.
- Traduire aussi les libellés des suggestions/actions rendus côté client.
- Messages d'accueil, placeholders et erreurs du chat via `t(...)`.

### 5. Validation
- Parcours Playwright automatisé : pour chaque route mobile, capture en FR puis en EN, et détection heuristique de texte resté dans la mauvaise langue (accents/mots-clés FR visibles en mode EN, et liste de mots EN en mode FR).
- Test manuel du brief et d'une conversation AVA dans les deux langues.
- Rapport final : tableau écran par écran ✅/❌.

## Détails techniques
- Source de vérité : `useMplanipretLang` (clé `mplanipret-lang` + `ava-language`, synchronisée sur `planipret_profiles.language`).
- La langue est transmise aux Edge Functions dans le body (`language`), avec repli sur `planipret_profiles.language` côté serveur pour les envois planifiés (push 08:30 / 17:30).
- Aucun changement de logique métier : uniquement présentation + paramètre de langue des prompts.

## Question de portée
Ce plan couvre **l'app mobile Planiprêt + le brief/chat AVA**. Si tu veux aussi repasser le **portail admin Planiprêt** (pages `PA*`) dans le même lot, dis-le et je l'ajoute.
