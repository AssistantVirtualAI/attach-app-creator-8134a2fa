## Objectif

Connecter l'app mobile Planiprêt aux mêmes endpoints Maestro Telecom REST API que le widget, pour les appels, SMS et communications.

## Config API

- Base : `https://client-dev.planipret.com/telecom/api/v1`
- Tous les appels ajoutent `?machine=1`
- Header : `Authorization: Bearer <MAESTRO_TELECOM_API_KEY>`

Le token que tu as collé dans le chat est un secret : je vais le stocker via `add_secret` sous `MAESTRO_TELECOM_API_KEY` + `MAESTRO_TELECOM_BASE_URL`. **Ne le rentre jamais en clair dans le code.** À rouler chez Planiprêt car exposé dans le chat.

## Architecture

Un seul edge function proxy `maestro-telecom` qui :
- Reçoit `{ path, method, body, query }` du mobile
- Appelle Maestro server-side (le Bearer token ne quitte jamais le backend)
- Résout automatiquement le `{id}` Maestro de l'utilisateur courant (mapping `auth.uid()` → `maestro_user_id` déjà présent dans `planipret_user_maestro_link` / profils; je vérifierai en build)
- Log erreurs + audit

Côté mobile : petit client `maestroTelecom.ts` avec méthodes typées :

```
getSip()
lookupByPhone(phone)
createCall({ providerCallId, toUserId, toUserNumber, status, direction })
listCalls() / listCallsWithContact(contact)
updateCall(callId, { status, endedReason })
getRecording(callId) / getTranscription(callId) / getVoicemail(callId)
markCallRead(callId)
sendMessage({ toUserId, toUserNumber, message })
getInbox() / getMessagesWith(phone) / markMessagesRead(phone)
getRecentCommunications() / getAllCommunications()
getUserCommunications(userId) / getUserMessagesWith(userId, phone)
```

## Intégration dans les écrans existants

- **Appels sortants** (`useMplanipretSoftphone` / `PlanipretMobile`) : après création SIP côté NS, appeler `createCall` Maestro pour enregistrer le CDR côté Planiprêt ; `updateCall` sur `dialing → connected → ended` avec `ended_reason`.
- **SMS** (`MMessages`, `pp-ns-sms`) : envoi via `sendMessage` Maestro à la place / en plus de NS ; inbox et thread lus depuis `getInbox` / `getMessagesWith`.
- **Historique appels** (`MCalls`) : `listCalls` + `getRecording/Transcription/Voicemail` pour les détails.
- **SIP credentials** (`useMplanipretSoftphone`) : possibilité de récupérer creds via `getSip` si Maestro devient source de vérité (à confirmer — voir question ci-dessous).
- **Contact card** (`MContacts` / caller lookup) : `lookupByPhone` en complément de `pp-caller-lookup`.

## Étapes

1. Enregistrer les secrets `MAESTRO_TELECOM_API_KEY` et `MAESTRO_TELECOM_BASE_URL` (staging).
2. Créer edge function `maestro-telecom` (proxy authentifié + résolution du user id Maestro).
3. Créer `apps/planipret-mobile/src/lib/planipret/maestroTelecom.ts` (client typé).
4. Brancher `createCall` / `updateCall` dans le flow softphone.
5. Brancher `sendMessage` + `getInbox` + `getMessagesWith` dans `MMessages`.
6. Brancher `listCalls` + recording/transcription/voicemail dans `MCalls`.
7. Tester chaque endpoint via `curl_edge_functions` avec un user connecté.

## Questions rapides avant de coder

1. **SIP credentials** : le mobile continue d'utiliser les creds NS actuelles, ou on bascule sur `GET /users/{id}/sip` de Maestro comme source unique ?
2. **SMS** : Maestro remplace `pp-ns-sms` complètement, ou les deux coexistent (Maestro pour log/inbox, NS pour l'envoi réel) ?
3. **Env** : je pars sur staging `client-dev.planipret.com` uniquement pour l'instant, ou aussi prévoir un `MAESTRO_TELECOM_BASE_URL_PROD` togglé par env ?