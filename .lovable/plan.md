# Correction des tâches et vue Maestro mobile

## Correctif portail
- Conserver les tâches déjà affichées lorsqu’une actualisation Maestro échoue.
- Afficher l’erreur réseau comme un avertissement non bloquant avec « Réessayer », sans remplacer les détails ouverts.
- Réserver l’écran d’erreur complet au cas où aucune tâche connue n’est disponible.

## Vue Maestro mobile
- Rendre la vue Maestro existante accessible dans l’application mobile autonome et dans le menu Plus.
- Regrouper dans cette vue les appels, tâches et commissions du courtier.
- Réutiliser les écrans et données existants, sans créer de liste Maestro globale non documentée ni ajouter de polling.
- Maintenir la copie portail et la copie mobile autonome alignées.

## Vérification
- Ajouter une régression couvrant une panne d’actualisation après affichage des tâches.
- Vérifier les routes et les onglets Maestro sur le portail mobile et l’application autonome.
- Exécuter les tests ciblés du flux tâches.

## Limites des vérifications Sandra
- La connexion Maestro personnelle, un appel réel et la création d’une tâche exigent sa session et son appareil.
- Le correctif sera vérifié avec les tests et les données accessibles; les gestes personnels restants seront indiqués clairement.
