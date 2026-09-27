# AVA (chat + voix) : tout faire dans l'app mobile

## Objectif
AVA, par écrit ou par la voix, peut gérer les tâches, montrer les commissions et contacter les clients. Elle demande toujours une confirmation avant d'agir.

## État actuel (vérifié)
- Déjà branché : lister, créer, modifier et supprimer une tâche; montrer un résumé des commissions; envoyer un SMS ou un courriel.
- Manque : une vraie action « terminer une tâche » ou « reporter une tâche », la liste détaillée des commissions et un appel complet et fiable par la voix.

## Ce qui sera fait
1. **Tâches**
   - « Termine la tâche X » : fermeture officielle dans Maestro, puis relecture pour vérifier. AVA dit « terminée » seulement si Maestro le confirme.
   - « Reporte la tâche X à demain / vendredi 14h » : AVA change la date d'échéance, puis relit la tâche pour vérifier.
   - « Mes tâches d'aujourd'hui / en retard » : AVA donne la même liste que l'écran Tâches.
   - AVA retrouve la tâche par son titre ou par le nom du client, pas seulement par son numéro. Si plusieurs tâches correspondent, elle demande laquelle.
2. **Commissions**
   - Un courtier voit toutes ses commissions : un total et la liste détaillée (client, montant, date, statut), sur la période demandée.
   - Un admin voit les commissions de tous les courtiers seulement quand l'accès admin Maestro sera fourni. D'ici là, il voit ses propres commissions.
3. **Appeler, texter, envoyer un courriel**
   - Le client est d'abord trouvé et son profil affiché, puis AVA demande une confirmation avant d'agir.
   - Appel : lancé depuis le téléphone de l'app, avec le numéro du courtier.
   - SMS : envoyé par NetSapiens depuis le numéro du courtier.
   - Courriel : envoyé depuis Outlook.
   - Aucune action n'est lancée sans un « Oui » du courtier.
4. **Voix identique au chat**
   - Le bot vocal utilise les mêmes outils et suit les mêmes règles de confirmation que le chat.
5. **Vérification**
   - Tests automatiques pour chaque action.
   - Test réel avec un compte courtier pour lister, terminer et reporter une tâche, et pour voir les commissions.
   - Appels et SMS réels seulement avec ton autorisation.

## Détails techniques
- `_shared/ava-tools.ts` : ajouter `complete_task` (soft-delete documenté + relecture GET), `reschedule_task` (PUT due_date + relecture) et `list_commissions` (détails, période, portée courtier ou admin); ajouter `place_call` si absent.
- `ava-tool-executor` : implémenter ces actions en réutilisant planipret-task-api et planipret-commission-reports, avec le même guard de rôle (courtier = ses données).
- `pp-ava-chat` : détecter l'intention (terminer, reporter, commissions), résoudre la tâche ou le client par son nom et afficher les boutons de confirmation. Ne jamais inventer de status_option_id.
- Voicebot : exposer les mêmes outils à l'agent vocal.
- Mobile : les cartes de confirmation dans MAvaChat existent déjà. Ajouter une mise à jour OTA seulement si l'affichage change. Aucune modification de la version native ni des protections téléphoniques.
- Déployer toutes les fonctions ensemble (aucune version partielle).
