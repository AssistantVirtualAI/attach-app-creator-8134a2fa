# Enregistrements permanents et retour vers l’application

## 1. Séparer définitivement les enregistrements du CRM
- Conserver dans AVA tous les appels enregistrés présents dans le système téléphonique, peu importe le choix fait après l’appel.
- Remplacer la décision destructive après appel par deux choix clairs : **Envoyer au CRM maintenant** ou **Garder dans AVA**.
- Rendre l’ancien choix « Supprimer/Refuser » non destructif côté serveur afin que les versions mobiles déjà installées ne puissent plus effacer l’audio, la transcription ou le coaching.
- Réserver la suppression réelle à une action distincte et explicite, hors de ce parcours.

## 2. Toujours fournir audio, transcription et coaching
- Traiter et afficher l’audio, la transcription et le coaching AVA indépendamment du statut CRM.
- Retirer les filtres qui cachent les appels non envoyés à Maestro dans les pages Enregistrements mobile et portail.
- Garder les appels visibles pendant la préparation de l’audio, avec un état compréhensible plutôt que `call_not_found`.
- Relancer la récupération depuis le système téléphonique pour les appels encore disponibles qui ont été précédemment masqués; signaler ceux que le système téléphonique ne conserve plus.

## 3. CRM uniquement sur demande
- Supprimer l’envoi automatique à Maestro depuis la liste des enregistrements.
- Conserver un bouton **CRM** sur chaque appel : statut local, recherche du client, puis bouton **Envoyer au CRM**.
- Après envoi, relire le statut et afficher **Envoyé au CRM** seulement lorsque Maestro le confirme.
- Le bouton reste disponible plus tard pour tout appel gardé uniquement dans AVA.

## 4. Fermer proprement le portail
- Ajouter une action visible et fixe **Retour à l’application** dans le portail ouvert depuis le téléphone.
- Sur iPhone, terminer la fenêtre sécurisée déjà utilisée par l’application; sur Android, rouvrir l’application avec son lien existant.
- Prévoir un repli **Fermer cette page** avec une instruction courte si le téléphone refuse le retour automatique.
- Ne modifier aucun réglage natif iOS/Android pour ce correctif.

## 5. Vérifications
- Tester : garder dans AVA, envoyer immédiatement au CRM, envoyer plus tard depuis le bouton CRM, et absence de suppression des médias.
- Vérifier audio, transcription et coaching pour les appels non envoyés au CRM, y compris après rechargement.
- Tester le retour au téléphone depuis le portail sur formats iPhone et Android simulés.
- Vérifier le français et l’anglais, les états de chargement et les erreurs conviviales.

## Détails techniques
- Adapter `pp-call-consent` pour enregistrer une décision non destructive et lancer le traitement AVA sans déclencher Maestro.
- Garder `maestro-sync-call` strictement derrière une demande CRM explicite.
- Retirer la synchronisation Maestro automatique de `RecordingsList` et harmoniser les copies web/mobile.
- Ajuster les requêtes des pages Enregistrements et les règles d’accès pour inclure tous les appels non réellement supprimés.
- Ajouter des tests de non-régression pour l’ancien client mobile, le traitement AVA indépendant et la confirmation CRM.
