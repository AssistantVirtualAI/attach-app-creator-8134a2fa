# Audit complet Planiprêt Mobile (iOS + Android) — tests et rapport

Objectif : exécuter une passe de tests réels sur toutes les surfaces de l'app mobile et livrer un rapport unique (EN) listant ce qui fonctionne, ce qui échoue, et les correctifs à faire, classés bloquant / dégradé / cosmétique.

## Périmètre testé

1. Identité et connexions
   - Connexion courtier (email/mot de passe), rafraîchissement de session, gestion des 401.
   - Maestro OAuth : ID CRM résolu en direct, purge des caches à la reconnexion, isolation entre courtiers.
   - Microsoft 365 : temps d'échange du jeton, courriels, calendrier mensuel, refresh après expiration.

2. Endpoints Maestro et telecom
   - Clients/contacts : liste, recherche, fiche.
   - Historique d'appels (CDR), messages (inbox + fils), enregistrements, communications.
   - Push vers Maestro : appels, SMS, enregistrements, transcriptions, analyse/coaching IA.
   - Contrôle des doublons (registre de déduplication) et des lignes restées `pending` / `failed`.

3. Tâches Planiprêt
   - create / update / delete / list / get / verify via la passerelle, idempotence, garde d'assignation (moi + assistants autorisés), indicateur de statut et bouton « Ouvrir dans Maestro ».

4. AVA chatbot et voicebot
   - Accès aux profils clients du courtier connecté, isolation multi-tenant.
   - Chaque outil branché (contacts, appel, SMS, tâches, résumé d'appel) exécuté au moins une fois, chat et voix.
   - Voicebot : démarrage de session, routage micro/haut-parleur, boucle de reconnexion.

5. Appels et médias (parties natives)
   - Appel sortant/entrant SIP, écran d'appel unique, arrière-plan/écran verrouillé, mute, haut-parleur, transfert, DTMF.
   - Boîte vocale : liste, lecture, suppression, message d'accueil personnalisé.
   - Téléchargement et lecture des enregistrements.

## Méthode

- Automatisé : suites Vitest existantes, appels directs aux edge functions avec une vraie session courtier, requêtes base (lignes non synchronisées, doublons, files de retry), lecture des logs des fonctions sur la fenêtre d'audit.
- Semi-automatisé : parcours web mobile via navigateur headless (auth, clients, textos, tâches, AVA chat).
- Manuel côté appareil (à ta charge, checklist fournie) : appels SIP réels, CallKit/arrière-plan, audio du voicebot, connexion Microsoft sur iOS et Android.

## Livrable

Rapport PDF en anglais : une ligne par test avec statut PASS / WARN / FAIL, preuve (correlation ID, code HTTP, extrait de log, capture), cause racine pour chaque échec, et liste de correctifs priorisée. Plus une checklist manuelle courte pour les points qui exigent un vrai appareil.

## Notes techniques

- Aucun changement de code pendant la phase d'audit ; les correctifs sont proposés ensuite dans un plan séparé.
- Aucun fichier natif protégé (PJSIP, Info.plist, scripts de build, CI) n'est touché.
- Les tests d'écriture Maestro utilisent des clés d'idempotence pour ne pas polluer les Communications.
