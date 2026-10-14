# Contrôles de sessions clients Lemtel

> Le portail ne gère ici que l’éligibilité de la prochaine vérification serveur pour une **famille d’application**. Il ne stocke ni identifiant d’appareil, ni empreinte, ni adresse réseau, ni jeton, ni contenu d’appel ou de message.

| Commande | Autorisation | Effet | Limite explicite |
|---|---|---|---|
| Révoquer Mobile/Desktop/client | Owner ou admin actif de la même organisation | Le bootstrap autoritaire refuse cette famille au prochain contrôle; une nouvelle révision d’autorité est publiée. | N’éteint pas un appareil à distance, n’efface aucune donnée locale et ne touche pas la téléphonie. |
| Rétablir Mobile/Desktop/client | Owner ou admin actif de la même organisation | Le bootstrap autoritaire accepte de nouveau cette famille si membership et organisation sont actifs. | Ne crée aucune session et ne permet pas un compte sans Auth Lemtel valide. |

La session Mobile se réconcilie avec le bootstrap Lemtel; Desktop le relit au démarrage, au retour au premier plan et sur regain de focus. Ainsi, une révocation ne fait jamais confiance à une valeur de client mise en cache.
