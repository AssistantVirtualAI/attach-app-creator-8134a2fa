# Phase 46A — Onboarding Lemtel par e-mail seulement

> **État : source et garde-fous seulement.** Aucun compte Auth, mot de passe temporaire, courriel, domaine FusionPBX ou application déjà distribuée n’est modifié par cette phase.

## Règle produit

Un administrateur de plateforme Lemtel crée une organisation et désigne son propriétaire. Le propriétaire, puis chaque utilisateur créé individuellement ou en lot, reçoit un courriel dans sa langue (`fr` ou `en`) avec :

1. son adresse e-mail comme **seul nom d’utilisateur**;
2. un mot de passe temporaire généré côté serveur;
3. les liens de téléchargement iOS, Android et Desktop;
4. l’instruction de se connecter à Lemtel puis de choisir immédiatement un mot de passe personnel.

Les applications n’acceptent plus un poste ni un domaine SIP pour cette connexion. Après une connexion e-mail réussie, le client doit bloquer son usage jusqu’au changement du mot de passe. Les paramètres de téléphonie restent récupérés côté serveur **après** l’authentification; ils ne sont ni demandés ni révélés pendant la connexion.

## Ce que la phase ajoute

| Élément | Rôle |
|---|---|
| `0003_lemtel_email_onboarding.sql` | tables Lemtel-only pour opérateurs de plateforme et audit de livraison sans mot de passe |
| `lemtel-onboarding-admin` | création d’organisation et provisionnement individuel/en lot avec RBAC |
| `lemtel-complete-first-password` | remplacement obligatoire du mot de passe temporaire |
| `lemtel-session-bootstrap` | identité, organisations et état `not_provisioned`, sans SIP/WSS/TURN |
| `email-onboarding-contract.json` | interdictions explicites et préconditions de déploiement |

## Préconditions avant toute activation staging

1. Une sauvegarde Restic fraîche et vérifiée.
2. L’application **explicite** de `0003` seulement après vérification que `0001` et `0002` sont présentes.
3. L’ajout approuvé du premier `lemtel_platform_administrators.user_id`, vérifié contre un compte Auth de staging. Ne jamais utiliser d’adresse e-mail comme autorisation implicite.
4. Un expéditeur transactionnel vérifié et les secrets runtime, jamais dans Git :
   - `RESEND_API_KEY`;
   - `LEMTEL_WELCOME_FROM`;
   - `LEMTEL_DOWNLOAD_IOS_URL`;
   - `LEMTEL_DOWNLOAD_ANDROID_URL`;
   - `LEMTEL_DOWNLOAD_DESKTOP_URL`.
5. Des liens de téléchargement de test privés. Aucun App Store, Google Play, DMG/EXE public ou production n’est activé par cette phase.
6. Un test synthétique avec une boîte de réception contrôlée en français et un autre en anglais. Vérifier que le mot de passe temporaire n’apparaît dans aucun log, table d’audit ou réponse de portail.
7. Les fonctions Edge déployées et testées séparément. Le client reste bloqué tant que le bootstrap renvoie `not_provisioned` ou qu’aucun environnement SIP/WSS/TURN de test n’est prêt.

## Sécurité de l’envoi

Le mot de passe temporaire existe seulement :

- en mémoire durant la création côté serveur;
- dans le compte Auth sous forme de hachage géré par Auth;
- dans le courriel transactionnel une seule fois.

Il est interdit dans les bases d’audit, le stockage, les logs de fonction, GitHub, les artefacts de build et les diagnostics client. Un renvoi volontaire génère et remplace le mot de passe temporaire; il n’est jamais relu.

## Limites assumées

- Cette phase n’ajoute **aucune** mutation FusionPBX et ne crée aucune extension.
- `lemtel-session-bootstrap` n’émet aucun identifiant SIP, WSS ou TURN. La liaison de téléphonie doit être ajoutée plus tard avec les données de test de Kenny et Phil et des contrôles de session stricts.
- Le projet Lovable actuel n’est pas modifié. Une compilation portail Lemtel doit être isolée de Planiprêt, exactement comme les builds clients Lemtel.
