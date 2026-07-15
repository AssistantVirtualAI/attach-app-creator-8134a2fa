Je vais corriger les 3 blocages visibles :

1. SMS
- Modifier `pp-ns-sms` pour envoyer au bon endpoint NS-API : `POST /messagesessions/messages` avec `destination`, au lieu de créer une session sans destination.
- Garder le fallback `thread_id` si NS exige l’envoi dans une conversation existante.
- Renvoyer une erreur lisible dans l’app au lieu de “Edge Function returned…”.

2. Appels
- Garder l’appel REST NS-API, mais améliorer le retour côté mobile : afficher clairement si l’appel est accepté, si le mobile SIP n’est pas enregistré, ou si NS refuse.
- Attacher l’appel REST retourné au softphone pour que l’écran d’appel s’ouvre et que raccrocher contrôle le bon `call_id`.
- Ajouter une tentative de reconnexion SIP juste avant fallback si le softphone n’est pas enregistré.

3. Microsoft
- Corriger le callback OAuth pour éviter l’erreur PKCE `code_verifier does not match`: lier le `code_verifier` au `state` OAuth pour ne pas réutiliser un ancien verifier.
- Si Microsoft dit déjà “connected” mais le webhook/setup échoue ensuite, ne pas casser l’écran : afficher connecté et signaler seulement la configuration secondaire en non-bloquant.
- Afficher les vrais détails d’erreur dans la page au lieu du message générique.

Validation
- Tester les fonctions `pp-ns-sms`, `pp-ns-calls` et `ms365-oauth-exchange` après changement avec les logs backend disponibles.
- Vérifier que l’app ne montre plus l’erreur générique de connexion quand le compte Microsoft est déjà relié.