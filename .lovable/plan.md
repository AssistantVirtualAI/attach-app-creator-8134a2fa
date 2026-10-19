# Plan — Répondre par texto à un appel entrant

## Objectif
Sur un appel entrant, le courtier touche « Message », choisit un texte (« Je ne suis pas disponible », « Je suis en réunion », « Je vous rappelle », « Personnalisé… »). L'appel part à la boîte vocale et le client reçoit le texto depuis le numéro texto du courtier.

## Étape 0 — Vérifications avant tout code (aucune modification)
1. NetSapiens : confirmer qu'un appel refusé (decline/reject) va à la boîte vocale pour tous les courtiers (règles de réponse actuelles). Test sur le poste 113 seulement.
2. Lister les courtiers sans numéro capable d'envoyer des textos : pour eux, le bouton sera masqué.
3. Appels sans numéro affiché / numéros internes / courts : pas de texto, bouton masqué.
4. Ton accord explicite pour toucher au natif iPhone (CallKit/PushKit) et Android (FCM/notification d'appel).

## Étape 1 — Réglages des messages (portail + app, sans natif)
- Page Réglages > « Réponses rapides » : 3 messages par défaut modifiables + option personnalisée.
- Texte en français et anglais selon la langue du courtier, signature avec son nom.
- Stockage par courtier, lisible seulement par lui (droits existants).

## Étape 2 — Envoi côté serveur (une seule fonction)
- Nouvelle action « répondre par texto » : vérifie que l'appel appartient au courtier connecté, qu'il est bien entrant et récent (moins de 5 min), que le numéro client est valide.
- Envoi via le service de textos existant depuis le numéro texto du courtier, avec clé anti-doublon par appel (un seul texto par appel).
- Le texto apparaît dans Messages comme un envoi normal; l'appel garde son historique et la décision post-appel.
- Refus clair si aucun numéro texto : « Aucun numéro texto actif ».

## Étape 3 — App ouverte (iPhone et Android)
- Écran d'appel entrant de l'app : bouton « Message » à côté de Répondre/Refuser.
- Toucher → liste → choix → refus de l'appel (boîte vocale) puis envoi du texto.
- Confirmation « Texto envoyé » ou erreur visible; jamais de double envoi.

## Étape 4 — Android verrouillé / app fermée (natif, accord requis)
- Boutons rapides dans la notification d'appel entrant : « Message » ouvre la liste courte.
- Si l'envoi échoue, notification « Texto non envoyé — réessayer ».

## Étape 5 — iPhone verrouillé / app fermée (natif, accord requis)
- Apple ne permet pas d'ajouter un bouton à l'écran d'appel.
- Après un refus, notification « Répondre par texto ? » avec les 3 choix en actions directes (sans ouvrir l'app) + « Personnalisé… » qui ouvre l'app.
- Notification valable 10 minutes seulement.

## Étape 6 — Tests et release
- Tests automatiques : propriété de l'appel, anti-doublon, refus sans numéro texto, appel trop ancien, appel sortant refusé.
- Tests sur vrai téléphone (iPhone et Android) : app ouverte, verrouillé, app fermée, deuxième appel pendant un appel actif.
- Déploiement serveur seulement après ton feu vert; nouvelle version de l'app via Manus (compilation Xcode/Android Studio).

## Ordre de livraison proposé
1. Étapes 0 → 3 (pas de natif) : utilisable rapidement quand l'app est ouverte.
2. Étape 4 (Android) puis Étape 5 (iPhone) dans la prochaine release native.

## Détails techniques
- Serveur : nouvelle fonction `pp-call-quick-reply` (JWT, propriété appel via même logique que pp-call-handoff, envoi via pp-ns-sms, idempotency_key = call_id).
- Refus : action decline de l'appel côté app (PJSIP/CallKit) — aucune modification des règles de réponse NetSapiens.
- Messages : table par courtier avec RLS user_id, sans données client.
- Natif : Android = actions sur la notification FCM d'appel; iPhone = catégorie de notification locale après `CXEndCallAction` refusé.
- Hors périmètre : Lemtel, DID, extensions, crons, routage NetSapiens.
