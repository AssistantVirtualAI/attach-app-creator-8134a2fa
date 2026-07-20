# Portail admin Planiprêt — bilingue complet FR ⇄ EN

## Situation actuelle (vérifiée)

- Le layout `PlanipretAdminLayout.tsx` utilise déjà `useMplanipretLang().t(...)` avec le namespace `adminPortal.*` du dictionnaire `src/lib/i18n/mplanipret.ts` (FR + EN déjà présents).
- Sur les **21 pages admin**, seules **8 importent** le hook de traduction (`PAAuditChecklist`, `PAAva`, `PAAvaAgent`, `PAAvaLogs`, `PACalls`, `PALeads`, `PAOverview`, `PAReports`) — et même celles-ci contiennent encore beaucoup de texte codé en dur.
- **13 pages n'ont aucune traduction** : `PAAuditLog`, `PACompliance`, `PADebug`, `PADiagnostics`, `PAMaestroStatus`, `PAMaestroSync`, `PAMessages`, `PAMobileDevices`, `PARecordings`, `PASipDiagnostic`, `PATemplates`, `PAUsers`, `PAVoicemails`.
- Résultat : cliquer sur EN change le layout (sidebar, titre) mais laisse la majorité du contenu en français.

## Objectif

Toute chaîne visible dans `/planipret/admin/**` doit basculer proprement quand l'utilisateur change de langue via `PlanipretLangSwitch`.

## Approche

Étendre le dictionnaire existant plutôt que d'en créer un nouveau — un seul système, cohérent avec le layout.

### 1. Étendre `src/lib/i18n/mplanipret.ts`

Ajouter sous `adminPortal` (FR et EN en parallèle) un sous-namespace par page :

```text
adminPortal.pages.{overview|users|calls|messages|recordings|voicemails|
  leads|templates|reports|compliance|auditLog|auditChecklist|
  maestroSync|maestroStatus|mobileDevices|diagnostics|sipDiagnostic|
  debug|ava|avaAgent|avaLogs}
```

Chaque bloc contient : `title`, `subtitle`, entêtes de tableau, boutons, labels de filtres, états vides, toasts, libellés de statut, messages d'erreur/succès.

Ajouter aussi un namespace transverse `adminPortal.common` : `refresh`, `save`, `cancel`, `delete`, `edit`, `search`, `loading`, `noData`, `yes`, `no`, `all`, `actions`, `export`, `filters`, statuts (`connected`, `pending`, `error`, `disconnected`), unités de temps (`min`, `hSuffix`, `daysAgo`), etc.

### 2. Convertir les 21 pages admin

Pour chaque page :
1. Importer `useMplanipretLang` et récupérer `t`.
2. Remplacer chaque littéral FR par `t("adminPortal.pages.<page>.<clé>")` ou `t("adminPortal.common.<clé>")`.
3. Traiter aussi : `alert()`, `confirm()`, `toast(...)`, placeholders, `aria-label`, `title` HTML, options de `<select>`, textes d'erreur `catch`.
4. Format des dates : passer par `Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", ...)` là où l'on affiche des dates humaines.
5. Pluriels simples via une petite helper `plural(t, n, "adminPortal.common.callSingular", "adminPortal.common.callPlural")`.

### 3. Composants partagés utilisés dans l'admin

Passer en revue et traduire les composants montés dans ces pages :
- `NotificationsBell`, `CommandPalette`, `SessionTimeoutModal`, `PpActiveCallScreen`, `WorkspaceHeaderExtras` (seulement ce qui apparaît dans le scope admin).
- Widgets internes des pages (ex. cartes KPI, modales edit user dans `PAUsers`, composeur dans `PAMessages`).

### 4. Garde-fous

- Le fallback de `t()` retourne la clé si absente — j'ajoute un log dev-only pour repérer les clés manquantes pendant la conversion.
- Vérifier que `useMplanipretLang` et `useLanguage` restent bien synchronisés (déjà le cas : `setLang` écrit dans les deux `localStorage` et appelle `setGlobalLanguage`).

### 5. Validation

Après conversion, parcourir chaque page en FR puis en EN via le switch de langue et vérifier :
- Titres, sous-titres, sidebar, entêtes de colonnes, boutons, badges, tooltips.
- Modales et menus déroulants (ex. `Actions` de `PAUsers`).
- Messages toast/alert/confirm.
- États vides et messages de chargement.

## Détails techniques

- Aucun changement de contrat : `useMplanipretLang()` existant, dictionnaire déjà chargé, switch de langue déjà branché.
- Zéro migration DB, zéro nouvelle dépendance.
- Volume : ~15 000 lignes de pages admin à balayer ; ajout estimé de ~600–900 clés dans `mplanipret.ts` (FR + EN).
- Livrable en une seule passe (pas de PR partielle) pour éviter un mélange visible FR/EN.

## Hors périmètre

- Portail broker (`/planipret/**` non-admin) et app mobile — déjà couverts par leurs propres passes i18n.
- Contenu généré côté serveur (emails, notifications push) — non demandé ici.
- Retraduction du wording FR existant : je garde le texte actuel et ne fais que produire l'équivalent EN.
