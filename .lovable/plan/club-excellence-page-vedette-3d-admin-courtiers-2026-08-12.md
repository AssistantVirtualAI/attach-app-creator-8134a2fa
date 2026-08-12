# Club Excellence — page vedette 3D (admin + courtiers)

Objectif : faire de l'onglet Club Excellence la plus belle page des commissions, marquée d'une étoile, affichant le classement complet de tous les courtiers, avec des graphiques 3D partout.

## Ce qui change pour l'utilisateur

### 1. Onglet vedette
- L'onglet « Club Excellence » reçoit une étoile dorée et un style distinct (dégradé doré, léger relief) dans la barre d'onglets, côté admin et côté courtier.

### 2. Podium et classement complet
- En-tête « hero » de saison : bandeau dégradé avec le nom de la saison (1 août → 31 juillet), le total du club, le nombre de courtiers et le nombre de dossiers.
- Podium 3D top 3 : trois blocs en perspective (or / argent / bronze) avec volume, dossiers, commission et variation vs saison précédente.
- Classement complet de tous les courtiers : table 3D en relief, lignes alternées, badges de rang, mini-barres de progression du volume, colonne « part du club en % », mise en évidence de la ligne du courtier connecté.
- Côté admin : clic sur une ligne ouvre le panneau de détail courtier déjà existant.

### 3. Résultats de tous les courtiers côté courtier
Aujourd'hui, un courtier connecté ne voit que ses propres lignes du registre, donc le classement du club n'affiche que lui-même. Le classement sera calculé côté serveur pour tous les courtiers, puis renvoyé au courtier avec : rang, nom, volume, dossiers, commission, BPS, variation. Le courtier voit donc le club complet et sa position dedans, sans accéder au détail des dossiers des autres.

### 4. Graphiques 3D
- Volume mensuel de la saison (août → juillet) en barres 3D cylindriques avec ombrage au sol.
- Courbe cumulée de la saison vs saison précédente (aire dégradée avec profondeur).
- Comparatif des 4 dernières saisons : volume, dossiers, commission en barres 3D groupées.
- Répartition du volume du club par courtier : donut 3D avec relief et légende lisible.
- Radar des indicateurs (volume, dossiers, commission, BPS, dossier moyen) : courtier vs moyenne du club.
- Tous les graphiques utilisent le même moteur 3D et le même réglage d'intensité déjà en place sur la page Vue d'ensemble, avec tooltips et légendes lisibles.

### 5. Notes et lecture
- Bloc de notes expliquant la période Club Excellence, la déduplication du volume, la source des données et la date du dernier import.
- Bloc d'indicateurs clés de saison (volume, dossiers, commission, BPS, dossier moyen, rang) avec micro-variations.

### 6. Harmonisation 3D du reste de la page commissions
Les graphiques des onglets Vue d'ensemble, Tendance, Prêteurs, Mix, Trimestres et Stats par période reprennent le même rendu 3D et la même palette, pour une page homogène.

## Détails techniques

- Nouveau composant `src/components/planipret/commissions/ClubExcellencePanel.tsx` : hero de saison, podium, classement, graphiques, notes. Il reçoit `data.club`, `data.clubMonthly`, `data.seasons`, `data.season`.
- Nouveaux graphiques 3D basés sur les utilitaires existants `src/components/planipret/broker/overview/ov3dChart.tsx` et `ov3d.tsx`, plus le hook `useOv3dIntensity`.
- `RegisterCommissions.tsx` : ajout de l'icône étoile et du style vedette sur l'onglet, remplacement du bloc `tab === "club"` par le nouveau composant, application du wrapper 3D (`ov3d-stage`) aux autres onglets.
- `supabase/functions/pp-commission-stats/index.ts` : en `scope: "self"`, calculer `club`, la part de club et les agrégats de saison sur l'ensemble du registre (lecture service role côté fonction), tout en gardant les tables détaillées limitées au courtier. Ajout de `clubTotals` (volume, dossiers, commission du club) et de `clubAverages` pour le radar.
- Aucune modification du schéma de base de données ; aucune donnée détaillée d'autres courtiers exposée aux courtiers (seuls les agrégats de classement).
