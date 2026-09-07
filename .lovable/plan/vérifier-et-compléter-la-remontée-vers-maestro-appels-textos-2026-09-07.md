# Vérifier et compléter la remontée vers Maestro (appels, textos, enregistrements, IA)

Objectif : un test réel de bout en bout avec votre compte Maestro (ID 387460525), puis corriger ce qui n'arrive pas dans Maestro — depuis le portail web **et** l'application mobile — pour que tout apparaisse sous le bon courtier et le bon client.

## Ce que les données montrent aujourd'hui (mesuré)

Sur les 14 derniers jours :

- **Appels** : 386 au total, 202 rattachés à Maestro (184 sans lien).
- **Textos** : 639 envoyés/reçus, 580 marqués comme synchronisés ; 27 refus 404 et 7 refus 422 côté Maestro sur 3 jours.
- **Enregistrements** : 213 tentatives d'envoi — 95 synchronisées, 75 encore en attente, 36 abandonnées, 7 ignorées.
- **Résumés IA** : 164 appels ont un résumé localement.
- **Journal Maestro** : seules trois natures d'envoi y figurent (textos, fin d'appel, fiche d'appel). **Aucune trace d'envoi d'enregistrement, de résumé IA ou de coaching** — ces contenus restent donc dans l'application et n'atteignent pas Maestro.
- **File de traitement des appels** : vide, donc la chaîne automatique enregistrement → transcription → résumé → Maestro ne tourne pas actuellement.
- **Comptes reliés** : 15 courtiers sur 224 ont une autorisation Maestro ; votre compte est relié (dernière synchro 5 septembre).

## Plan

### Phase 1 — Test de connexion réel avec votre compte
- Vérifier votre jeton Maestro (valide, renouvelable) et l'identité renvoyée par Maestro.
- Lire vos propres données depuis Maestro (contacts, dossiers, tâches) pour confirmer que la lecture fonctionne des deux côtés.
- Rapport clair : ce qui répond, ce qui refuse, avec le code exact.

### Phase 2 — Test d'écriture bout en bout
Faire un aller-retour complet et vérifier dans Maestro après chaque étape :
1. un appel de test → fiche d'appel sous le courtier et sous le client ;
2. un texto de test → fil de conversation sous le client ;
3. l'enregistrement de l'appel → pièce jointe/lien dans Maestro ;
4. le résumé IA et le coaching → note attachée au même appel.

### Phase 3 — Corriger les envois manquants
- Brancher réellement l'envoi des **enregistrements**, **résumés IA** et **coaching** vers Maestro (aujourd'hui absents du journal), avec journalisation de chaque envoi.
- Relancer les 75 enregistrements en attente et réexaminer les 36 abandonnés.
- Corriger les textos refusés (404 = client introuvable, 422 = données incomplètes) en résolvant le client avant l'envoi.
- Rattacher les appels sans lien Maestro par recherche du numéro dans les contacts du courtier.

### Phase 4 — Rattachement courtier + client garanti
- S'assurer que chaque écriture porte l'identifiant du courtier propriétaire et celui du client, pour que tout s'affiche aux deux endroits dans Maestro.
- Même comportement pour le portail web et l'application mobile (même chemin d'envoi).

### Phase 5 — Surveillance
- Page d'admin « Santé Maestro » : par courtier, nombre d'appels/textos/enregistrements/résumés envoyés et refusés, avec bouton de relance.
- Relance automatique programmée des envois en échec, avec plafond de tentatives.

## Détails techniques

- Test via `pp-maestro-oauth-probe`, `maestro-actions`, `pp-ava-maestro-status`.
- Écritures : `maestro-sync-call`, `maestro-sync-message`, `maestro-recording-upload`, `maestro-ai-analysis`, `pp-coach-call`.
- Journalisation systématique dans `planipret_maestro_sync_log` (actions `recording_push`, `ai_summary_push`, `coaching_push` actuellement absentes).
- Relances via `pp-maestro-push-sweeper` (budget 6 tentatives, backoff jusqu'à 24 h) et `planipret_recording_uploads`.
- Réactiver l'alimentation de `planipret_call_job_queue` par `pp-auto-process-call` / `pp-call-queue`.
- Aucun changement de schéma prévu, sauf éventuels index de suivi.

## Limite connue
Seuls 15 courtiers sur 224 ont autorisé Maestro. Les autres n'auront aucune donnée tant qu'ils n'ont pas donné leur accord depuis leur propre compte.
