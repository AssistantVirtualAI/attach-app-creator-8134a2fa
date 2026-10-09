# Commissions en attente (pending commissions)

## Ce qui sera ajouté
- **Portail (admin + courtier)** : sur la page Commissions existante, un bloc « Commissions en attente » avec chiffres clés (montant total en attente, nombre de dossiers, volume) et un graphique par mois, plus un tableau des dossiers.
- **App mobile** : même bloc dans l'écran Commissions et un chiffre « En attente » sur la carte commissions de l'accueil.
- Mêmes règles que les commissions actuelles : un courtier ne voit que ses dossiers; un admin voit tout ou filtre par courtier; mêmes filtres de dates; même mémoire hors-ligne si Maestro est indisponible.

## Étapes
1. Appeler l'adresse en lecture seule avec un vrai jeton pour confirmer la forme exacte des données (champs, pagination). Aucun champ ne sera inventé.
2. Ajouter l'action `pending` au client serveur partagé (même liste blanche de filtres, même gestion des erreurs 502/HTML, jeton jamais exposé).
3. Exposer l'action dans la fonction serveur commissions existante avec le même cadrage courtier/admin.
4. Ajouter le bloc chiffres + graphique dans le portail et dans les deux copies de l'app mobile (gardées identiques).
5. Tests : filtres, cadrage courtier, résumé, panne Maestro; vérification visuelle portail + mobile avec un vrai compte.

## Détails techniques
- `_shared/commission-reports.ts` : `buildPendingQuery`, `summarizePending`, chemin `/api/main/commissions/reports/pending-commissions`.
- `planipret-commission-reports` : action `pending` via `resolveCommissionScope`.
- Front : `RegisterCommissions`, `MCommissions`, `MCommissionCharts`, `CommissionHomeCard` (src/ et apps/planipret-mobile/src/), cache `commissionsCache` avec clé distincte.
- Aucun changement natif iOS/Android; visible après publication web.
