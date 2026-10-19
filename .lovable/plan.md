# Widget : bons numéros pour Mélanie, Megan, Karl + supprimer une conversation texto

## 1. Widget (Mélanie 1064, Megan 1117, Karl 1142)
Constat vérifié : les trois sont liés à Maestro. Notre envoi au webhook de Scott ne contient que `user_id` + `external_user_id` (le poste) ; aucun numéro n'est envoyé. La cause exacte n'est pas encore confirmée.

Étapes :
1. Lecture seule : journal des envois (dernier envoi, statut HTTP) pour ces 3 courtiers, et comparaison poste/numéro entre notre portail et NetSapiens.
2. Ré-envoi forcé (sans anti-doublon) pour ces 3 courtiers seulement, avec leur poste actuel.
3. Si le widget affiche encore un mauvais numéro : il le lit chez NetSapiens/Maestro, pas chez nous. Courriel en anglais à Scott avec les 3 postes, les numéros attendus, et la question : faut-il ajouter le numéro au contrat `/sync` ? Aucun champ inventé ne sera ajouté sans sa confirmation.

## 2. Supprimer une conversation texto (app mobile + portail)
- Le bouton « Supprimer » existe déjà dans l'app (il masque la conversation sur cet appareil). On l'ajoute aussi dans le portail courtier (liste et en-tête de la conversation), avec confirmation.
- La conversation entière disparaît de la liste ; elle revient seulement si le client écrit à nouveau.
- Rien n'est effacé chez NetSapiens ni dans l'historique serveur (règle en place).

Question ouverte : veux-tu que la suppression suive le courtier sur tous ses appareils (portail + app) ? Ça demande un petit stockage serveur par courtier. Sinon, elle reste par appareil.

## Détails techniques
- Ré-envoi : `pp-widget-sync-all` avec liste d'IDs et `force`, ou `syncBrokerToWidget(..., {force:true})`.
- Portail : réutiliser `smsThreadState.ts` (déjà miroir) dans la page Messages du portail ; tests vitest (masquage, réapparition).
- Aucun changement : natif, routage DID, crons, Lemtel. Déploiement seulement sur ta demande.
