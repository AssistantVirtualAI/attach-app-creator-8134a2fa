## Objectif

Uniformiser visuellement les 23 pages du portail admin Planiprêt et supprimer les débordements horizontaux. Aucune logique métier, requête, edge function ou state ne sera modifié — uniquement JSX de présentation, classes et styles.

## Constat

- `PlanipretAdminLayout.tsx` : `<main className="flex-1 p-7 overflow-y-auto">` — pas de largeur max, pas de confinement horizontal, donc toute page large pousse le layout.
- Chaque page définit son propre en-tête (titre/sous-titre) avec des tailles, marges et couleurs légèrement différentes (ex. `PAAvaAgent` en `fontSize: 22` inline, d'autres en classes Tailwind).
- 8 pages seulement utilisent `overflow-x-auto` sur leurs tableaux ; les autres (`PAUsers`, `PARecordings`, `PACalls`, `PAMessages`, `PAVoicemails`, `PACompliance`, `PAAvaLogs`, `PAAvaToolsAudit`, `PAAuditChecklist`…) débordent avec des tableaux larges. `PAMobileDevices` force `min-w-[980px]`.
- Espacements verticaux inconsistants : `space-y-4`, `space-y-5`, `space-y-6` selon la page.

## Plan

### 1. Coquille de page partagée (nouveau composant présentiel)
Créer `src/components/planipret/admin/PAPageShell.tsx` :
- `PAPage` : conteneur `w-full max-w-[1400px] mx-auto space-y-5 min-w-0`
- `PAPageHeader` : titre + sous-titre + zone d'actions, typographie unique (titre 20-22px, `--pp-text-primary`, sous-titre 12px `--pp-text-faint`), icône optionnelle dans une pastille colorée
- `PATableWrap` : `w-full overflow-x-auto rounded-xl border` + scrollbar discrète, à envelopper autour de chaque `<table>`

### 2. Layout
Dans `PlanipretAdminLayout.tsx`, `<main>` devient `flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-5 md:p-7` — empêche définitivement toute page de pousser la sidebar.

### 3. Passage page par page (les 23, sans exception)
Pour chacune : remplacer le wrapper racine par `PAPage`, l'en-tête maison par `PAPageHeader` (mêmes textes/clés i18n existantes), envelopper chaque tableau dans `PATableWrap`, normaliser les cartes sur la classe `pp-card` existante, uniformiser les espacements sur `space-y-5` / `gap-4`, et rendre les grilles de KPI responsives (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`).

Ordre : PAOverview, PAUsers, PAMobileDevices, PARecordings, PAReports, PAMaestroSync, PACalls, PAMessages, PAVoicemails, PALeads, PAAva, PAAvaAgent, PAAvaLogs, PAAvaToolsAudit, PAHoldMusic, PATemplates, PAMaestroStatus, PADiagnostics, PASipDiagnostic, PACompliance, PAAuditLog, PAAuditChecklist, PADebug.

### 4. Vérification
Capture Playwright de chaque route admin en 1280px et 1024px, contrôle que `document.body.scrollWidth === clientWidth` (zéro débordement) sur toutes les pages, plus un typecheck complet.

## Notes techniques
- Aucun hook, fetch, handler ou clé i18n n'est modifié ; uniquement le balisage de présentation.
- Les tokens `--pp-*` existants sont réutilisés, aucune nouvelle palette.
