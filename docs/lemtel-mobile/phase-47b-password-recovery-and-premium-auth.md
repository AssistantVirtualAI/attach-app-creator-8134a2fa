# Phase 47B — Récupération par mot de passe temporaire et accès premium Lemtel

## Résultat de cette phase

Cette phase remplace le flux client de lien de récupération par un flux **Lemtel e-mail seulement** :

1. La personne choisit **Forgot password? / Mot de passe oublié ?** dans Desktop ou mobile.
2. Elle saisit l’adresse e-mail de son compte Lemtel.
3. Le serveur répond de manière générique afin de ne pas confirmer l’existence d’un compte.
4. Pour un compte Lemtel actif et admissible, le serveur crée un mot de passe temporaire en mémoire, le remplace dans Supabase Auth, le transmet via Resend dans la langue du compte, puis marque le compte pour un changement obligatoire.
5. La personne ouvre l’app Lemtel avec son e-mail et le mot de passe temporaire, puis doit créer son mot de passe personnel avant d’accéder au service.

Le mot de passe temporaire n’est jamais affiché dans le portail, journalisé ou stocké dans les tables Lemtel.

## Contrôles de sécurité

- **Aucune énumération de comptes** : le client reçoit toujours une réponse d’acceptation identique pour une adresse valide, qu’elle corresponde ou non à un compte Lemtel.
- **Périmètre Lemtel seulement** : une appartenance active Lemtel et le marqueur Auth `lemtel_email_only_signin` sont exigés.
- **Throttling atomique** : une réinitialisation est limitée côté serveur par utilisateur admissible (15 minutes).
- **Aucun changement PBX** : le flux ne lit ni n’écrit d’extension, de mot de passe SIP, de domaine SIP ou de configuration FusionPBX.
- **Courriel localisé** : les contenus français et anglais sont sélectionnés selon le profil de l’utilisateur.
- **Échec du fournisseur** : le client ne reçoit pas de détail sensible; l’audit contient seulement l’état et un code de panne. Un échec libère la fenêtre de récupération pour une nouvelle tentative.

## Interface Desktop

L’écran Desktop est refondu autour de l’identité Lemtel : panneau sombre premium, halo cyan/or, badge d’accès sécurisé, logo Lemtel, état de récupération et écran de mot de passe personnel. Il ne présente plus :

- de champ Extension;
- de champ Portal URL;
- de champ SIP domain;
- de mention ou de pied de page AVA;
- de bouton de connexion par poste.

## Préconditions avant activation staging

Cette phase est du code source et une migration jusqu’à activation explicite. Avant un déploiement réel :

1. Faire une sauvegarde Restic fraîche et un `restic check` réussi.
2. Appliquer `0004_lemtel_temporary_password_recovery.sql` une fois, avec validation idempotente.
3. Déployer `lemtel-password-reset-request` en même temps que son manifeste.
4. Vérifier `RESEND_API_KEY` et `LEMTEL_WELCOME_FROM` sans les afficher.
5. Tester uniquement un compte Lemtel synthétique : demande → courriel localisé → connexion temporaire → nouveau mot de passe → bootstrap.
6. Vérifier qu’une adresse inconnue donne la même réponse client et ne produit aucun courriel.
7. Recompiler Desktop, Android et iOS sous le profil Hostinger avant toute installation de test.

## Hors périmètre

- Modification Planiprêt ou de ses comptes.
- Publication depuis le projet Lovable actuel relié à Planiprêt.
- Mise en production, changement DNS ou failover DigitalOcean.
- Provisioning FusionPBX, SIP/WSS/TURN, PushKit/CallKit ou FCM.
- Signature/notarisation et distribution finale des paquets clients.
