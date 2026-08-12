# Commissions : source unique Maestro + AI partout

## Objectif

Une seule source de vérité : Maestro. Plus de pages « Données internes » ni « Couverture des données », plus aucun repère d'import de fichier, et une analyse AI présente et auto-actualisée sur chaque onglet.

Les 901 lignes déjà en base restent affichées en attendant le branchement du endpoint Maestro.

## 1. Suppression des pages et sources

- Portail admin (`PACommissions`) : le sélecteur de source disparaît. Plus de « Données internes », plus de choix Registre/Maestro — une seule vue unifiée.
- Portail broker (`PBCommissions`) : suppression du menu « Plus » (Données internes, Provenance) et du sélecteur d'onglets de source.
- Suppression de l'onglet « Couverture des données » et du fichier `CommissionCoverage.tsx`.
- Suppression de la page d'import registre du menu admin et du bouton d'import de fichier (plus aucune entrée manuelle).
- Le tableau éditable et les filtres utiles de l'ancienne page « Données internes » sont repris dans l'onglet « Vue d'ensemble » (section dossiers), pour ne rien perdre.

## 2. Nettoyage des traces d'import

Retrait des éléments qui parlent du fichier Excel plutôt que du métier :

- Bandeau « Totaux réconciliés / Écart de réconciliation ».
- Bandeau santé « Données complètes · 901 lignes importées · 2026 · 173 … ».
- Compteur « 100 écarts » et onglet Écarts lié à la qualité du fichier.
- Bannière de couverture des courtiers (limites du fichier source).
- Mentions « registre de dépôts », remplacées par « données Maestro ».

Conservés : Export CSV, Rapport PDF, Réinitialiser (utiles au quotidien).

## 3. Notes de calcul retirées

Les infobulles explicatives de calcul (`InfoTip`) sont retirées des KPI, graphiques, podium et tableaux des pages commissions admin et broker. L'explication passe désormais par l'AI.

## 4. AI présente et auto-actualisée sur chaque onglet

- Un bandeau d'analyse AI (Claude) est affiché en haut de **chaque onglet** des commissions, contextualisé à l'onglet visible (tendance, prêteurs, mix, trimestres, club, dossiers, courtiers).
- Génération automatique au chargement, sans clic.
- Invalidation automatique du cache dès qu'un nouvel appel Maestro ramène des données différentes (signature basée sur totaux + nombre de lignes + horodatage de synchronisation), au lieu du simple TTL 24 h.
- Bouton « Actualiser » discret conservé.

## 5. Préparation du branchement Maestro

- Un point d'entrée unique côté serveur alimente le stockage des commissions depuis Maestro ; l'interface lit toujours ce même stockage, donc aucune page ne change quand le endpoint arrive.
- Chaque synchronisation Maestro met à jour l'horodatage de source affiché discrètement (« Synchronisé via Maestro · il y a X min ») et déclenche le rafraîchissement AI.
- Tant que le endpoint n'est pas fourni, la synchronisation reste inactive et les données actuelles s'affichent normalement.

## Détails techniques

- `PACommissions.tsx` / `PBCommissions.tsx` : suppression des états de source, rendu direct de `RegisterCommissions` (renommé conceptuellement « vue commissions Maestro »).
- Suppression de `CommissionCoverage.tsx`, `RegisterHealthBadge.tsx`, du bloc réconciliation et de l'onglet `data` dans `RegisterCommissions.tsx`.
- Reprise dans l'onglet overview des filtres/table de `CommissionDashboard.tsx`.
- `CommissionInsights` : nouvelle prop `context` (onglet courant) + clé de cache incluant une signature de données ; auto-run via effet.
- Nouvelle route de synchronisation `pp-maestro-commissions-sync` (edge function) écrivant dans `planipret_commission_register`, prête à recevoir le endpoint.
- Retrait des imports `InfoTip` dans les composants commissions.
