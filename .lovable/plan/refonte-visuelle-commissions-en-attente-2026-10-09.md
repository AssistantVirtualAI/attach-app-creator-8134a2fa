# Refonte visuelle — commissions en attente

## Résultat attendu
- Transformer le bloc actuel en un tableau de bord clair et soigné dans le portail et l’application mobile iOS/Android.
- Conserver les données, filtres, droits d’accès et calculs actuels : l’admin voit tous les courtiers; chaque courtier voit uniquement ses commissions.

## Portail administrateur
- Présenter en tête le montant total en attente, le nombre de dossiers, le volume hypothécaire et le nombre de courtiers concernés.
- Ajouter un graphique mensuel lisible et une répartition visuelle par type de commission.
- Refaire le tableau des courtiers avec recherche, tri, rang, montant, dossiers, volume et part du total.
- Permettre de sélectionner un courtier depuis le filtre ou le tableau pour afficher son détail, puis revenir facilement à la vue globale.
- Ajouter des états de chargement, vide et indisponible propres, sans faire disparaître les dernières données mémorisées.

## Portail courtier
- Afficher une synthèse personnelle simple : montant total, dossiers, volume et ventilation par type.
- Ajouter un graphique mensuel et un tableau détaillé des périodes/types disponibles, sans exposer les autres courtiers.
- Employer des libellés simples en français et en anglais.

## Application mobile iOS et Android
- Adapter les mêmes informations à l’écran étroit : chiffres clés compacts, graphique tactile et tableau transformé en rangées lisibles sans débordement horizontal.
- Pour les admins, conserver recherche, filtre et sélection d’un courtier; pour les courtiers, montrer uniquement leur vue personnelle.
- Garder les deux copies web/mobile identiques et utiliser uniquement les jetons visuels Planiprêt existants.

## Vérifications
- Tester les vues admin globale, admin filtrée et courtier avec de vraies données de commissions en attente.
- Vérifier le français/anglais, les états vides, la mémoire hors-ligne et les tailles téléphone/ordinateur.
- Vérifier visuellement qu’aucun texte, tableau, filtre ou graphique ne déborde.

## Détails techniques
- Recomposer `PendingCommissionsCard` en sous-sections réutilisables : résumé, graphique mensuel, répartition, classement admin et détail courtier.
- Réutiliser l’action serveur `pending` et le cache existants; aucun changement aux secrets, aux règles de portée ou aux calculs Maestro.
- Aucun changement au code natif iOS/Android et aucune publication pendant cette étape.
