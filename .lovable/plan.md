
## Constat après vérification

**1. AVA Analytics est vide parce que la base est vide, pas parce que la page est cassée.**

Vérification directe côté backend :
- `planipret_ava_email_analyses` : **0 lignes** (aucun email n'a jamais été analysé par AVA)
- `planipret_profiles` : **352 courtiers**, dont **0 avec un token Microsoft actif** (`ms365_access_token IS NULL` partout)
- La fonction `planipret-admin-ava-analytics` répond correctement (logs propres, pas d'erreur), mais elle n'a littéralement rien à agréger.

Donc les KPI à 0, le graphique plat et « Aucune réunion à venir » sont le comportement correct — pas un bug d'affichage. Tant qu'aucun courtier n'a reconnecté Microsoft 365 après la mise à jour des scopes, et tant que « Analyser les emails maintenant » n'a pas été lancé au moins une fois, la page restera vide.

**2. Le switch FR ↔ EN ne traduit pas tout parce que la plupart des pages du portail admin sont écrites en français en dur.**

Sur 16 pages `src/pages/planipret/admin/*.tsx`, seulement 3 utilisent `useMplanipretLang` (`PAOverview`, `PAReports`, `PlanipretAdminLayout`). Tous les autres (`PAAva`, `PACalls`, `PALeads`, `PAMessages`, `PAUsers`, `PARecordings`, `PAVoicemails`, `PATemplates`, `PACompliance`, `PAAuditLog`, `PAAuditChecklist`, `PADebug`, `PASipDiagnostic`, `PAMobileDevices`) contiennent des libellés FR en dur (titres, boutons, tooltips, états vides…). Le sélecteur de langue fonctionne correctement — il n'y a simplement rien à basculer sur ces écrans.

## Plan

### A. Rendre AVA Analytics « non-vide » et actionnable

Objectif : quand il n'y a pas encore de données, la page doit expliquer pourquoi et guider l'admin — sans mentir avec des chiffres factices.

1. Dans `src/pages/planipret/admin/PAAva.tsx` (+ miroir `apps/planipret-mobile/…`), ajouter un **bandeau d'état des sources de données** en haut de page qui affiche, en direct :
   - Nombre de courtiers avec token Microsoft actif / total (ex. « 0 / 352 courtiers connectés à Microsoft 365 »).
   - Nombre d'analyses AVA sur la période (ex. « 0 email analysé sur 30 jours »).
   - Une puce colorée : vert si tout coule, orange si Microsoft connecté mais 0 analyse, rouge si aucun courtier connecté.
2. Quand `totals.analyses === 0 && microsoft.connected_brokers === 0`, remplacer la grille KPI par un **empty-state pédagogique** avec deux actions :
   - « Ouvrir le diagnostic Microsoft 365 » → route existante `/planipret/ms365-diagnostics`.
   - « Analyser les emails maintenant » (bouton déjà présent, remonté en évidence).
   Les graphiques restent affichés en dessous mais grisés avec la mention « en attente de données ».
3. Étendre la fonction `planipret-admin-ava-analytics` pour renvoyer un bloc `dataHealth` :
   ```
   dataHealth: {
     brokers_total, brokers_with_ms365_token,
     analyses_last_30d, last_analysis_at,
     ms_graph_mode: "delegated" | "application" | "none"
   }
   ```
   Le front l'utilise pour peindre le bandeau et l'empty-state ci-dessus.
4. Ajouter dans la fonction un fallback : si `brokers_with_ms365_token === 0` mais que le mode `application` est disponible (Azure app permissions), tenter automatiquement un scan léger sur les 5 premiers courtiers pour peupler la page — déjà partiellement fait, mais actuellement il faut appeler `getAppAccessToken` seulement en fallback ; on force ce chemin dès qu'aucun token délégué n'existe.

### B. Traduire le portail admin Planiprêt (FR ↔ EN)

Objectif : le switch FR/EN change réellement l'UI sur toutes les pages admin.

1. Ajouter une section `adminPortal` dans le dictionnaire partagé `src/lib/i18n/mplanipret.ts` (source de vérité utilisée par `useMplanipretLang`) avec les clés nécessaires pour chaque page admin listée ci-dessous. Structure :
   ```
   adminPortal: {
     ava: { title, subtitle, analyzeNow, retune, kpi: {...}, sections: {...}, empty: {...} },
     calls: { … },
     leads: { … },
     messages: { … },
     users: { … },
     recordings: { … },
     voicemails: { … },
     templates: { … },
     compliance: { … },
     auditLog: { … },
     auditChecklist: { … },
     debug: { … },
     sipDiagnostic: { … },
     mobileDevices: { … },
     common: { loading, error, refresh, exportCsv, empty, retry }
   }
   ```
   Chaque clé est renseignée en `fr` **et** en `en`. Aucune valeur en dur ne subsiste dans les composants.
2. Refactorer chacune des 13 pages admin listées ci-dessus pour :
   - Importer `useMplanipretLang` et appeler `const { t } = useMplanipretLang();`.
   - Remplacer les chaînes FR en dur par `t("adminPortal.<page>.<clé>")`.
   - Formater les dates via `toLocaleDateString(lang === "en" ? "en-CA" : "fr-CA", …)` au lieu de forcer `fr-CA`.
3. Répliquer strictement les mêmes changements dans `apps/planipret-mobile/src/pages/planipret/admin/` pour garder la parité mobile standalone (contrainte `mplanipret-isolation-locked`).
4. Ajouter un test de parité FR/EN dans `src/lib/i18n/__tests__/mplanipret-parity.test.ts` (déjà présent) pour vérifier que chaque clé `adminPortal.*` existe dans les deux langues.

### C. Vérification

- `npm run build` (racine + `apps/planipret-mobile`) pour valider TypeScript.
- Test manuel : ouvrir `/planipret/admin/ava` → vérifier bandeau + empty-state ; cliquer FR/EN → vérifier que titres, boutons et libellés changent sur toutes les pages admin.
- Test unitaire de parité i18n exécuté via `bunx vitest run src/lib/i18n/__tests__/mplanipret-parity.test.ts`.

## Détails techniques (référence)

- Aucune modification de schéma DB ni de RLS n'est requise.
- Aucune modification Azure requise ; la partie « scan applicatif » utilise déjà `MICROSOFT_CLIENT_ID/SECRET/TENANT` côté secrets.
- La contrainte `mplanipret-isolation-locked` impose la synchro `src/` ↔ `apps/planipret-mobile/src/` pour tous les composants touchés.
- Aucun changement au sélecteur de langue lui-même (`PlanipretLangSwitch`, `useMplanipretLang`) : ils fonctionnent, seul le contenu manque.
