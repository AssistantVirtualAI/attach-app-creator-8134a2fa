# Portail web Courtier (Planiprêt)

Créer un portail web pour chaque courtier, avec la même allure que le portail admin Planiprêt, mais limité à ses propres données. Connexion identique à l'application mobile : Microsoft SSO ou courriel + mot de passe.

## Accès et connexion

- Nouvelle adresse : `/planipret/broker/*`
- Écran de connexion réutilisant exactement celui de l'app mobile (`MobileAuthScreen`) : bouton « Se connecter avec Microsoft » + formulaire courriel/mot de passe, avec le même callback Microsoft (`/auth/microsoft/callback`).
- Après connexion, retour automatique sur la page du portail demandée.
- Un admin Planiprêt qui ouvre `/planipret/broker` est renvoyé vers son portail admin ; un courtier qui tente `/planipret/admin/*` est renvoyé vers son portail courtier.

## Pages du portail courtier

Mêmes composants visuels que l'admin (barre latérale, en-tête, tableaux, pagination, états vides), mais chaque écran est filtré sur le courtier connecté :

- Vue d'ensemble : appels du jour/semaine, manqués, durée moyenne, messages non lus, derniers appels.
- Appels : historique complet avec filtres (date, direction, statut), fiche détail, résumé IA quand disponible.
- Messages : ses fils SMS, lecture et envoi.
- Messagerie vocale : liste, lecture, marquage lu.
- Enregistrements : ses enregistrements d'appels, écoute et téléchargement.
- Statistiques : ses tendances d'appels sur la période choisie.
- Réglages : profil, mot de passe, statut Maestro / Microsoft, langue FR/EN.

Aucune page d'administration (utilisateurs, intégrations, diagnostics, audit) n'est exposée.

## Détails techniques

- Routes : nouveau bloc `/planipret/broker` dans `src/App.tsx`, avec `BrokerPortalGuard` (session Supabase + `planipret_profiles.role` du courtier ; refus si admin-only ou Lemtel-only).
- Layout : `src/pages/planipret/broker/PlanipretBrokerLayout.tsx`, calqué sur `PlanipretAdminLayout` (mêmes primitives `PPPrimitives`, `PAPageShell`, `PlanipretLangSwitch`, `NotificationsBell`).
- Pages : `PBOverview`, `PBCalls`, `PBMessages`, `PBVoicemail`, `PBRecordings`, `PBStats`, `PBSettings` — réutilisent la logique de requête des pages `PA*` en forçant le filtre `broker_id`/`user_id` de la session, sans possibilité de le changer côté UI.
- Sécurité : le filtrage n'est pas seulement côté UI. Vérification côté base des politiques RLS sur `planipret_phone_calls`, `planipret_phone_messages`, `planipret_voicemails`, `planipret_recording_uploads` pour garantir qu'un courtier ne lit que ses lignes ; ajout des politiques manquantes par migration si l'audit le montre. (À vérifier en première étape d'implémentation.)
- Auth : réutilisation de `MobileAuthScreen` et de `startMicrosoftSignIn` en passant la destination `/planipret/broker/overview`.
- Bilingue FR/EN via `useMplanipretLang`, comme le reste de Planiprêt.

## Hors portée

- Aucun changement à l'app mobile ni au portail admin existant.
- Pas de softphone/appel sortant dans le portail web à cette étape.
