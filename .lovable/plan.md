# Registre de commissions 2022-2026 dans le portail broker

Objectif : importer le registre de dépôts (2022 → 2026), appliquer exactement la logique de calcul du prompt maître, et afficher les résultats dans chaque portail broker avec filtre par année, tableaux complets et graphiques soignés.

## Ce qui est fourni
Le fichier envoyé contient uniquement la spécification de calcul, pas les lignes. Le classeur (feuilles `registre-depots 2022..2026` ou `Broker raw data`) sera fourni et importé.

## 1. Stockage des données brutes
Nouvelle table `planipret_commission_register` avec le schéma source A:S :
`number, loan_amt, primary_client_name, secondary_client_name, institution, financial_inst_id, is_adjustment, points, buy_down, amount, mortgage_type, term, agent_name, target_name, date_trans, commission_type, split_type, agent_company, cabinet`
plus `source_row` (ordre source, essentiel pour l'attribution « première ligne base »), `fiscal_year`, `ym_key`, `broker_user_id` (résolu via `planipret_profiles` par nom d'agent), `import_batch_id`.

Table `planipret_commission_imports` pour tracer chaque import (fichier, nb de lignes, années couvertes, date).

RLS : broker → uniquement ses lignes ; admin Planiprêt → tout. GRANT authenticated/service_role.

## 2. Import
Page admin `/planipret/admin/commissions-import` : upload XLSX/CSV, détection des feuilles annuelles, mapping des colonnes vers A:S, aperçu avant validation, remplacement par année (idempotent). Le parsing et l'insertion passent par une Edge Function `pp-commission-import` (service role).
Rapprochement courtier : correspondance `agent_name` → profil ; les noms non résolus sont listés pour mapping manuel.

## 3. Moteur de calcul (logique exacte du prompt)
Module partagé `supabase/functions/_shared/commission-engine.ts`, réutilisé par toutes les vues :
- Volume : lignes `commission_type = base`, `loan_amt > 0`, date dans la fenêtre ; clé unique `number|institution|mortgage_type|loan_amt`, on garde la première ligne en ordre source, puis somme des `loan_amt`.
- Deals : lignes base dans la fenêtre, un contrat (`number`) compté une seule fois.
- Commission : somme de `amount` sur toutes les lignes de la fenêtre, tous types confondus (base, bonus, bonus2, perform, ajustements), sans déduplication.
- BPS = Commission / Volume × 10 000 ; Deal moyen = Volume / Deals ; Commission/deal = Commission / Deals.
- YoY : si PY = 0 → « — » ou « Nouveau », sinon (CY-PY)/PY.
- Unicité recalculée pour chaque fenêtre (mois, trimestre, YTD, saison Club Excellence août→juillet). Jamais de somme de résultats mensuels dédupliqués.
- Attribution prêteur / type / terme / courtier : selon la première ligne base du contrat dans la fenêtre affichée.

Edge Function `pp-commission-stats` : entrées (année, mois sélectionné, courtier), sorties tous les blocs (KPI, mensuel, prêteurs, produits, termes, trimestres, matrice type×terme, Club Excellence, classement courtiers).

## 4. Interface broker — page Commissions
Barre de filtres : **année (2022-2026)**, mois sélectionné (1-12), et bascule Registre / Maestro (la source Maestro existante reste disponible).

Onglets :
- **Vue d'ensemble** : KPI YTD (Volume, Deals, Commission, Deal moyen, BPS moyen, Prêteurs actifs), variations YoY, cartes 3D existantes.
- **Tendance mensuelle** : tableau CY vs PY (Volume, Deals, Commission, YoY, deal moyen, BPS, commission/deal) + graphiques combinés colonnes/lignes.
- **Prêteurs** : classement complet (rang, volume CY/PY, deals, commission, BPS, % du volume, YoY, écart BPS) + graphique Top 10 CY vs PY.
- **Mix produits & termes** : mix par type de prêt, mix par terme, matrice type × terme (heatmap) en donuts/barres empilées.
- **Trimestres** : Q1-Q4 volume/deals/commission avec réconciliation vers le YTD.
- **Club Excellence** : standings nominatifs, saisons août→juillet, blocs mensuels et comparaisons YoY (le broker voit le classement nominatif complet).
- **Provenance** : onglet existant conservé, alimenté aussi par le registre (champ source exact, valeur brute, critères).

Le tableau de bord broker (Overview) reçoit une carte commissions annuelle reliée à ces mêmes chiffres.

## 5. Analyse IA
Extension de `pp-commissions-insights` (Claude) : lecture des agrégats du registre pour l'année filtrée, insights sur tendances, concentration prêteurs, saisonnalité, performance vs année précédente, avec vérification qu'aucun montant n'est recalculé par rapport aux valeurs brutes. Cache 24 h par courtier + année.

## 6. Contrôles de réconciliation
Vérification automatique, affichée dans un bandeau discret : le Volume et les Deals YTD doivent coïncider entre KPI, tendance mensuelle, total prêteurs, mix produits, mix termes et matrice. Tout écart est signalé.

## Design
Reprise du système 3D existant (`ov3d`), palette du portail broker, graphiques Recharts (colonnes groupées CY/PY, aires de tendance, donuts de mix, heatmap), formats $#,##0 / #,##0 / 0,0 % / 0,0 BPS, mode clair et sombre, bilingue FR/EN.

## Étapes techniques
1. Migration base (tables + RLS + GRANT + index sur `broker_user_id`, `date_trans`, `fiscal_year`).
2. `_shared/commission-engine.ts` + tests de la logique d'unicité.
3. Edge Functions `pp-commission-import` et `pp-commission-stats`.
4. Page d'import admin.
5. Refonte de `PBCommissions.tsx` en onglets + nouveaux composants de graphiques.
6. Extension des insights IA et des contrôles de réconciliation.

Après approbation, envoie le classeur du registre pour lancer l'import réel.
