# Fiabiliser les notifications et appels iPhone

## Problème confirmé
Les trois chemins Apple créent actuellement un nouveau jeton à chaque envoi : notifications visibles, réveils silencieux et appels entrants VoIP. Aucun cache existant ne les protège. Les journaux récents consultés ne contiennent plus l’erreur citée, mais le défaut de génération est toujours présent dans le code.

Le problème mplanipret est déjà corrigé et vérifié : une panne réseau conserve la session, affiche Réessayer et ne donne pas accès avant validation. Le retour aux appels a été testé avec votre session réelle.

## Correction proposée
- Réutiliser le même jeton Apple pendant environ 40 minutes pour les trois types d’envoi.
- Partager cette réutilisation entre les serveurs, y compris après un redémarrage ou lors d’envois simultanés ; un cache local seul ne couvre pas ces situations.
- Garder les clés privées et les jetons exclusivement côté serveur, sans accès depuis le portail ou l’application.
- Ne modifier ni les versions iOS/Android, ni les numéros, ni le routage, ni Lemtel.

## Détails techniques
- Ajouter un module APNs partagé, utilisé par `_shared/native-push.ts`, `_shared/sip-wake-push.ts` et `ns-webhook-receiver/index.ts`.
- Ajouter un cache persistant réservé au service serveur, protégé par RLS et sans privilège pour les rôles publics ou connectés.
- Identifier les entrées par équipe/clé et empreinte cryptographique de la clé normalisée, sans enregistrer la clé privée dans le cache.
- Sérialiser le renouvellement avec une réservation atomique de courte durée ; publier uniquement le jeton du détenteur de la réservation. Les autres requêtes réutilisent le jeton valide ou attendent brièvement. Ne pas générer chacun un jeton de repli en cas d’indisponibilité du cache.
- Utiliser aussi un cache local et une promesse partagée pour éviter les lectures et signatures répétées dans un même serveur. Invalider au changement de clé et ne jamais utiliser un jeton expiré.
- Livrer la migration avant les trois fonctions dépendantes et vérifier chaque chemin ; aucune publication web ni version magasin.

## Vérifications
- Tester la réutilisation sur envois successifs et simultanés, plusieurs serveurs, expiration, changement de clé et échec de renouvellement.
- Vérifier qu’aucun navigateur ne peut lire le cache et qu’aucun journal ne contient de clé ou jeton.
- Vérifier les trois fonctions après livraison, puis effectuer un appel iPhone réel convenu avec vous et contrôler les journaux Apple. Ne pas annoncer une sonnerie confirmée sans cet essai.

## Résultat attendu
Les trois chemins cessent de renouveler les jetons à chaque message. La sonnerie et la livraison effectives resteront à confirmer sur iPhone réel ; les autres erreurs Apple, notamment TopicDisallowed, ne sont pas couvertes par ce correctif.