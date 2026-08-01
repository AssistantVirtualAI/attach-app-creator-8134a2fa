# AVA + Maestro : liste des clients qui ne fonctionne pas (chat & voix)

## Ce qui se passe aujourd'hui

Quand tu demandes la liste Maestro, AVA propose des boutons ("List Maestro clients", "Read more emails", "Search contact"). Cliquer dessus ne fait rien d'utile : elle répète le même message.

Cause confirmée dans le code :

- `pp-ava-chat` traite les clics de suggestions via `confirm_action`, mais il n'existe **que 3 branches** : `ms365_action`, `sms`, `call`. Il n'y a **aucune branche `maestro_action`**. Le clic retombe donc dans le flux de chat normal, sans nouveau message utilisateur → le modèle reformule la même réponse.
- La récupération automatique de la liste Maestro n'est déclenchée que si le texte contient `client/courtier/broker/dossier/portefeuille` (regex FR/EN partielle) — beaucoup de formulations passent à côté.
- `maestro-actions` exige un `maestro_broker_id` numérique dans `planipret_profiles`; s'il manque, il renvoie `maestro_user_id_unresolved` et le chat n'affiche aucune erreur explicite.
- Côté voix : `elevenlabs-tool-handler` implémente bien `list_my_clients`, `list_my_brokers`, `client_profile`, `broker_profile`, mais **aucune fonction ne déclare ces outils à l'agent ElevenLabs**. Si l'agent n'a pas les webhook tools configurés, il ne les appellera jamais.
- Bug visuel visible sur ta capture : des clés i18n brutes s'affichent (`avaChat.chatTab`, `avaChat.voiceTab`, `avaChat.inputPlaceholder`, `avaChat.listen`) — traductions manquantes.

## Ce que je vais corriger

### 1. Exécution réelle des suggestions Maestro (chat)
- Ajouter dans `pp-ava-chat` une branche `confirmAction.kind === "maestro_action"` qui appelle `maestro-actions` avec `list_clients` / `client_profile` / `list_brokers` / `broker_profile`.
- Le résultat est renvoyé formaté (nom, téléphone, courriel) dans la réponse, pas juste un « action exécutée ».
- Journalisation via `logAvaAction` comme pour MS365.
- Fallback clair : si l'action est inconnue ou échoue, message d'erreur explicite au lieu d'une répétition.

### 2. Détection plus fiable de la demande Maestro
- Élargir le déclencheur (liste, pipeline, prospects, « mes clients », « my clients », « Maestro », etc.) pour pré-charger la liste dans le contexte dès la première question.
- Si `maestro_user_id_unresolved` est retourné, AVA le dit clairement (« ton compte n'est pas encore lié à Maestro ») au lieu de rester vague.

### 3. Anti-répétition
- Après un clic de suggestion, la réponse ne repasse plus par le prompt libre : elle est construite à partir des données Maestro reçues, donc pas de duplication du message précédent.
- Les suggestions déjà exécutées ne sont pas reproposées à l'identique.

### 4. Agent vocal ElevenLabs
- Ajouter une fonction de synchronisation qui déclare/actualise les webhook tools de l'agent ElevenLabs (`list_my_clients`, `get_maestro_client_profile`, `list_my_brokers`, `get_maestro_broker_profile`, plus les outils appel/SMS/courriel existants) vers `elevenlabs-tool-handler`, avec leurs schémas de paramètres.
- Mettre à jour le prompt système de l'agent vocal pour qu'il utilise ces outils au lieu de dire qu'il n'a pas accès.
- Vérification post-sync : lister les outils réellement attachés à l'agent.

### 5. Traductions manquantes
- Ajouter les clés `avaChat.*` manquantes en FR et EN pour supprimer les libellés bruts visibles à l'écran.

## Détails techniques

Fichiers touchés :
- `supabase/functions/pp-ava-chat/index.ts` (branche `maestro_action`, détection élargie, messages d'erreur)
- `supabase/functions/elevenlabs-tool-handler/index.ts` (vérif/ajustement des cas Maestro si nécessaire)
- nouvelle fonction `pp-ava-voice-tools-sync` (déclaration des tools sur l'agent ElevenLabs via l'API ElevenLabs)
- `apps/planipret-mobile/src/pages/planipret/mobile/MAvaChat.tsx` (affichage résultat liste, pas de re-proposition) + copie miroir dans `src/`
- fichiers de traduction `avaChat.*`

Déploiement des Edge Functions modifiées après édition. Aucune écriture DID/NetSapiens n'est impliquée.
