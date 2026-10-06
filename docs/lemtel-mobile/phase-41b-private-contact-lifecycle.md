# Phase 41B — Cycle privé des contacts Lemtel

## Objet

Cette phase prépare, en **sources et tests seulement**, le consentement et la suppression des contacts appareil pour un futur build Lemtel distinct. Elle n’active pas la lecture de contacts, n’effectue aucun upload et ne met à jour aucune application distribuée.

## Consentement isolé

Le nouveau record de consentement est séparé de Planiprêt et n’existe que si le même flag futur que la phase 41A est explicitement approuvé. Sa clé est liée à :

- l’origine self-hosted via le suffixe de stockage du backend;
- l’identifiant UUID du compte connecté;
- la version `lemtel-private-contacts-v1`.

Le record vérifie aussi l’origine et le compte avant d’être réutilisé. Un consentement hérité Planiprêt ne peut donc jamais autoriser une lecture/upload sur Lemtel.

## Suppression privée et atomique

`lemtel-contacts` gagne une action source `delete_device`. Elle accepte uniquement l’action et l’organisation injectée par l’adaptateur; elle n’accepte ni `userId`, ni identifiant de contact, ni source. Après Auth et appartenance active, une seule suppression cible `organization_id`, `owner_user_id` et `source=device`. Le client efface son consentement local seulement après une réponse serveur réussie.

## Limites et interdictions actuelles

La nouvelle action n’est **pas déployée** sur Hostinger : le staging conserve la version déjà autorisée précédemment. Le module client n’est pas relié à l’UI, au consentement historique, au carnet local ou à une synchronisation. Un futur déploiement devra être autorisé séparément, précéder tout flag de build, puis être validé par tests de suppression et appareils physiques.

Aucun changement Planiprêt, FusionPBX, VPS, DNS, Lovable, clé backend, build ou application publiée n’est inclus.
