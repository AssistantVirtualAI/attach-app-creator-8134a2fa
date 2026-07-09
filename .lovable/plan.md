## Contexte

### 1. Pourquoi les warnings Microsoft persistent
Les tests qui affichent « Insufficient privileges » (Organisation, Utilisateurs, Configuration App Azure, Permissions Graph) utilisent tous un **token application (client_credentials, `.default`)** et interrogent des endpoints d'**annuaire Azure AD** :
- `/organization`, `/users`, `/applications`, `/servicePrincipals`

Ces endpoints exigent des permissions **Application** (pas Déléguées) — `Organization.Read.All`, `User.Read.All`, `Application.Read.All` — avec **admin consent** dans Azure. Les permissions actuellement approuvées dans votre app Azure sont vraisemblablement de type **Déléguées** (Mail.Send, Calendars.ReadWrite, Chat.Read, etc.), suffisantes pour le vrai produit (login utilisateur + Mail/Calendar/Teams), mais insuffisantes pour ces tests annuaire.

**Conclusion :** ces warnings sont un *diagnostic annuaire optionnel*, pas une vraie panne. Ils n'empêchent aucune fonction. Il faut cesser de les présenter comme des erreurs.

### 2. Page « AVA Statistics » (MStats)
La page `/mplanipret/stats` existe et affiche déjà les appels/leads, mais ne montre **aucune donnée Microsoft**. Aucun compteur d'emails ni de réunions n'est câblé. Résultat : page à moitié vide pour un utilisateur qui n'a pas encore d'appels.

---

## Plan

### Phase 1 — Corriger la présentation des tests annuaire (arrêter les faux warnings)

1. Modifier `supabase/functions/ms365-connection-test/index.ts` :
   - Ajouter un flag `informational: true` sur les 4 sous-tests `admin_directory`.
   - Sur un 403 « Insufficient privileges », renvoyer `success: true, degraded: "app_permission_missing"` avec un message neutre : « Diagnostic annuaire non disponible (permission Application non accordée) — sans impact sur Mail/Calendar/Teams ».
   - Ne les compter ni comme `passed` ni comme `failed` dans le `summary`.

2. Ajouter un **vrai test délégué** basé sur le token utilisateur connecté :
   - `/me` (profil), `/me/messages?$top=1`, `/me/events?$top=1`, `/me/chats?$top=1`.
   - Ce sont les endpoints réellement utilisés par le produit. S'ils passent, la connexion est confirmée OK.

3. Mettre à jour `Ms365LiveTestPanel.tsx` + `Ms365Diagnostics.tsx` :
   - Section « Capacités utilisateur (délégué) » = source de vérité verte/rouge.
   - Section « Diagnostic annuaire (informatif) » repliée par défaut, badge gris « info », pas d'icône ⚠️ jaune.
   - Le statut global (`ok/limited/down`) du badge devient dépendant du test délégué, plus des tests annuaire.

### Phase 2 — Enrichir MStats avec les données Microsoft réelles

1. Créer `supabase/functions/ms365-stats/index.ts` :
   - Auth : JWT utilisateur, avec refresh token automatique si expiré (même helper que `ms365-teams-list`).
   - Query params : `days` (7 / 30 / 90).
   - Utilise `$search` / `$filter` Graph sur `receivedDateTime` et `sentDateTime` :
     - `/me/messages?$filter=receivedDateTime ge {ISO}&$select=receivedDateTime,from,isRead&$top=999` (paginé)
     - `/me/mailFolders/sentitems/messages?$filter=sentDateTime ge {ISO}&$select=sentDateTime&$top=999`
     - `/me/events?$filter=start/dateTime ge '{ISO}'&$select=subject,start,end,attendees,isOnlineMeeting&$top=500`
   - Retourne buckets par jour : `{ date, emails_received, emails_sent, emails_unread, meetings, meeting_minutes }`, + totaux, + top expéditeurs.
   - Cache léger (5 min) via table `planipret_ai_insights` ou simple memoization in-function.

2. Créer `supabase/functions/ms365-stats-insights/index.ts` (optionnel — peut être fusionné) :
   - Prend la sortie de `ms365-stats` et interroge Lovable AI Gateway (`google/gemini-2.5-flash`) pour produire 3–5 insights courts en français : tendance semaine, ratio envoyés/reçus, plages horaires les plus chargées, recommandations.
   - Stocke le résultat dans `planipret_ai_insights` (déjà existante) pour éviter les appels répétés.

3. Modifier `src/pages/planipret/mobile/MStats.tsx` (et miroir mobile) :
   - Ajouter section « Microsoft 365 » avec :
     - KPI : `emails_received`, `emails_sent`, `meetings`, `meeting_minutes`.
     - BarChart empilé « Emails par jour » (reçus vs envoyés).
     - Liste « Prochaines réunions » (3 items).
     - Bloc « ✨ Insights AVA » (résultat IA).
   - Fallback gracieux si non connecté Microsoft → CTA « Connecter Microsoft » vers `/mplanipret/ms365-diagnostics`.
   - État de chargement + gestion d'erreur (token expiré → auto-retry via edge function).

### Phase 3 — Déploiement + parité

1. Déployer `ms365-connection-test`, `ms365-stats`, `ms365-stats-insights`.
2. Copier chaque fichier modifié dans `apps/planipret-mobile/src/` pour garder la parité mobile standalone.
3. Vérifier que `npm run build` du mobile passe.

### Phase 4 — Vérification

1. Rejouer `ms365-connection-test` dans l'aperçu : les 4 blocs annuaire deviennent « Informatif » et le statut global reste vert dès que `auth + /me` passent.
2. Ouvrir `/mplanipret/stats` : les compteurs Microsoft s'affichent, le graphique se remplit, les insights AVA apparaissent.
3. Reconnecter Microsoft pour rafraîchir le token si l'appel `/me/messages` renvoie 401 (le helper le fait déjà).

---

## Détails techniques

- **Scopes déjà couverts** par `ms365-oauth-exchange` : `Mail.ReadWrite`, `Calendars.ReadWrite`, `Chat.Read` — suffisants pour toutes les requêtes ci-dessus. Aucun nouveau scope à demander.
- **Pas de changement Azure requis** de votre côté. Si vous voulez faire disparaître aussi les blocs « Informatif », il faudrait ajouter dans Azure les permissions **Application** `Organization.Read.All`, `User.Read.All`, `Application.Read.All` puis cliquer *Grant admin consent* — mais ce n'est **pas nécessaire** pour Mail/Calendar/Teams/Stats.
- Les tables `planipret_ai_insights` et `planipret_profiles` (colonnes `ms365_*`) sont déjà en place, aucune migration.

---

## Question de cadrage

Voulez-vous que je fusionne `ms365-stats` et `ms365-stats-insights` en une seule fonction (plus simple, un seul appel côté client), ou les garder séparées (plus flexible pour rafraîchir seulement les KPI sans reconsommer du crédit IA) ? Sans réponse, je fusionne en une seule fonction.
