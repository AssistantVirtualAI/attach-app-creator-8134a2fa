# Lemtel — autorité des comptes et synchronisation inter-appareils

> **État : source et contrats préparés, non déployés.** Cette conception ne crée aucun utilisateur réel, n’envoie aucun courriel, ne modifie pas Lovable/Planiprêt, ne touche pas à la téléphonie et ne change pas le DNS.

## Règle unique

Le **portail Lemtel** est la seule porte de création et d’administration : il crée une organisation Lemtel (l’espace client, nommé par son slug), son propriétaire et les membres invités. Les applications iOS, Android et Desktop ne présentent aucun parcours d’inscription : elles permettent seulement une connexion e-mail/mot de passe à une identité déjà créée par le portail.

Un compte est utilisable dans toute application seulement si le serveur confirme simultanément :

1. l’utilisateur Auth est un compte Lemtel e-mail/mot de passe ;
2. il possède une adhésion Lemtel active ;
3. son organisation Lemtel est active ;
4. il n’est pas en attente du premier mot de passe personnel.

Un e-mail externe qui créerait malgré tout un compte Auth ne reçoit aucune adhésion et est donc refusé par le bootstrap Lemtel. La configuration runtime devra aussi désactiver l’inscription Auth publique (`GOTRUE_DISABLE_SIGNUP=true`) avant une mise en production.

## Configuration isolée du portail

Le portail peut coexister dans une base de code avec Planiprêt. Il lit donc uniquement les variables publiques Lemtel `VITE_LEMTEL_API_URL` et `VITE_LEMTEL_PUBLISHABLE_KEY` (ou la compatibilité `VITE_LEMTEL_ANON_KEY`). Les variables génériques `VITE_SUPABASE_*` sont délibérément ignorées afin qu’un portail Lemtel ne puisse jamais se connecter par erreur au backend Planiprêt. Les écritures restent fermées tant que `VITE_LEMTEL_HOSTED_ONBOARDING=approved` n’est pas fourni par le déploiement autorisé.

## Synchronisation réelle, sans mot de passe en clair

| Élément | Source de vérité | Portail | iOS / Android / Desktop |
|---|---|---|---|
| Organisation / « domaine » logique | `lemtel_organizations` | création par administrateur plateforme | bootstrap serveur uniquement |
| Utilisateur, rôle, accès | `lemtel_organization_memberships` | invitation, suspension, réactivation future | bootstrap serveur uniquement |
| Mot de passe | Supabase Auth | mot de passe temporaire uniquement via serveur | même Auth ; jamais copié ni stocké en clair |
| Réinitialisation | Edge Function Lemtel + Auth | émission d’un temporaire sous contrôle admin | demande générique, non énumérante |
| État de session | bootstrap Lemtel | lecture de l’état autoritaire | reconnexion au lancement, renouvellement de jeton, retour au premier plan et focus/visibilité Desktop |
| Chat / historique / enregistrements | tables Lemtel protégées par RLS | aucune lecture croisée par défaut | filtres organisation + identité/poste, accès serveur autorisé seulement |

Le changement d’un mot de passe n’est pas une réplication de texte : Auth conserve seulement le secret haché. Toutes les applications utilisent cette **même identité Auth**. Une rotation de mot de passe force le drapeau de premier mot de passe ; au prochain contrôle d’autorité, un appareil existant est bloqué jusqu’à la reconnexion avec le nouveau mot de passe.

## Propagation et invalidation

- Une invitation ajoute l’adhésion active et incrémente la révision d’autorité de l’organisation.
- Une suspension supprime l’accès lors du prochain contrôle d’autorité, puis les clients effacent leur session et leurs caches privés.
- Une modification de mot de passe temporaire est faite par le serveur, active le drapeau de changement obligatoire et incrémente la révision.
- Les clients n’acceptent jamais un identifiant d’organisation fourni par l’interface ou par un cache comme preuve d’accès : le bootstrap décide à chaque réconciliation.
- Les enregistrements, CDR et messageries restent restreints au poste de l’utilisateur par les routes et RLS autoritaires existantes. Aucune nouvelle intégration PBX n’est introduite ici.

## Séquence de déploiement ultérieure

1. Appliquer la migration `0007_lemtel_portal_account_authority.sql` sur le writer après sauvegarde approuvée.
2. Déployer les Edge Functions `lemtel-session-bootstrap`, `lemtel-onboarding-admin` et `lemtel-complete-first-password` dans une même fenêtre contrôlée.
3. Vérifier, avec un compte de synthèse approuvé, que portail, Mobile et Desktop reçoivent la même organisation et que la suspension est refusée au bootstrap.
4. Configurer et vérifier l’e-mail transactionnel ; la récupération doit répondre de façon générique pour ne pas révéler les comptes.
5. Publier des builds Mobile/Desktop seulement après succès du smoke test et de la réconciliation serveur.

Le portail Lovable existant doit utiliser exclusivement les actions `lemtel-onboarding-admin` et le même backend Lemtel. Son code Planipret partagé ne doit pas être modifié ; seuls les fichiers Lemtel isolés peuvent être portés par l’automatisation GitHub.
