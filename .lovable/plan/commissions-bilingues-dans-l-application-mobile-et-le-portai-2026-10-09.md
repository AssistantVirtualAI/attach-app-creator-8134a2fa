# Commissions bilingues dans l’application mobile et le portail

## Objectif

Donner aux courtiers une page Commissions mobile clairement divisée entre **En attente** et **Déboursées**, avec les mêmes rapports colorés, tableaux, graphiques et filtres que le portail, entièrement en français et en anglais.

## Mise en œuvre

1. **Séparer les deux rapports dans l’application mobile**
   - Ajouter en haut de la page deux onglets persistants : **En attente / Pending** et **Déboursées / Paid**.
   - Afficher un seul rapport à la fois pour faciliter la lecture sur téléphone.
   - Conserver les deux sources Maestro strictement séparées : `pending` pour l’attente, `summary`/`deposits`/`analytics` pour les déboursées.
   - Garder chaque courtier limité à ses propres données; les contrôles globaux restent réservés aux administrateurs.

2. **Aligner les rapports mobiles sur le portail**
   - En attente : indicateurs officiels, catégories, répartition personnel/équipe, tendance mensuelle, graphiques colorés et tableaux adaptés au petit écran.
   - Déboursées : vue d’ensemble, prêteurs, dépôts, tendance mensuelle et trimestrielle, comparaison avec l’année précédente et tableaux colorés.
   - Ajouter les vues détaillées utiles déjà offertes au portail : courtiers/équipe selon l’accès, prêteurs, types, périodes, dossiers et contrôle des écarts.
   - Réutiliser la même palette et les mêmes périodes et filtres : mois, trimestre, cumul annuel, année et période personnalisée.
   - Préserver les dernières données visibles lorsqu’une source Maestro est temporairement indisponible; ne jamais transformer une erreur en total nul.

3. **Compléter le bilinguisme**
   - Traduire les onglets, filtres, erreurs, états vides, titres, légendes, tableaux, détails et messages administrateurs dans les deux langues.
   - Corriger les messages mobiles encore uniquement en français.
   - Corriger aussi les libellés et exports encore figés dans les sous-rapports du portail : dossiers, matrice annuelle, classement, détail courtier, rapprochement, validation et vue mobile détaillée.
   - Vérifier toute la page Commissions du portail — administrateur et courtier — en français et en anglais, incluant les rapports mensuels et trimestriels.

4. **Maintenir la parité des deux versions web mobiles**
   - Appliquer la même présentation et les mêmes libellés dans le portail mobile et dans le code web embarqué par l’application Planiprêt.
   - Ne modifier aucun code natif iOS ou Android et ne publier aucune version partielle.

5. **Vérification**
   - Ajouter des tests couvrant le changement En attente/Déboursées, le périmètre courtier, les deux langues et l’indépendance des erreurs entre sources.
   - Tester les tableaux et graphiques sur largeur mobile sans chevauchement ni débordement.
   - Ouvrir le portail en français puis en anglais, comme administrateur et comme courtier lorsque la session le permet, et confirmer que les montants ne deviennent jamais 0 lors d’une erreur.
   - Vérifier la compilation et les tests ciblés; aucune publication tant que les deux arbres mobiles ne sont pas synchronisés.

## Détails techniques

- La page mobile actuelle affiche les déboursées puis les commissions en attente dans une longue page; elle sera transformée en panneaux séparés.
- Le portail possède déjà la séparation par statut et les rapports déboursés mensuels/trimestriels; ces modèles serviront de référence visuelle et fonctionnelle.
- Les montants restent ceux des réponses Maestro. Le travail ne modifie ni les calculs financiers ni les endpoints.