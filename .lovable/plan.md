# Relais SMS d’AVA vers Marc

## Comportement demandé
- Garder le pilote uniquement sur la ligne de Marc, sans activer AVA SMS pour les autres courtiers.
- Quand Marc ouvre l’application ou revient au premier plan, arrêter les réponses automatiques d’AVA à tous ses clients, y compris les réponses déjà préparées mais non envoyées.
- Quand Marc quitte l’application ou la met en arrière-plan, AVA reprend les conversations non reprises personnellement par Marc.
- Dès que Marc envoie lui-même un message à un client, cette conversation reste sous son contrôle : AVA n’y répond plus automatiquement, même après la fermeture de l’application. Prévoir une action explicite pour la rendre à AVA.

## Résumé et notification
- Après chaque échange traité par AVA, conserver un résumé actualisé : identité vérifiée, demande, réponses données, rendez-vous convenus et prochaines actions. Lire l’historique disponible et signaler toute lecture incomplète, sans prétendre avoir tout lu.
- Envoyer une notification directe au téléphone de Marc avec un texte discret, sans renseignements clients sur l’écran verrouillé. Le résumé détaillé s’ouvre seulement dans sa session authentifiée.
- À l’ouverture, présenter les nouveaux relais et préparer une introduction vocale chaleureuse : « Hey Marc, je viens de discuter avec [nom vérifié]. Voici le résumé de notre échange; tu peux reprendre la discussion. » Ne pas inventer un nom ni utiliser Mohamad Hassoun comme donnée de démonstration.
- Utiliser la voix AVA existante; une lecture bloquée par le téléphone reste disponible par une commande de lecture. Ne pas répéter le même accueil à chaque ouverture, ni lire par-dessus un appel en cours.

## Détails techniques
- Ajouter un état serveur persistant, appartenant au courtier : sessions au premier plan, conversations reprises et résumés versionnés. Contrôles d’accès stricts; aucun destinataire de notification choisi par le navigateur.
- Signaler ouverture/premier plan/arrière-plan par événements authentifiés, sans nouveau minuteur ni interrogation périodique. Si plusieurs sessions sont ouvertes, conserver la pause tant qu’une session reste active.
- Vérifier la pause avant le traitement, les actions automatiques et l’envoi final; appliquer le même garde aux approbations et aux réponses préparées. Sérialiser reprise/envoi pour empêcher une réponse d’AVA après une reprise confirmée.
- Marquer la reprise depuis l’envoi humain authentifié existant; reconnaître les messages humains observés chez le fournisseur sans confondre une réponse d’AVA avec celle de Marc. Ne pas considérer une simple acceptation SMS comme une livraison.
- Réutiliser les envois SMS, notifications et synthèse vocale existants; conserver signatures, idempotence, restrictions du pilote et validations de sécurité. Ne pas modifier les protections AVA sans rapport avec ce relais.

## Vérifications
- Tests : ouverture coupe toutes les conversations; fermeture reprend seulement les autres; message humain bloque durablement son fil; plusieurs sessions; réponse en attente bloquée; doublons de notification/accueil; accès d’un autre courtier refusé; historique incomplet signalé.
- Exécuter les tests de protection AVA et vérifier le parcours authentifié dans le portail/mobile web, sans envoyer de SMS à de vrais clients.
- Vérifier séparément sur téléphone réel la notification, le retour à l’application, la lecture vocale et le silence d’AVA après reprise, une fois la mise à jour autorisée.

## Limites et activation
- Une fermeture forcée ou une perte réseau peut empêcher le signal de fermeture : conserver alors la pause et montrer une reprise explicite, plutôt que supposer Marc absent.
- Préparer les changements et la migration nécessaire; ne pas modifier la base active, déployer ni publier sans autorisation explicite.
- L’application installée se trouve dans un dépôt distinct : aucun changement iOS/Android, workflow, secret ou lancement de compilation dans ce travail. Son intégration et sa mise à jour nécessitent une autorisation distincte.