## Pourquoi ces erreurs apparaissent

Les permissions affichées dans Microsoft Entra sont accordées à l’application, mais le token actuellement stocké pour l’utilisateur peut encore être incomplet ou trop ancien. Il faut aussi distinguer :

- **Permissions accordées à l’app Azure** : visibles dans Entra.
- **Permissions réellement présentes dans le token OAuth de l’utilisateur** : utilisées par l’app mobile/portail.
- **Privilèges du compte connecté** : certains appels Microsoft Graph comme organisation, utilisateurs, applications Azure peuvent exiger un rôle Microsoft admin/Global Reader/Application Admin en plus des scopes.
- **Type de permission** : certaines vérifications backend peuvent nécessiter des permissions application/admin, pas seulement delegated.

Je ne stockerai pas et ne réutiliserai pas le mot de passe partagé dans le chat. La connexion doit passer par le flux Microsoft OAuth sécurisé.

## Phase 1 — Audit complet Microsoft 365 existant

Objectif : identifier exactement où la connexion casse.

- Vérifier le flux mobile standalone : bouton connexion, URL Microsoft, callback, échange du code, stockage du token.
- Vérifier le portail admin : statut config tenant/client/secret, test backend, bouton re-test admin.
- Vérifier les fonctions backend Microsoft : OAuth exchange, config test, webhook mail, Teams, Calendar.
- Vérifier les tables/colonnes qui stockent l’état de connexion Microsoft.
- Vérifier si les erreurs viennent de :
  - token sans scopes récents,
  - utilisateur non reconnecté après ajout de permissions,
  - mauvais tenant/client ID,
  - redirect URI manquant,
  - rôle Microsoft insuffisant,
  - backend qui teste des endpoints trop privilégiés.

## Phase 2 — Connexion utilisateur Microsoft complète

Objectif : que l’utilisateur `mhassoun@planipret.com` soit connecté à Microsoft 365 dans l’app.

- Forcer une reconnexion Microsoft 365 depuis l’app pour obtenir un token neuf avec les scopes actuels.
- Ajouter une détection claire :
  - tenant détecté,
  - client détecté,
  - secret backend détecté,
  - compte Microsoft connecté,
  - scopes accordés,
  - scopes manquants,
  - dernier test réussi/échoué.
- Afficher un message actionnable si Microsoft répond `Insufficient privileges` :
  - “Reconnecter Microsoft” si token incomplet,
  - “Rôle Microsoft admin requis” si le compte n’a pas les droits directory/app,
  - “Permission application requise” si l’endpoint ne peut pas fonctionner en delegated.
- Stocker l’état de connexion par utilisateur et le statut global admin séparément.

## Phase 3 — Correction des tests backend Microsoft

Objectif : que le portail admin dise la vérité sans faux négatifs.

- Séparer les tests en catégories :
  - OAuth/token,
  - profil utilisateur,
  - mail,
  - calendrier,
  - Teams chats,
  - Teams channels,
  - organisation Microsoft,
  - utilisateurs Microsoft,
  - application Azure.
- Pour chaque test, enregistrer : succès, erreur Microsoft exacte, statut HTTP, scopes requis, action recommandée.
- Ne pas marquer toute l’intégration comme échouée si seulement les tests admin-directory échouent.
- Ajouter/renforcer le bouton **Admin re-test integration** pour recalculer immédiatement le statut sauvegardé.

## Phase 4 — Calendrier Microsoft sur la page principale

Objectif : afficher le calendrier Microsoft dans l’écran principal Planiprêt.

- Ajouter un module “Calendrier Microsoft” sur la page principale mobile.
- Lire les événements Microsoft Calendar via backend sécurisé.
- Afficher : prochains rendez-vous, heure, participant principal, lien Teams si disponible.
- Ajouter actions rapides :
  - créer un rendez-vous,
  - modifier un rendez-vous,
  - ouvrir Teams meeting,
  - demander à AVA de préparer un résumé.
- Prévoir états UI : connecté, non connecté, scopes manquants, chargement, erreur.

## Phase 5 — Brancher AVA Chatbot aux intégrations

Objectif : AVA peut agir sur Microsoft 365 et les autres canaux autorisés.

Créer un moteur d’actions backend pour AVA avec outils contrôlés :

- **Email Outlook**
  - lire les emails,
  - résumer les emails,
  - préparer une réponse,
  - envoyer une réponse après confirmation utilisateur.

- **Microsoft Calendar**
  - lire les événements,
  - ajouter une réunion,
  - modifier une réunion,
  - inviter des participants,
  - créer lien Teams si disponible.

- **Teams**
  - lire chats/canaux autorisés,
  - résumer conversations,
  - préparer réponse,
  - envoyer réponse après confirmation.

- **Téléphonie/SMS**
  - appeler un contact via l’intégration téléphonie existante,
  - envoyer SMS si l’intégration SMS est configurée,
  - journaliser l’action.

- **Résumé global**
  - “résume mes emails”,
  - “résume mes Teams”,
  - “quels rendez-vous aujourd’hui”,
  - “prépare mes suivis clients”.

## Phase 6 — Sécurité, permissions et confirmations

Objectif : donner à AVA beaucoup d’accès sans créer de risque.

- Toutes les actions sensibles passent par backend sécurisé, jamais directement depuis le navigateur.
- AVA peut lire selon les permissions Microsoft accordées.
- AVA doit demander confirmation avant :
  - envoyer un email,
  - envoyer un message Teams,
  - envoyer un SMS,
  - appeler quelqu’un,
  - créer/modifier un événement calendrier.
- Journaliser chaque action AVA : utilisateur, action, cible, résultat, heure.
- Ne jamais exposer tokens Microsoft, secrets Azure, clés API ou mots de passe dans le frontend.

## Phase 7 — Tests end-to-end

Objectif : prouver que tout fonctionne.

Tester séparément :

- Connexion Microsoft mobile standalone.
- Callback OAuth mobile.
- Stockage état connecté.
- Reconnexion après changement de scopes.
- Portail admin re-test.
- Lecture email.
- Résumé email par AVA.
- Réponse email avec confirmation.
- Lecture calendrier.
- Création événement calendrier avec confirmation.
- Lecture Teams.
- Réponse Teams avec confirmation.
- État UI quand permissions manquent.

## Résultat attendu

À la fin :

- L’utilisateur voit clairement s’il est connecté à Microsoft 365.
- Le portail admin montre le vrai statut tenant/client/auth/scopes.
- Les erreurs Microsoft affichent une cause claire et une action exacte.
- Le calendrier Microsoft apparaît sur la page principale.
- AVA peut lire, résumer et agir sur emails, calendrier, Teams, SMS/appels selon les intégrations configurées.
- Les actions sensibles sont sécurisées et confirmées avant envoi.