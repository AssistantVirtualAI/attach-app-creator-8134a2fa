# Commissions — visuel 3D, KPI enrichis et insights IA (Claude)

## Objectif
Rendre la page Commissions du portail courtier entièrement prête pour les données Maestro, avec un rendu visuel haut de gamme (effets 3D/glass), plus de graphiques, et un panneau d'insights généré par Claude, illustré par des images.

## Ce qui sera fait

### 1. Robustesse des données Maestro
- Élargir la normalisation des dossiers dans `pp-maestro-commissions` : plus d'alias de champs (montant, commission, prêteur, produit, terme, statut, date), filtrage des dossiers non financés, tolérance aux formats de date.
- Ajouter des sections manquantes utiles au dashboard : mensuel (12 mois CY vs PY), statut du pipeline, top clients, taux moyen/bps.
- Retourner des métadonnées de synchronisation (nombre de dossiers, dernière date, période couverte) déjà affichées par la page.

### 2. Nouveaux graphiques et KPI
Dans `CommissionDashboard` (mode Maestro et interne) :
- Rangée KPI enrichie : volume, dossiers, commission, commission moyenne/dossier, bps moyen, taille moyenne de prêt, meilleur prêteur, progression YoY.
- Courbe mensuelle empilée CY vs PY avec dégradés.
- Barres 3D horizontales (top prêteurs) avec dégradé + ombre.
- Donut produit/terme avec anneau lumineux et centre KPI.
- Radar de mix de prêteurs, et « funnel » de pipeline si les statuts sont présents.
- Barre de progression annuelle (objectif implicite = année précédente).

### 3. Visuel « 3D » époustouflant
- Panneaux en verre : dégradés, halos colorés, ombres profondes, léger tilt/parallax au survol.
- Cartes KPI avec profondeur (bordure lumineuse, reflet, compteur animé).
- Dégradés SVG et ombres portées dans les graphiques Recharts (pas de nouvelle librairie 3D lourde).
- Respect strict des tokens `--pp-*` et du thème clair/sombre du portail courtier.

### 4. Insights IA (Claude)
- Nouvelle edge function `pp-commissions-insights` utilisant `claudeText()` de `_shared/anthropic.ts` (jamais de fetch brut vers Anthropic).
- Entrée : agrégats déjà calculés (aucune donnée client sensible superflue). Sortie JSON : 3–5 insights (titre, constat, recommandation, sévérité) + résumé exécutif.
- Panneau « Insights IA » en haut de page : cartes avec icône, badge de tendance, et bouton de régénération.
- Chaque insight est illustré par une image générée (bannière/vignette) stockée dans `src/assets`, associée par catégorie (croissance, prêteurs, produits, risque, saisonnalité).

### 5. Détails techniques
- Fichiers touchés : `supabase/functions/pp-maestro-commissions/index.ts`, nouvelle `supabase/functions/pp-commissions-insights/index.ts`, `src/lib/planipret/commissionStats.ts` (nouveaux agrégats + appel insights), `src/components/planipret/commissions/CommissionDashboard.tsx`, nouveaux composants `CommissionInsights.tsx` et `Commission3DPanels.tsx`, images sous `src/assets/commissions/`.
- Aucun changement de schéma DB ; la source « données internes » continue de fonctionner à l'identique.
- Accès inchangé : courtier voit ses propres données, admin la vue globale.
