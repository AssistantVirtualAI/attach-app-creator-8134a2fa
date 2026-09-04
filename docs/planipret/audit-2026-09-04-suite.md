# Audit téléphonie / Maestro / IA — suite (4 sept. 2026, 23h35 UTC)

## 1. Boucle d'erreurs Maestro (405) — RÉSOLU
- Plus aucune erreur `maestro_sync_verify` / `recording_poll_verify` depuis 22h30 (le correctif du garde `verify()` est en production).
- Sur les 3 dernières heures : `recording_push` 200 ×124, `ai_summary_push` 200 ×130, `maestro_media_poll` succès ×820.

## 2. Transcriptions et résumés IA — SAIN
Sur 14 jours : 313 appels, 151 avec enregistrement, **4 seulement sans transcription** (appels de 0–1 s), 142 résumés IA.
(Avant correctifs : 57–78 en attente.)

## 3. Textos vers Maestro — CORRIGÉ
- 422 « to_user_number obligatoire » : le numéro du correspondant pouvait être vide sur les SMS entrants → repli sur l'autre extrémité (`maestro-sync-message`).
- 404 « destinataire inconnu » : désormais terminal, le balayeur ferme la ligne au lieu de réessayer en boucle (`pp-maestro-sms-sweeper`).
- Reste 5 SMS non synchronisés sur 14 jours.

## 4. Appels absents de Maestro — CORRIGÉ (rattrapage élargi)
- 157 appels sur 14 jours sans `maestro_call_id`, dont **103 de moins de 5 s** (non pertinents).
- Le rattrapage n'enfilait que les appels avec enregistrement ; il couvre maintenant toute conversation ≥ 5 s de moins de 7 jours (`maestro-cdr-retry-job`, cron 5 min).
- Effet immédiat : 27 appels enfilés, 6 déjà synchronisés à la première passe.

## 5. Point bloquant restant (action humaine)
Seuls **5 courtiers sur 224** ont une connexion Maestro active. Les appels des courtiers non connectés ne peuvent pas être synchronisés :

| Courtier | Poste | Appels 14 j | Non synchronisés (≥ 5 s) | Maestro |
|---|---|---|---|---|
| Audrey Ann Chagnon Nantel | 1370 | 173 | 15 | non connectée |
| Pierre Gauthier | 1316 | 7 | 2 | non connecté |
| Miriam Nourcy | 1164 | 3 | 3 | non connectée |
| David Roussel | 1314 | 2 | 1 | non connecté |
| Josianne Leboeuf / Scott He | 1171 / 110 | 1 | 1 | non connectés |

→ Ces personnes doivent cliquer « Reconnecter Maestro » dans leur portail.

## 6. Vérifications complémentaires
- Tâches : projection à jour (dernière écriture 23h10), 80 tâches, rappels actifs.
- Files d'attente appels / actions PBX : vides.
- 31 tâches planifiées (cron) actives, dont les balayeurs Maestro appels (5 min) et textos (10 min).
