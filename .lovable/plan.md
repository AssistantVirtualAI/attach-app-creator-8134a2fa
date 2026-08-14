# Audit complet Planiprêt Mobile — rapport + plan de correction

Audit basé sur les données réelles de production (7-14 derniers jours), les journaux NetSapiens/Maestro/ElevenLabs et le code.

## Rapport : ce qui fonctionne

| Fonction | État | Preuve mesurée |
|---|---|---|
| Appels sortants / entrants (SIP natif) | OK | 42 appels sur 7 j (27 sortants, 12 entrants, 3 manqués) |
| Journal d'appels + CDR vers Maestro | OK | 38 `call.cdr` + 38 `call.ended` en HTTP 200, 0 échec depuis le 8 août |
| Transcription + résumé IA + coaching | OK partiel | 24 appels sur 42 ont un résumé IA; 19 pipelines « complete » |
| SMS sortants (envoi via NetSapiens) | OK | 38 réponses 202 côté NS, dernier envoi 14 août 16 h 24 |
| SMS entrants | OK | 18 messages entrants reçus sur 7 j |
| Recherche de contacts / clients Maestro | OK (lent) | réponses 200, latence Maestro 6-8 s |
| Chatbot AVA (texte) | OK | `pp-ava-chat` répond, outils Maestro/M365 branchés |
| Connexion Microsoft 365 | OK pour les 3 comptes connectés | jetons présents et rafraîchis (Gilles, Marc, Mohamad) |
| Agent vocal AVA | Corrigé aujourd'hui | échec 1008 « override 'speed' not allowed » supprimé côté client |

## Rapport : ce qui ne fonctionne pas

1. **Message vocal personnalisé (bug signalé par Gilles) — bloquant.**
   Aucune annonce n'a jamais été enregistrée pour Gilles ni Marc (`voicemail_greeting_updated_at` vide; un seul profil sur 222 a un texte). Aucune trace d'appel à `pp-greeting-generate` / `pp-greeting-voices` dans les journaux : l'échec se produit **avant** l'appel au backend ou l'erreur est avalée par l'interface (liste de voix vide → bouton bloqué). À reproduire et corriger en priorité.

2. **Envoi des SMS vers Maestro — 179 échecs sur 7 jours.**
   Trois causes distinctes :
   - 147 × HTTP 500 « Server Error » sur `/users/387441216/messages` (panne côté Maestro, ID courtier probablement invalide);
   - 20 × HTTP 404 sur `/messages` (mauvaise route de repli);
   - 12 × HTTP 422 « format du champ to_user_number invalide » (numéro non normalisé E.164).
   Conséquence : les textos n'apparaissent pas dans Maestro.

3. **Enregistrements d'appels non téléversés — 117 échecs.**
   87 × `media_not_ready_after_24h`, 30 × `media_not_ready` : l'enregistrement n'est pas activé sur les extensions NetSapiens, donc le média n'existe jamais. 10 × `maestro_call_id_missing` (l'appel n'a pas de correspondance Maestro). Seulement 3 enregistrements synchronisés.

4. **Statuts SMS figés.** 28 messages sortants restent au statut `sending` alors que NetSapiens a répondu 202 : le rappel de statut ne met jamais à jour la ligne.

5. **Collisions d'identifiants courtiers Maestro.** 2 `maestro_broker_id` sont partagés par plusieurs profils → risque de fuite de données entre courtiers et de push vers le mauvais dossier.

6. **Couverture Maestro très faible.** 16 profils sur 222 ont un `maestro_broker_id`, 2 seulement sont réellement connectés en OAuth. Les autres courtiers ne poussent rien.

7. **Boîte vocale et calendrier vides en base.** 0 message vocal et 0 événement de calendrier enregistrés sur 7 jours — à confirmer : synchronisation inactive ou simplement aucune donnée.

8. **Tâche `pp-admin-ns-sync` bloquée.** 70 exécutions restées à l'état « running » (aucune depuis le 12 août) : les exécutions ne se terminent jamais proprement.

## Plan de correction — fonction par fonction, une à la fois

Règle appliquée à chaque étape : un seul sous-système modifié, vérification par requête réelle avant de passer au suivant, aucun fichier SIP/PJSIP/CallKit touché.

**Étape 1 — Message vocal personnalisé (priorité Gilles)**
Reproduire le flux du Studio d'annonce, instrumenter les erreurs (voix indisponibles, TTS, push NS), corriger la cause, puis valider en enregistrant une annonce réelle sur l'extension 111 et en vérifiant le retour NetSapiens.

**Étape 2 — SMS vers Maestro**
Normaliser tous les numéros en E.164 avant l'envoi (corrige les 422), supprimer la route de repli `/messages` qui renvoie 404, valider l'identifiant courtier avant l'appel et mettre en file d'attente avec réessai les vrais 500 de Maestro au lieu de les perdre.

**Étape 3 — Statut des SMS**
Passer le message à `sent` dès la réponse 202 de NetSapiens et rattraper les 28 messages figés.

**Étape 4 — Enregistrements d'appels**
Distinguer clairement « enregistrement désactivé sur l'extension » de « erreur technique », afficher l'état dans le portail admin, et fournir la liste exacte des extensions à activer côté NetSapiens (action manuelle requise).

**Étape 5 — Isolation des courtiers Maestro**
Détecter et bloquer les `maestro_broker_id` en double, ajouter une contrainte d'unicité et un rapport admin des profils à corriger.

**Étape 6 — Couverture Maestro**
Relier les courtiers restants (rattachement par courriel) et afficher un badge de connexion par courtier dans le portail admin.

**Étape 7 — Boîte vocale et calendrier**
Vérifier les synchronisations correspondantes et corriger si elles sont réellement inactives.

**Étape 8 — Tâches planifiées bloquées**
Ajouter une fin d'exécution garantie et un délai maximal à `pp-admin-ns-sync`.

**Étape 9 — Validation finale avant soumission App Store**
Test de bout en bout : appel entrant, appel sortant, SMS aller-retour, annonce vocale, chatbot, agent vocal, Microsoft 365, Maestro — puis rapport de résultats avant la mise à jour.

## Détails techniques

- SMS : `supabase/functions/pp-ns-sms/index.ts` et `maestro-sync-message` — normalisation E.164, suppression du repli `/api/v1/messages`, réessai exponentiel sur 5xx via `planipret_maestro_cdr_retries`.
- Annonce vocale : `pp-greeting-voices`, `pp-greeting-generate`, `GreetingStudio.tsx` (les deux copies : `src/` et `apps/planipret-mobile/src/`).
- Enregistrements : `maestro-recording-upload`, `maestro-media-poll`, table `planipret_recording_uploads`.
- Isolation : index unique partiel sur `planipret_profiles.maestro_broker_id`.
- Aucun changement dans `src/lib/planipret/sip`, l'audio natif, les plugins Capacitor ou le flux OAuth Microsoft.
