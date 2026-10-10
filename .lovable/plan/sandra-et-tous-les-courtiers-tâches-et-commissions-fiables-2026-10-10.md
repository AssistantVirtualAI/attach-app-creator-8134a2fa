# Sandra et tous les courtiers — tâches et commissions fiables

## Objectif
Faire en sorte que chaque courtier voie ses propres tâches Maestro et les mêmes chiffres de commissions dans le portail et l’application mobile, avec un rapprochement vérifiable avant affichage.

## Constat vérifié
- Le profil de Sandra est actif et connecté à Maestro, mais contient deux identifiants différents : **93135** pour son compte courtier et **97194** pour la téléphonie.
- La projection serveur contient **4 105 tâches actives** pour Sandra; **4 104** sont assignées à **93135** et une à **97194**. Les données existent donc, mais la résolution d’identité doit empêcher tout mélange entre l’identifiant courtier et l’identifiant téléphonique.
- Les tâches du portail et du mobile utilisent déjà les mêmes fichiers, mais la lecture essaie plusieurs identifiants et peut conserver une réponse vide avant d’atteindre l’identité assignée correcte.
- Les commissions déboursées utilisent bien les dépôts historiques et les commissions en attente leur endpoint distinct. Sandra est filtrée avec **93135** dans ces rapports.
- Le rapprochement connu des déboursées de Sandra reste ouvert : la référence Maestro fournie est **1 368 881,05 $**, tandis que les lignes actuellement collectées totalisent **1 369 382,91 $**, soit **501,86 $** d’écart. Aucun montant ne sera figé ni remplacé manuellement.

## Travaux
1. **Corriger l’identité des tâches**
   - Séparer explicitement l’identifiant courtier Maestro de l’identifiant téléphonique.
   - Utiliser l’identifiant d’assignation Maestro vérifié pour lister, filtrer, créer et relire les tâches.
   - Ne jamais accepter une liste vide provenant du mauvais identifiant si une autre identité vérifiée contient les tâches.
   - Réparer la tâche isolée assignée au mauvais identifiant seulement après lecture Maestro et confirmation de sa portée.

2. **Fiabiliser les tâches pour tous les courtiers**
   - Généraliser la résolution par profil/courriel Maestro, avec refus sécurisé en cas d’identité ambiguë.
   - Conserver la projection comme secours sans masquer une erreur de synchronisation.
   - Ajouter des diagnostics sans données sensibles : identité utilisée, source Maestro/projection, nombre de tâches et fraîcheur.

3. **Rapprocher les commissions**
   - Rejouer séparément les deux sources pour Sandra sur la même période et comparer en cents : lignes, catégories, pagination, ajustements, contrats uniques et volume.
   - Identifier précisément les lignes produisant l’écart de **501,86 $** avant toute modification de calcul.
   - Appliquer la correction à l’engin partagé afin que portail et mobile utilisent exactement les mêmes unités, volumes, prêteurs et commissions.
   - Étendre le contrôle à tous les courtiers; une source incomplète ou en erreur doit afficher un avertissement, jamais zéro.

4. **Parité portail/mobile et sécurité**
   - Garder les deux versions web mobiles identiques et bilingues.
   - Préserver les portées serveur : un courtier voit uniquement ses données; les administrateurs peuvent sélectionner un courtier ou la vue globale.
   - Ne modifier aucun code natif iOS/Android et ne jamais exposer de jeton ou secret.

5. **Validation finale avant livraison coordonnée**
   - Tester Sandra dans son propre contexte courtier : tâches ouvertes, filtres, création/lecture, commissions en attente et déboursées.
   - Vérifier au moins un autre courtier et la vue administrateur globale.
   - Comparer les mêmes périodes dans le portail et le mobile, puis exiger une égalité exacte des agrégats.
   - Ajouter les tests de non-régression pour la double identité, les listes vides, les deux endpoints et les filtres de courtier.
   - Ne rien publier partiellement; livrer uniquement lorsque tâches et commissions sont validées ensemble. Si le rapprochement Maestro exige un export absent, bloquer la publication et nommer exactement le document requis.

## Détails techniques
- Centraliser la résolution d’identité Maestro par usage : CRM/commissions, assignation des tâches et téléphonie.
- Conserver les calculs financiers déterministes comme autorité; le contrôle IA reste consultatif.
- Vérifier les politiques d’accès et droits existants des projections et historiques pendant le test, sans élargir l’accès aux données personnelles.
