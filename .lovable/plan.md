# Notifications + formulaire client Maestro

## 1. Bouton « Vider les notifications »
- Cause confirmée : la table des notifications AVA n'autorise que lecture et mise à jour, pas la suppression. Le bouton ne supprime donc rien, sans afficher d'erreur.
- Correctif : autoriser chaque courtier à supprimer uniquement ses propres notifications. Après la suppression, relire la liste pour confirmer qu'elle est vide. Afficher un message clair en cas d'échec.
- Remplacer la boîte de confirmation du navigateur par une confirmation dans l'app (plus fiable dans l'app mobile).

## 2. Formulaire « Créer le client Maestro »
- Retirer « (facultatif) » du champ courriel. Le champ reste non obligatoire, sauf si vous voulez le rendre obligatoire.
- Préremplir le prénom et le nom avec le nom affiché, depuis tous les boutons client : historique d'appels, écran d'appel, bandeau d'appel entrant. On se rabat sur le nom de l'appelant ou du destinataire. Les noms qui ne sont que des numéros sont ignorés.
- Recherche d'adresse Google : quand on tape une adresse, des suggestions apparaissent. En choisir une remplit automatiquement numéro, rue, type de rue, ville, province et code postal (modifiables ensuite).

## Détails techniques
- Migration : `CREATE POLICY own_notifs_delete ON planipret_ava_notifications FOR DELETE TO authenticated USING (user_id = auth.uid())`.
- `MAvaNotifications.tsx` (src + app) : suppression + lecture de contrôle (count), puis un toast.
- `CreateMaestroClientSheet.tsx` (src + app) : placeholder « Courriel ». Le prénom et le nom sont remplis à partir de `target.name`. `MCalls.tsx` transmet `from_name`/`to_name` selon le sens de l'appel.
- Google Places : nouvelle fonction backend `pp-address-autocomplete` (autocomplete + details, restreinte au Canada). La clé reste côté serveur. Une clé API Google Maps (Places) sera demandée par formulaire sécurisé. Correspondance du type de rue vers les codes Maestro 1–6 (codes toujours supposés, en attente de Scott).
- App installée : changements reçus avec la prochaine version; le correctif de suppression fonctionne dès maintenant côté serveur.
