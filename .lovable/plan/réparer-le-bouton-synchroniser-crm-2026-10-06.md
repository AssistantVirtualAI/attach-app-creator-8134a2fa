# Réparer le bouton « Synchroniser » CRM

## Cause confirmée
Les journaux montrent que vos clics atteignent bien le serveur, mais il refuse l’envoi pour deux raisons introduites par la correction précédente :
1. L’app installée sur votre téléphone (version actuelle des magasins) n’envoie pas le nouveau marqueur « action manuelle » → refus.
2. Vos appels ont la décision post-appel encore « en attente » → refus « consentement requis ».
Le refus revient en erreur serveur, d’où le message générique « Edge Function returned a non-2xx status code ».

## Correctif (serveur seulement, aucune mise à jour iOS/Android)
1. **Le clic sur Synchroniser vaut autorisation CRM** : un clic du courtier connecté (bouton actuel de l’app installée ou nouveau marqueur) est accepté comme action manuelle explicite. Les envois automatiques (tâches serveur, ancienne synchro auto en arrière-plan de l’app installée) restent bloqués.
2. **Décision enregistrée au clic** : si l’appel est « en attente », le clic CRM enregistre la décision « conserver + envoyer au CRM », avec l’heure et l’utilisateur. Les appels supprimés restent bloqués.
3. **Messages clairs** : les refus prévus reviennent avec une explication lisible (ex. « Appel supprimé », « Client Maestro introuvable ») au lieu de l’erreur générique; l’ancienne synchro automatique de l’app installée est ignorée silencieusement, sans notification d’erreur.

## Vérification
- Essais serveur : appel non autorisé, appel supprimé, synchro automatique (doit être ignorée), clic manuel (doit passer).
- Un seul vrai envoi Maestro sur l’appel 1136 de 15h48 que vous avez tenté de synchroniser, puis relecture du statut « Synchronisé » dans la liste.
- Aucune publication, aucun changement natif.

## Détails techniques
- `maestro-sync-call` : accepter un JWT utilisateur propriétaire si `explicit_user_action === true` OU `force === true` (bouton legacy); rejeter service-role et `force:false` legacy avec HTTP 200 `{success:false, skipped:"manual_only"}`.
- Au passage manuel : si `save_consent = 'pending'`, mettre `approved` + `save_consent_at/by` (colonnes existantes), journaliser `metadata.crm_manual_push_at/by`. `requireApprovedCallConsent` revient à `approved` seulement (retire `declined`); `deleted_at` → refus.
- Refus métier en HTTP 200 `{success:false, error, message}` pour que l’app installée affiche `message`.
- Workers automatiques inchangés (toujours désactivés).
