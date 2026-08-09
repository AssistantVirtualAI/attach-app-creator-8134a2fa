# Overview courtier — insights IA + visuel 3D

Même traitement que la page Commissions, appliqué au tableau de bord Overview du portail courtier.

## 1. Insights IA (Claude)

Nouvelle fonction backend `pp-overview-insights` qui reçoit les métriques déjà agrégées de la période choisie (appels, manqués, taux de réponse, durée moyenne, textos, enregistrements, heures de pointe, top contacts, commissions) et renvoie :

- un résumé exécutif de 1-2 phrases
- 3 à 5 insights avec titre, constat chiffré, recommandation, badge de métrique et sévérité (positif / neutre / attention)
- catégories : performance, disponibilité, communication, clients, revenus

Bilingue FR/EN, aucune donnée personnelle envoyée (compteurs seulement, contacts anonymisés en initiales).

Le panneau se génère sur demande (bouton « Générer l'analyse » / « Régénérer ») et se réinitialise quand la période change.

## 2. Panneau d'insights visuel

Nouveau composant `OvInsights` placé juste sous la rangée de KPI :

- fond dégradé radial en verre, halo bleu/violet, ombre profonde
- cartes d'insight avec image 3D abstraite en en-tête (réutilisation des 4 visuels générés pour les commissions + 2 nouveaux : performance d'appels, disponibilité)
- badge métrique flottant, icône en pastille translucide
- clic sur une carte = déroulé animé de la recommandation
- états : vide (invitation à générer), chargement, erreur

## 3. KPI 3D

Refonte visuelle de `OvKpiRow` (contenu et chiffres inchangés) :

- carte en relief : dégradé subtil, bordure lumineuse par accent, ombre portée, léger soulèvement au survol
- pastille d'icône colorée par métrique
- mini-sparkline de la période derrière la valeur quand la série est disponible
- badge de variation avec pastille colorée (vert / rouge / neutre)

## 4. Graphiques embellis

Sans changer les données ni les sources :

- dégradés verticaux et lueur sur les aires et barres existantes (appels, messages, durée, enregistrements, commissions)
- grille plus discrète, infobulle sombre unifiée, coins arrondis sur les barres
- bande de progression « période vs période précédente » pour le volume d'appels
- panneaux de graphiques en style verre cohérent avec le panneau d'insights

## Détails techniques

- `supabase/functions/pp-overview-insights/index.ts` : nouvelle fonction, utilise `claudeText` de `_shared/anthropic.ts` (prompt caching), sortie JSON stricte validée côté serveur.
- `src/lib/planipret/overviewInsights.ts` : construction du payload de métriques + appel de la fonction, types partagés.
- `src/components/planipret/broker/overview/OvInsights.tsx` : nouveau panneau.
- `src/components/planipret/broker/overview/OvKpiRow.tsx` : refonte visuelle, même API `KpiCard` (ajout optionnel `accent` et `spark`).
- `src/components/planipret/broker/overview/OvCard.tsx` et les composants de graphiques : styles verre, dégradés, infobulle commune.
- `src/pages/planipret/broker/PBOverview.tsx` : état des insights, passage des métriques, insertion du panneau.
- 2 illustrations 3D supplémentaires dans `src/assets/overview/`.
- Aucun changement de schéma, de RLS ni de logique de données.
