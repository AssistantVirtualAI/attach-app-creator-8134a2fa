# Registre des commissions — vue admin globale

Étendre la même logique de registre (2022→) au portail admin, avec une vue globale sur tous les courtiers et des filtres agent / semaine / mois / trimestre / année.

## Ce que l'admin verra

Page **Statistiques de commissions** (`/planipret/admin/commissions`), nouvel onglet **Registre 2022+** :

- **Barre de filtres** : année, granularité (semaine | mois | trimestre | année), sélecteur de période dans la granularité choisie, et sélecteur d'agent (« Tous les courtiers » par défaut, ou un courtier précis).
- **KPI globaux** : volume, dossiers, commissions, dossier moyen, BPS, commission/dossier, courtiers actifs, prêteurs actifs — avec comparaison à la même période de l'an dernier.
- **Classement des courtiers** (le tableau clé de la vue globale) : par courtier, volume / dossiers / commissions / dossier moyen / BPS / part du volume / variation vs an dernier, trié et rangé.
- **Tendance** : volume, dossiers et commissions par mois (ou par semaine si granularité semaine), courante vs précédente.
- **Prêteurs**, **Mix produits / termes**, **Matrice type × terme**, **Commission par type**, **Trimestres**, **Club Excellence** — mêmes vues que le portail courtier mais sur le périmètre sélectionné.
- **Insights IA Claude** sur le périmètre affiché (cache 24 h par admin/période/agent), derrière le consentement IA.
- **Bandeau de réconciliation** : le volume et les dossiers des répartitions doivent égaler les KPI, sinon alerte.

Quand un agent précis est sélectionné, toutes les vues se restreignent à lui — l'admin voit exactement ce que voit ce courtier.

## Règles de calcul (inchangées)

Les mêmes règles que le portail courtier s'appliquent, recalculées pour chaque fenêtre choisie :
- Volume : tranches uniques (dossier | institution | type | montant), première ligne en ordre source.
- Dossiers : contrats uniques.
- Commissions : somme brute de toutes les lignes, sans déduplication ni recalcul.
- Comparaison N-1 sur la fenêtre équivalente de l'année précédente.

## Détails techniques

1. `supabase/functions/_shared/commission-engine.ts` : ajouter `weekWindow(year, isoWeek)` et un helper `resolveWindow(granularity, year, index)` (semaine ISO, mois, trimestre, année) plus la fenêtre N-1 correspondante.
2. `supabase/functions/pp-commission-stats/index.ts` :
   - accepter `granularity` (`week|month|quarter|year`), `periodIndex`, et `agent` (nom du courtier ou `broker_user_id`) en plus de `year`/`month`/`scope`.
   - remplacer la fenêtre YTD figée par la fenêtre résolue, appliquer le filtre agent au périmètre `mine` quand `scope=all`.
   - ajouter un bloc `brokers` : classement complet par courtier sur la fenêtre (volume, dossiers, commissions, dossier moyen, BPS, part, YoY).
   - ajouter `availableAgents` (liste distincte des courtiers du registre) et `series` (points de tendance adaptés à la granularité).
   - la portée `all` reste conditionnée à `is_planipret_admin`.
3. `src/components/planipret/commissions/RegisterCommissions.tsx` : nouvelles props `scope` (`broker|admin`) et affichage conditionnel de la barre de filtres agent/granularité et de l'onglet « Courtiers ».
4. Nouveau `src/components/planipret/commissions/RegisterFilters.tsx` : sélecteurs année / granularité / période / agent (design 3D existant).
5. Nouveau `src/components/planipret/commissions/BrokerLeaderboard.tsx` : tableau classement courtiers + graphique barres top 10.
6. `src/pages/planipret/admin/PACommissions.tsx` : ajouter les onglets source (Registre 2022+ / Maestro / Interne), Registre par défaut, en conservant la restriction d'accès actuelle par courriel.
7. Aucune modification de schéma : `planipret_commission_register` et ses RLS couvrent déjà la lecture admin via la fonction Edge (service role + vérification `is_planipret_admin`).
