## Ce que la base dit (vérifié)

Le token Maestro **est bien enregistré** : `planipret_profiles` du compte utilisé contient `maestro_broker_token`, `maestro_connected = true`, `maestro_broker_id = 67`, `maestro_email`, expiration au 2026-07-29, `maestro_oauth_client = mobile` (dernier sync aujourd'hui 05:24 UTC). Aucune ligne `maestro_oauth_error` ni `maestro_oauth_pending` n'existe.

Donc l'échange de code fonctionne : le problème est **côté lecture du statut / rafraîchissement de l'écran**, pas côté connexion. La cause exacte n'est pas encore confirmée (les logs de `maestro-oauth-status` ne sont pas récupérables) — le plan commence donc par rendre le statut réel visible.

## Étape 1 — Rendre le statut brut visible (diagnostic dans l'app)

Dans `MaestroConnectCard.tsx` (affichée dans `MMore.tsx`, page Réglages) :
- Bouton « Rafraîchir » explicite + horodatage du dernier fetch.
- Bloc dépliable « Détails » affichant la réponse JSON brute de `maestro-oauth-status` (status, configured, broker_id, email, expires_in, last_error) — pour voir immédiatement si le serveur répond `connected`, `disconnected`, une erreur d'auth, ou rien.

## Étape 2 — Corriger la résolution d'utilisateur dans `maestro-oauth-status`

La fonction identifie le courtier via un client créé avec `SUPABASE_ANON_KEY` + header Authorization puis `auth.getUser()`. C'est exactement le schéma qui a déjà échoué en 401 dans ce projet (corrigé récemment dans `pp-ns-users`). Si `userId` reste `null`, la fonction retombe sur les secrets globaux (vides) et renvoie `disconnected` — statut « Non connecté » alors que le token existe.

Correctif :
- Valider le JWT avec le client service-role : `admin.auth.getUser(token)`.
- Considérer connecté si `maestro_broker_token` **ou** `maestro_connected = true`.
- Renvoyer aussi `connected: true`, `broker_id`, `email` (noms que la carte lit déjà) et un champ `reason` quand non connecté (`no_session`, `no_token`, `not_configured`).
- Redéployer la fonction.

## Étape 3 — Rafraîchissement fiable au retour du deep link

- `MaestroCallback.tsx` : après un échange réussi, écrire un flag court (`pp_maestro_just_connected`) avant de naviguer vers `/mplanipret/more`.
- `MaestroConnectCard` : si le flag est présent (ou après l'événement `maestro:connected`), lancer un court polling du statut (par ex. 0s / 1.5s / 4s / 8s) puis effacer le flag — évite d'afficher « Non connecté » si la lecture arrive avant l'écriture serveur.
- Ajouter un listener Capacitor `appStateChange` (resume) en plus de `visibilitychange`/`focus`, car sur iOS le retour du `Browser` plein écran ne déclenche pas toujours `visibilitychange`.
- Bandeau d'état clair : Connecté (vert, avec email + ID courtier) / En attente / Non connecté / Erreur avec message serveur.

## Détails techniques

- Fichiers touchés : `apps/planipret-mobile/src/components/planipret/mobile/MaestroConnectCard.tsx`, `apps/planipret-mobile/src/pages/planipret/MaestroCallback.tsx`, `supabase/functions/maestro-oauth-status/index.ts`.
- Aucune migration DB nécessaire ; les colonnes utilisées existent déjà.
- Après implémentation : `git pull`, `cd apps/planipret-mobile && npm run ios:build-sync`, rebuild Xcode pour tester le retour OAuth réel.
