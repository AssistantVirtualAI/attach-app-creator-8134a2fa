# Traçabilité Maestro + fil SMS fluide et sans doublons

## 1. Logs corrélés (appels + SMS)

Uniformiser un `correlation_id` sur toute la chaîne :

- Générer un `correlation_id` unique côté envoi SMS (`pp-ns-sms`) et le propager dans `planipret_phone_messages.metadata`, puis dans `maestro-sync-message` (aujourd'hui il utilise seulement l'id de la ligne).
- Même chose pour les appels : `maestro-sync-call`, `maestro-recording-upload`, `maestro-transcript`, `maestro-ai-analysis` écrivent une ligne `planipret_pipeline_logs` avec le même `correlation_id` (le `call_id` NetSapiens) et `entity_type` distinct par étape.
- Chaque log contient : étape, endpoint appelé, statut HTTP, durée, id retourné par Maestro, erreur.
- Écran admin : filtre par `correlation_id` dans l'audit pipeline pour voir en une vue les doublons ou les étapes manquantes.

## 2. Chargement progressif du fil SMS

Actuellement le fil charge une page fixe et rend tous les messages.

- Charger les 40 messages les plus récents, puis pagination « remonter » par tranches de 40 via `range()` sur `sent_at`.
- Déclenchement automatique par `IntersectionObserver` en haut du fil, avec indicateur de chargement.
- Conserver la position de lecture après insertion des anciens messages (compensation de hauteur de scroll).
- Rendu allégé (fenêtrage) si un fil dépasse ~300 messages.

## 3. Comportement de scroll

- Bouton flottant « Revenir en bas » affiché seulement quand on est remonté, avec compteur de nouveaux messages.
- Auto-scroll uniquement si l'utilisateur est déjà en bas (déjà en place, à consolider avec l'ancrage de pagination).

## 4. Anti-doublons SMS (client + serveur)

- Client : clé d'idempotence générée à l'envoi, bouton verrouillé jusqu'à réponse, message optimiste réconcilié par cette clé (pas par le texte).
- Serveur : `pp-ns-sms` accepte cette clé, la stocke, et refuse tout renvoi de la même clé (fenêtre 24 h) au lieu de la comparaison texte/90 s actuelle.
- Base : index unique sur la clé d'idempotence pour bloquer la double insertion même après rafraîchissement de page.
- Affichage : fusion de l'écho NetSapiens avec la ligne locale via `ns_message_id` + clé, en remplacement du dédoublonnage par texte.

## 5. Diagnostic « rien ne s'affiche dans la page Communication de Maestro »

Étape d'investigation avant correction (à faire en premier de ce bloc) :

- Rejouer un SMS, un appel, un enregistrement et une analyse IA et lire les logs corrélés du point 1 pour identifier l'étape en échec (auth courtier, mauvais `maestro_broker_id`, endpoint refusé, 405/404).
- Vérifier si les objets sont poussés sur le bon courtier (identité Maestro résolue en direct) et sur les endpoints attendus par la page Communication (activités/notes vs endpoints génériques).
- Selon le résultat : corriger l'endpoint/format de payload, ou rattacher les objets au contact Maestro (client) pour qu'ils apparaissent dans son fil de communication.
- Ajouter un bouton « Rejouer la synchro » par appel/SMS une fois la cause identifiée.

## Détails techniques

- Fichiers touchés : `src/pages/planipret/mobile/MMessages.tsx` (+ copie `apps/planipret-mobile/...`), `supabase/functions/pp-ns-sms`, `maestro-sync-message`, `maestro-sync-call`, `maestro-recording-upload`, `maestro-transcript`, `maestro-ai-analysis`, `_shared/maestro.ts`.
- Migration : colonne `idempotency_key` + index unique sur `planipret_phone_messages`, index sur `planipret_pipeline_logs(correlation_id)`.
- Aucun changement au SIP, à l'audio ni à l'OAuth Microsoft.
