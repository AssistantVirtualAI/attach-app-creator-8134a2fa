# Refonte visuelle — Commissions (Admin + Courtier)

Objectif : rendre les pages Commissions nettement plus belles et beaucoup plus graphiques, onglet par onglet, sans changer la logique de calcul ni les données.

## Constat actuel

Les deux pages partagent le même composant (`RegisterCommissions`) : 11 onglets rendus en simples boutons texte, des cartes plates, et des graphiques Recharts bruts (axes gris, tooltips par défaut, pas de dégradés). Les composants 3D existants (`Chart3D`, `ov3d`, mode Haute lisibilité) ne sont utilisés que sur la page Vue d'ensemble.

## Ce qui change

### 1. En-tête et coquille de page
- Bandeau héros dégradé (aurora) propre à Commissions : titre, période active, 3 chiffres clés (volume, dossiers, commission) en très grand avec variation vs N-1.
- Barre de filtres regroupée dans une carte flottante « sticky » qui reste visible au défilement.
- Onglets transformés en pilules segmentées avec icône, compteur, indicateur actif animé, et défilement horizontal sur mobile.

### 2. Langage graphique commun
- Palette de séries unifiée (bleu marque, sarcelle, ambre, violet) avec dégradés verticaux, coins arrondis sur les barres, courbes lissées et zones translucides.
- Tooltip personnalisé unique : titre, valeurs formatées CAD, écart vs période précédente, part du total.
- Axes discrets, grille pointillée légère, légendes compactes cliquables (masquer/afficher une série).
- Chaque graphique passe par `Chart3D` : montage paresseux au scroll, repli 2D automatique, respect du mode Haute lisibilité et de « réduire les animations ».

### 3. Onglet par onglet
- **Vue d'ensemble** : rangée de 4 KPI en relief avec sparkline intégrée, puis grille bento (grand graphique combiné volume/commission + 3 cartes secondaires) au lieu de la pile actuelle.
- **Courtiers** : podium plus spectaculaire (hauteurs de marches, reflets), matrice année/courtier avec dégradé de chaleur affiné et mini-barres dans les cellules.
- **Tendance** : aire empilée avec repères d'année, moyenne mobile, et sélecteur mensuel/trimestriel.
- **Prêteurs** : barres horizontales classées avec logo/pastille et part de marché, plus un donut de concentration.
- **Mix produits** : donuts jumelés avec centre chiffré et légende détaillée.
- **Trimestres** : barres groupées par année avec étiquettes de croissance.
- **Stats par période / Dossiers / Écarts / Couverture / Correspondances** : tableaux modernisés (en-têtes collants, lignes zébrées, puces d'état colorées, densité réglable) et cartes de résumé au-dessus.
- **Club Excellence** : traitement premium or/noir avec jauge de progression vers le prochain palier.

### 4. Portail courtier
Mêmes composants, mais version personnelle : héros au nom du courtier, KPI « mes résultats » avec rang dans l'entreprise, et masquage des onglets réservés à l'admin. Respect des jetons `.planipret-broker-scope` (thème mobile) et du contraste en mode clair et sombre.

### 5. États vides et chargement
Squelettes animés à la forme des graphiques, et états vides illustrés avec message d'action au lieu d'un cadre vide.

## Détails techniques

- Nouveaux fichiers : `commissions/ui/CommissionsHero.tsx`, `CommissionsTabs.tsx`, `ChartFrame.tsx` (titre + info-bulle + actions + `Chart3D`), `chartTheme.ts` (couleurs, dégradés, axes, tooltip commun), `CommissionsSkeleton.tsx`.
- `RegisterCommissions.tsx` : remplacement du balisage de présentation par ces composants, onglet par onglet. Aucun changement aux requêtes, aux filtres persistés, au drill-down, aux exports CSV/PDF ni aux fonctions edge.
- Couleurs uniquement via les jetons existants (`--pp-*`, `.planipret-broker-scope`) — aucune couleur codée en dur dans les composants.
- Vérification navigateur onglet par onglet (captures) en clair, sombre, mode Haute lisibilité et largeur mobile avant livraison.
