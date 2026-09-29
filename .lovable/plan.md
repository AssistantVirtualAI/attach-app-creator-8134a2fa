# Consentement obligatoire après chaque appel

## Résultat attendu
- Après chaque appel **répondu** entrant ou sortant, afficher une feuille claire dès la fin de l’appel.
- Présenter exactement deux décisions : **Enregistrer l’appel** ou **Supprimer l’appel**.
- Empêcher la fermeture accidentelle par toucher hors de la feuille, retour système ou changement de page tant qu’aucune décision n’est enregistrée.
- Afficher le client, le numéro, le sens de l’appel et la durée pour éviter toute confusion.

## Fiabilité
- Attendre et réessayer brièvement si le dossier d’appel n’est pas encore arrivé lorsque l’appel se termine.
- Conserver localement l’appel en attente de décision et rouvrir la feuille au retour dans l’app ou après un redémarrage.
- Corréler la décision au bon identifiant d’appel; ne jamais choisir arbitrairement un autre appel récent.
- Ne pas demander de décision pour un appel refusé, manqué ou jamais connecté.
- Bloquer les doubles pressions et ne fermer la feuille qu’après confirmation du serveur.

## Portail et application
- Appliquer le même comportement dans le portail mobile et l’application mobile autonome.
- Garder l’envoi vers Maestro uniquement après **Enregistrer**.
- **Supprimer** efface l’enregistrement et les éléments dérivés selon le comportement serveur existant.

## Validation
- Ajouter des tests pour appels entrants/sortants, fin locale/distante, arrivée tardive du dossier, reprise après redémarrage, appels manqués et double pression.
- Vérifier l’affichage sur format téléphone et confirmer qu’aucune erreur de compilation ne reste.
