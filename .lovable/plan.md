# Commissions courtier — nettoyage visuel et fiabilité des données

## État actuel vérifié

- Le registre contient **901 lignes** (2022 → 2026), toutes rattachées à **Jean-Eric Gagnon** (un seul `agent_name`, un seul `agent_key`, `broker_user_id` rempli sur 100 % des lignes).
- Volume total 180 280 455,85 $, commissions 766 774,71 $, 4 types de commission, aucune ligne sans date ni sans montant de prêt.
- `maestro_broker_id` est **vide sur toutes les lignes** alors que les feuilles contiennent la colonne `cabinet` (237873) et `target_name` — ces champs ne sont donc pas exploités pour rattacher un courtier.
- La page courtier affiche 4 sources (Registre, Maestro, Interne, Provenance) et le composant Registre expose jusqu'à 9 sous-onglets, dont plusieurs pensés pour l'admin.

## Ce qu'on va faire

### 1. Rattachement propre des courtiers

- Enrichir l'import pour remplir `maestro_broker_id` à partir de la colonne `cabinet`, et conserver `target_name` (courtier cible) en plus de `agent_name`.
- Résolution du courtier dans l'ordre : `broker_user_id` → `maestro_broker_id` → `target_name` normalisé → `agent_name` normalisé (accents, tirets, ordre prénom/nom ignorés).
- Chaque nouveau courtier présent dans un futur dépôt sera automatiquement rattaché sans retoucher le code.

### 2. Contrôle d'intégrité par feuille/année

- Recompter par année et par type de commission, comparer aux totaux de chaque feuille, et signaler tout écart de ligne, de volume ou de commission.
- Détecter doublons (`number` + `date_trans` + `amount`), lignes orphelines (aucun courtier résolu) et dates hors année de feuille.
- Le résultat est visible dans un bandeau de santé discret en haut de la page courtier (vert si tout concorde).

### 3. Page Commissions courtier repensée

- Réduire les sources à **Registre** (par défaut) et **Maestro**, avec Provenance et Données internes déplacées dans un menu secondaire.
- Sous-onglets courtier limités à l'essentiel : **Aperçu · Tendance · Prêteurs · Mix · Club Excellence ★ · Dossiers**. Les onglets admin (Courtiers, Écarts, Couverture) restent réservés à l'admin.
- En-tête épuré : bandeau dégradé avec période sélectionnée, 4 KPI principaux (Volume, Commissions, Dossiers, BPS) et variation vs période précédente.
- Harmonisation 3D : même profondeur, mêmes tooltips lisibles, mêmes légendes et mêmes couleurs de prêteurs sur tous les graphiques et tableaux.
- Tableau Dossiers : recherche, tri par colonne, pagination, format monétaire fr-CA cohérent, export CSV.
- État vide soigné pour un courtier sans ligne au registre (message clair + invitation à connecter Maestro) au lieu de graphiques à zéro.

## Détails techniques

- `supabase/functions/pp-commission-import` : mapping `cabinet` → `maestro_broker_id`, `target_name` persisté, normalisation des noms partagée.
- `supabase/functions/_shared/commission-engine.ts` : fonction de résolution courtier unique réutilisée par l'import et les stats.
- `supabase/functions/pp-commission-stats` : matching courtier élargi + bloc `integrity` (compte par année, doublons, orphelins) dans la réponse.
- Front : `PBCommissions.tsx` (sources simplifiées), `RegisterCommissions.tsx` (onglets conditionnés au scope, en-tête KPI), nouveau `RegisterHealthBadge.tsx`, tableau Dossiers extrait dans `RegisterDealsTable.tsx`.
- Aucune modification de la page admin en dehors du partage de la logique de résolution.
