# Commissions : graphiques enrichis, vérification du jour, résumé et message pour Mansus

## 1. Graphiques commissions (déboursées et en attente)
- Déboursées : tendance mensuelle (aire), répartition par catégorie (anneau avec total central), top courtiers (barres horizontales, vue admin), comparaison année précédente.
- En attente : montant par mois (barres), répartition par type (anneau), dossiers vs volume (barres doubles), top courtiers (admin).
- Mobile : graphiques pleine largeur, légendes sous le graphique, mois abrégés, toucher pour voir la valeur, aucun débordement.
- Mêmes chiffres qu'aujourd'hui : aucun changement aux calculs, aux droits d'accès ou au cache. Copies portail et app identiques.
- Vérification visuelle : téléphone et ordinateur, admin et courtier, français et anglais.

## 2. Vérification de tout ce qui a été fait aujourd'hui
- Relire chaque correctif du jour : bascule app/widget (113x / 113M), avis widget, deuxième appel entrant, feuille de fin d'appel, défilement Messages, cache commissions.
- Relancer les tests existants et vérifier les journaux d'erreurs.
- Feedbacks du jour (Marc-Alexandre, deuxième appel qui coupe) : confirmer que le correctif est bien dans le code; noter clairement ce qui exige la nouvelle version iPhone et un test réel.
- Tout point incomplet sera corrigé ou listé avec la raison.

## 3. Résumé du jour (en français)
Liste simple : corrections, modifications, ajouts, et ce qui reste à tester après la mise à jour.

## 4. Message pour Mansus
- Liste des changements avec les fichiers touchés (natif iOS et web), les commits du jour à récupérer, les étapes de validation (compilation Xcode, tests, recette appels : 2e appel, Wi-Fi/LTE, bascule widget).
- Rappel : aucune soumission avant validation.
- Langue : français par défaut (dis-moi si tu le veux en anglais).

## Hors périmètre
Aucun changement aux numéros, au routage, aux textos, à Lemtel, aux crons ni au code natif pendant cette étape.

## Détails techniques
- Composants : `CommissionSections`, `PendingCommissionsCard`, `MCommissionCharts` (src/ et apps/planipret-mobile/src/), recharts, jetons visuels Planiprêt.
- Commits identifiés via `git log --since` du jour (lecture seule).
