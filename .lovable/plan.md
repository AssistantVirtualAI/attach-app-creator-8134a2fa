# Un seul appareil mobile connecté par courtier

## Objectif
Quand un courtier se connecte sur un nouvel appareil, l'ancien est détecté et déconnecté automatiquement. Il ne reste alors qu'un seul appareil inscrit sur la ligne `<poste>M`, ce qui met fin au double écran et aux coupures entre appareils (le cas de Megan).

## Comportement attendu
1. Le courtier se connecte sur le nouvel appareil.
2. Le serveur enregistre ce nouvel appareil comme « appareil actif » du courtier.
3. Il retire les jetons d'appel et de notification des anciens appareils, qui ne sonnent donc plus.
4. L'ancien appareil reçoit un signal « connecté ailleurs ». Il coupe sa ligne, se déconnecte et affiche : « Votre compte a été ouvert sur un autre appareil. »
5. Si l'ancien appareil est éteint ou hors ligne, il se déconnecte à sa prochaine ouverture : le serveur refuse sa session.
6. Le portail web et le widget (`<poste>x`) ne sont pas concernés. La règle vaut seulement pour l'app mobile.

## Protections
- Pendant un appel actif sur l'ancien appareil, la déconnexion attend la fin de l'appel. On ne raccroche jamais un appel en cours.
- Aucun historique, SMS, message vocal ni enregistrement n'est supprimé.
- Le DID, le poste, l'appareil NetSapiens et le routage ne changent pas.

## Étapes
1. **Serveur :** ajouter une table des appareils mobiles actifs (un seul par courtier) et une fonction qui, à la connexion :
   - marque le nouvel appareil comme actif ;
   - désactive les jetons d'appel et de notification des autres appareils, sans les supprimer ;
   - envoie le signal « connecté ailleurs ».
2. **Envoi des appels et alertes :** n'utiliser que les jetons de l'appareil actif.
3. **App mobile, partie web (dans les deux copies) :**
   - déclarer l'appareil à chaque connexion ;
   - écouter le signal ;
   - vérifier la session à chaque ouverture ;
   - arrêter proprement la ligne, puis se déconnecter localement.
4. **Nettoyage ciblé :** pour Megan (1117), ne garder actif que l'appareil le plus récent.
5. **Tests :**
   - A connecté, puis B se connecte : A est déconnecté et seuls les jetons de B restent actifs ;
   - A est en appel : la déconnexion attend la fin de l'appel ;
   - A est hors ligne : il est refusé à sa réouverture.

## Points nécessitant ton accord
- La gestion des jetons d'appel touche à la téléphonie (PushKit/FCM côté serveur). Elle nécessite ton accord explicite.
- Si l'arrêt de la ligne PJSIP sur l'ancien iPhone ne peut pas se faire depuis la partie web de l'app, un petit ajout natif sera nécessaire. Je l'expliquerai avant de le toucher.
- Il faudra une nouvelle version de l'app et un test sur deux vrais téléphones.
- Il n'y aura aucun déploiement ni publication sans ta demande.

## Détails techniques
- Une table `planipret_mobile_active_device` (user_id unique, device_id, activated_at), protégée par RLS. Les écritures passent seulement par une fonction serveur.
- Une colonne `revoked_at` sur `planipret_voip_push_tokens` et `mobile_push_tokens`. Les envois filtrent `revoked_at is null`.
- Le signal passe par un canal temps réel propre à chaque utilisateur. Un contrôle au démarrage et au retour au premier plan sert de repli.
- La déconnexion appelle `signOut({ scope: 'local' })` et coupe la ligne existante. Les autres sessions du portail restent intactes.
