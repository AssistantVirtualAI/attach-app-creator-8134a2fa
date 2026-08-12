# Import complet du classeur + page Commissions par onglet

Le classeur `Dashboard_Courtier_Copie_Complete.xlsx` a été analysé. La table du registre est vide (0 ligne) : l'import va tout remplir.

## Contenu du classeur (vérifié)

Onglets de données brutes (mêmes colonnes A:S + `unique_volume`) :
`registre-depots 2022` (159 l.), `2023` (154), `2024` (180), `2025` (239), `2026` (174), et `Broker raw data` (902 lignes = union des 5 années).

Onglets de résultats (calculés) : Broker Dashboard, Monthly Trend, Lender Monthly, Broker Monthly, Club Excellence Results, Stats by Period, Top Lenders Chart, Graph and Mix, Config, Update Instructions, Prompt.

Un seul courtier présent dans les données : **Jean-Eric Gagnon** (901 lignes). Les autres courtiers apparaîtront automatiquement lors des prochains imports.

## 1. Import complet

- Import des 5 onglets annuels (source de vérité, `sheet_name` conservé), avec dédoublonnage par clé stable (onglet + ligne source) — `Broker raw data` sert uniquement de contrôle de totaux, pas de double insertion.
- Dates : les onglets 2024-2026 stockent des numéros de série Excel, 2022-2023 des dates réelles. Les deux formats sont normalisés en date.
- Chaque ligne conserve sa valeur brute (`raw`) et son onglet d'origine pour la provenance.
- Rattachement courtier : `agent_name` → profil courtier + Maestro ID ; les noms non résolus passent en « NON MAPPÉ » et restent corrigeables dans l'écran de mapping existant.
- Rapport d'import : lignes par onglet, années couvertes, lignes rattachées / non rattachées, anomalies.

## 2. Page Commissions Admin — un onglet par sheet

La page Commissions (portail admin) reçoit une barre d'onglets en haut, un onglet par feuille du classeur, chacun avec ses tableaux et ses graphiques :

- **Tableau de bord** — KPI (Volume, Dossiers, Commission, Deal moyen, BPS, Prêteurs actifs) + Top 10 prêteurs.
- **Tendance mensuelle** — tableau CY vs PY (volume, dossiers, commission, YoY, deal moyen, BPS, commission/dossier) + graphique combiné colonnes/ligne.
- **Prêteurs** — classement complet (rang, volume/deals/comm CY et PY, BPS, % volume, YoY, écart BPS) + graphique Top 10 CY vs PY.
- **Courtiers** — classement par volume avec YoY et deal moyen, cliquable vers le drill-down existant.
- **Club Excellence** — saisons août→juillet, volume/dossiers CE vs saison précédente.
- **Stats par période** — bloc volume / dossiers / commission pour le mois sélectionné.
- **Mix & graphiques** — mix par type de prêt, par terme, matrice type × terme.
- **Écarts** et **Import/Mapping** — onglets existants conservés.

Filtres au-dessus des onglets : **année (2022 → 2026)**, granularité (semaine / mois / trimestre / cumul annuel / année), période, et courtier. Les filtres restent mémorisés dans le navigateur.

## 3. Portail courtier

Le portail courtier reçoit exactement les mêmes onglets et graphiques, restreints à ses propres lignes (rattachement par profil / Maestro ID) : tableau de bord, tendance mensuelle, prêteurs, Club Excellence, mix, stats par période. Filtre année 2022-2026 identique.

## Détails techniques

- `pp-commission-import` : import multi-onglets avec upsert par `row_key`, normalisation des dates série Excel, rapport par onglet.
- `_shared/commission-engine.ts` : logique inchangée (unicité volume sur lignes `base`, commission = somme de tous les types, recalcul par fenêtre).
- `pp-commission-stats` : ajout des blocs manquants (Club Excellence par saison, stats par période, matrice type × terme) déjà partiellement présents ; sortie unique consommée par les deux portails.
- Front : `RegisterCommissions.tsx` réorganisé en onglets nommés d'après les feuilles, nouveaux composants de tableaux/graphiques Recharts en style 3D existant (`ov3d`), réutilisés tels quels par `PBCommissions`.
