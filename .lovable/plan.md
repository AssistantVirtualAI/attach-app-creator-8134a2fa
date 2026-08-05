# Page STATS Commission (admin global + portail courtier)

Ajout d'un module « Stats Commission » alimenté par les deux tableaux de bord fournis (Ryan La Haye – Team Leader, et Jean-Eric Gagnon – Courtier), avec vue globale pour l'admin et vue filtrée par courtier dans le portail courtier.

## Données extraites (les deux fichiers, toutes les sections)

Pour chaque courtier :
- KPI YTD : volume, deals, commission, taille moyenne, commission moyenne/deal, BPS moyen, prêteurs actifs (CY / PY / YoY)
- Top prêteurs (volume, deals, commission, CY vs PY)
- Résumé trimestriel Q1–Q4 (volume, deals, commission, CY vs PY)
- Commission par type (base, bonus, bonus2, perform)
- Club Excellence (saison Aug–Jul : volume, deals, commission, meilleur mois)
- Product mix (Taux Fixe / Variable / Marge hypothécaire)
- Term mix (0,1,2,3,4,5, Other)
- Matrice Type × Terme
- Contexte équipe (part % du courtier dans l'équipe RLH) — Ryan seulement

## Stockage

Nouvelle table `planipret_commission_stats` (une ligne par métrique) :
`id, broker_name, broker_user_id (nullable), fiscal_year, section, dimension, sub_dimension, cy_volume, py_volume, cy_deals, py_deals, cy_commission, py_commission, extra jsonb, source_file, created_at`

- RLS : admin Planiprêt = lecture/écriture globale ; courtier = lecture de ses propres lignes seulement (`broker_user_id = auth.uid()` ou correspondance de nom liée au profil).
- GRANTs explicites + politiques.
- Les données des deux CSV sont insérées comme jeu initial.

## Page admin — `/planipret/admin/commissions`

- Vue globale « Tous les courtiers » : KPI consolidés, comparatif entre courtiers, part d'équipe.
- Sélecteur de courtier (Tous / Ryan La Haye / Jean-Eric Gagnon).
- Recherche et filtres : courtier, prêteur/banque, type de commission, type de prêt, terme, trimestre/période, année fiscale.
- Graphiques : barres groupées CY vs PY par prêteur, donut commission par type, aires par trimestre, barres product mix, heatmap Type × Terme, cartes KPI avec badge YoY.
- Deux modes d'affichage :
  - **Vue régulière** : tableaux triables (prêteurs, trimestres, types, termes) + export CSV.
  - **Vue Kanban** : colonnes par section (Prêteurs, Trimestres, Types de commission, Product mix, Term mix, Club Excellence) avec cartes-métriques.
- Bandeau « vue globale » persistant en haut de chaque section (volume, deals, commission, BPS).

## Page courtier — `/planipret/broker/commissions`

Même page, mais verrouillée sur le courtier connecté via `brokerAccess` (aucun identifiant depuis l'URL) : ses KPI, ses prêteurs, ses trimestres, son mix, son Club Excellence, plus sa part relative à l'équipe. Mêmes graphiques, mêmes filtres, mêmes vues Kanban/régulière, bilingue FR/EN.

## Détails techniques

- Migration Supabase : table + index (`broker_name`, `section`, `fiscal_year`) + RLS + GRANTs ; insertion des données via l'outil d'insertion.
- `src/lib/planipret/commissionStats.ts` : types, chargement, agrégation, formatage (montants CAD, BPS, %).
- Composants partagés dans `src/components/planipret/commissions/` : `CommissionKpiRow`, `CommissionCharts` (recharts), `CommissionTables`, `CommissionKanban`, `CommissionFilters` — réutilisés par la page admin et la page courtier.
- Nouvelles pages : `src/pages/planipret/admin/PACommissions.tsx`, `src/pages/planipret/broker/PBCommissions.tsx`, ajoutées aux menus latéraux et aux routes lazy de `src/App.tsx`.
- Liaison courtier : `broker_user_id` résolu depuis `planipret_profiles` par nom complet ; les lignes non liées restent visibles admin seulement.
