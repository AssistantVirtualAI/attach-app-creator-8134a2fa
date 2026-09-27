# Corriger la fermeture réelle des tâches Maestro

## Objectif
Faire en sorte que « Marquer terminée » ne confirme jamais une fermeture que Maestro n’a pas réellement enregistrée.

## Changements
- Utiliser uniquement le contrat de mise à jour officiellement exposé par Maestro, sans inventer d’identifiant de statut.
- Retirer l’envoi actuel de `status: "complete"`, ignoré par Maestro, et exposer une opération serveur explicite de clôture.
- Après chaque tentative, relire la tâche dans Maestro et exiger que son statut réel soit `complete` avant tout succès.
- Si Maestro conserve `pending`, afficher un échec clair, garder la tâche ouverte et ne jamais montrer « Tâche terminée ».
- Appliquer le même comportement au portail et à l’application mobile, sans toucher aux versions natives, à la téléphonie ou au polling.

## Validation
- Ajouter des tests couvrant une fermeture confirmée, une tâche toujours `pending`, une relecture absente et l’isolation par courtier.
- Exécuter les tests ciblés existants et vérifier que les autres modifications de tâches restent inchangées.
- Déployer ensemble la fonction backend et l’interface seulement après réussite complète des tests.

## Détail technique
Le PUT Maestro accepte `status_option_id` et `update_status`, mais sa documentation ne publie aucun identifiant global « Terminée ». La correction déterminera la valeur valide depuis les données de la tâche ou refusera proprement l’opération; elle n’utilisera ni identifiant codé en dur ni succès optimiste. La relecture GET demeure la source de vérité.
