# Commissions et tâches sur l'app mobile — parité avec le portail

## Constat actuel (vérifié)

- `MCommissions.tsx` existe et est routée (`/mplanipret/commissions`), mais elle ne contient **qu'un seul graphique** (un `BarChart`), alors que le portail (`RegisterCommissions.tsx`) en propose une dizaine : volume mensuel CY vs PY, commission par type (donut), volume cumulé, dossiers vs commission/dossier, concentration prêteurs, BPS mensuel, top 10 prêteurs, part de marché.
- `CommissionHomeCard.tsx` existe dans l'app mobile mais **n'est importée nulle part** — donc aucune donnée de commission n'apparaît sur l'accueil.
- `MMore.tsx` ne propose **aucune entrée** vers Commissions ni vers Tâches; « Mes performances » pointe uniquement vers `/mplanipret/stats`.
- `MTasks.tsx` est routée (`/mplanipret/tasks`) et branchée sur `TasksSection` + `usePlanipretTasks`, mais reste inaccessible depuis le menu.

## Ce qui sera livré

### 1. Section « Mes performances » dans Plus
Regrouper dans `MMore.tsx` une section Performances contenant :
- Statistiques (existant)
- **Mes commissions** → `/mplanipret/commissions`
- **Mes tâches** → `/mplanipret/tasks`
- Pipeline (déplacé dans la même section)

Les lignes Commissions/Tâches sont affichées seulement pour les rôles `broker` et `admin`.

### 2. Page commissions mobile enrichie (parité portail)
Étendre `MCommissions.tsx` avec des graphiques adaptés au mobile (hauteurs réduites, légendes compactes, scroll horizontal si nécessaire) :
- Volume mensuel — année courante vs précédente (barres groupées)
- Commission mensuelle CY vs PY
- Volume cumulé (aire, courbe de rythme)
- Commission par type (donut)
- Top prêteurs par volume (barres horizontales)
- BPS par mois (rentabilité)
- KPI existants conservés (total, dossiers, moyenne, volume, variation)

Toutes les données proviennent des actions déjà en place de `planipret-commission-reports` (`summary`, `deposits`, `institutions`, `agents`) — aucun nouvel endpoint.

### 3. Graphiques sur l'accueil (iOS + Android)
Monter `CommissionHomeCard` dans `MHome.tsx` (visible pour broker/admin) avec :
- KPI du mois + variation vs mois précédent
- Mini-tendance 6 mois (sparkline/barres)
- Top prêteurs
- Un aperçu tâches ouvertes (compteur + 3 prochaines échéances) renvoyant vers `/mplanipret/tasks`
- Tap → ouverture de la page complète

### 4. Vérification de la chaîne tâches
- Confirmer que `usePlanipretTasks` couvre bien liste, création, mise à jour, suppression, `task_targets` et vérification Maestro sur mobile.
- Ajouter les états vides/erreur et le bouton « Ouvrir dans Maestro » si absents sur un chemin.

### 5. Tests
Étendre `MCommissions.e2e.test.tsx` et `MTasks.e2e.test.tsx` pour couvrir le rendu des nouveaux graphiques, la carte d'accueil et l'accès depuis Plus. Lancer typecheck + suite Vitest.

## Détails techniques

- Fichiers touchés : `apps/planipret-mobile/src/pages/planipret/mobile/MCommissions.tsx`, `MHome.tsx`, `MMore.tsx`, `apps/planipret-mobile/src/components/planipret/mobile/CommissionHomeCard.tsx`, tests associés.
- Recharts est déjà utilisé côté mobile — pas de nouvelle dépendance.
- Aucune modification de la base de données ni des edge functions.
- Les couleurs suivent les tokens `--pp-*` existants (pas de valeurs codées en dur).
