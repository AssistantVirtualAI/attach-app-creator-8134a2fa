# Écrans admin : requêtes trop lourdes qui expirent

Les journaux confirment 83 requêtes annulées par la base en ~70 secondes (délai dépassé), au moment d'un chargement d'écran. Les écrans admin chargent jusqu'à 20 000 lignes par requête, plusieurs en parallèle. Résultat : graphiques et tableaux vides ou en erreur.

## Correctifs proposés

1. Tableau de bord Lemtel : remplacer la lecture de 20 000 appels sur 30 jours par un comptage agrégé côté base (une fonction qui renvoie déjà les totaux par jour), et ramener les deux lectures de 2 000 lignes à des comptages.
2. Statistiques par courtier : agréger côté base les 20 000 activités et les 10 000 tâches au lieu de les rapatrier ligne par ligne.
3. Journal d'audit : supprimer la lecture de 10 000 lignes utilisée pour l'export et la remplacer par un export paginé (2 000 lignes par lot).
4. Aperçu courtier et écran Appels : plafonner à 1 000 lignes avec une fenêtre de date par défaut (90 jours) plutôt que 5 000 lignes sans borne.
5. Ajouter les index manquants sur les colonnes de date utilisées pour trier et filtrer ces tables.

## Détails techniques

- Nouvelles fonctions SQL en lecture seule (`security definer`, filtrées par organisation/courtier) pour les agrégats de tableau de bord et de statistiques.
- Index : `pbx_call_records(organization_id, start_at)`, `planipret_activity(occurred_at)`, `planipret_audit_log(created_at)`, `planipret_phone_calls(user_id, started_at)` si absents.
- Aucun changement de présentation : mêmes chiffres, mêmes tableaux.
