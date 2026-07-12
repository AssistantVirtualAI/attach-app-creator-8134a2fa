# Plan — Agent vocal AI unique ElevenLabs pour tous les courtiers Planiprêt

## Objectif
Un **seul agent ElevenLabs Conversational AI** partagé par tous les courtiers, personnalisé à la volée par variables dynamiques (nom, prénom, org), branché sur:
- Stats & actions PBX (FusionPBX) : passer un appel, envoyer un SMS, lire stats
- Microsoft 365 : lire/résumer/envoyer email, créer/déplacer/annuler meetings calendrier

## Architecture

```text
Mobile/Web (Planiprêt)
   │  useConversation (SDK @elevenlabs/react)
   │  ├─ fetch  /elevenlabs-signed-url  → token WebRTC
   │  └─ overrides: { firstName, lastName, brokerId, orgId, extension }
   ▼
ElevenLabs Convai Agent (1 seul, ID en config)
   │  Server tools (webhook) → toutes routées vers :
   ▼
supabase/functions/ava-voice-tool-router  (nouveau, 1 endpoint)
   │  Vérifie HMAC ElevenLabs, résout brokerId → user_id/org
   │  Dispatch selon `tool_name` :
   ├─► pbx.place_call        → fusionpbx-proxy (originate)
   ├─► pbx.send_sms          → pbx-write (sms_send)
   ├─► pbx.get_stats         → planipret-admin-ava-analytics
   ├─► pbx.recent_calls      → pbx_call_records (RLS user)
   ├─► ms365.read_emails     → ms365-actions:list_messages
   ├─► ms365.summarize_email → ava-email-analyzer
   ├─► ms365.send_email      → ms365-actions:send_email
   ├─► calendar.create_event → ms365-actions:create_calendar_event
   ├─► calendar.move_event   → ms365-actions:update_event
   └─► calendar.cancel_event → ms365-actions:delete_event
```

Réutilise `ms365-actions` et `fusionpbx-proxy` déjà existants — pas de duplication.

## 1. Configuration ElevenLabs (une fois)

Dans dashboard ElevenLabs :
- Créer 1 agent "Ava — Assistant Courtier Planiprêt"
- **Dynamic variables activées** : `broker_first_name`, `broker_last_name`, `broker_extension`, `org_name`
- **System prompt** utilisant `{{broker_first_name}}` : "Tu es Ava, l'assistante vocale de {{broker_first_name}} {{broker_last_name}}…"
- **First message** : "Bonjour {{broker_first_name}}, que puis-je faire pour vous ?"
- **Overrides autorisés** : prompt, firstMessage, language
- **Server tools** (webhook type) : 10 tools ci-dessus, tous pointant vers `https://<project>.supabase.co/functions/v1/ava-voice-tool-router` avec header secret HMAC
- Stocker `ELEVENLABS_AGENT_ID` et `ELEVENLABS_TOOL_HMAC_SECRET` en secrets

## 2. Backend — nouvelles/modifs edge functions

**`elevenlabs-signed-url`** (existe déjà, à adapter)
- Reçoit session utilisateur → renvoie `{ token, dynamicVariables: { broker_first_name, broker_last_name, broker_extension, org_name } }`
- Le brokerId n'est PAS envoyé au client dans les variables sensibles ; injecté côté server via `conversation_config_override`

**`ava-voice-tool-router`** (nouveau — unique webhook pour tous les tools)
- Vérifie signature HMAC ElevenLabs
- Extrait `conversation_id` + custom metadata (broker_id transmis à `startSession`)
- Récupère user/org depuis `pbx_softphone_users` par extension
- Switch sur `tool_name`, appelle la function interne appropriée avec service role
- Log dans `planipret_ava_action_log`
- Retourne réponse JSON structurée que l'agent verbalise

**Extensions ms365-actions** (vérifier présence, ajouter si manquant) :
- `update_calendar_event` (déplacer)
- `delete_calendar_event` (annuler)
- `summarize_email` → délègue à `ava-email-analyzer`

## 3. Frontend — mobile & web

**Nouveau hook `useAvaVoiceAgent`** (`apps/planipret-mobile/src/hooks/`)
- Charge session → appelle `elevenlabs-signed-url`
- Démarre `useConversation` avec `conversationToken` + overrides dynamiques
- Gère mic permission, statuts, VU-mètre

**Composant `AvaVoiceButton`** — bouton flottant micro dans header
- États : idle / connecting / listening / speaking
- Ouvre panneau plein écran pendant conversation
- Affiche transcription live + suggestions

Intégration : remplace/complète la voix actuelle `openVoice` dans `avaProactive.ts`.

## 4. Sécurité

- **HMAC** obligatoire sur webhook tools (rejet 401 sinon)
- **Broker identity** : jamais fait confiance au client ; l'edge function résout depuis la session Supabase et l'injecte via `conversation_config_override.agent.prompt.variables` côté serveur uniquement
- **Consent** : bannière première utilisation (mic + enregistrement conversation)
- **Audit** : tous les tool calls loggés dans `planipret_ava_action_log` (existant)
- **RLS** : les tools respectent l'org du courtier (JWT synthétique ou filtres explicites)
- Actions destructives (send_email, cancel_event) : logguées, éventuellement confirmées vocalement avant exécution

## 5. Détails techniques

- SDK : `npm install @elevenlabs/react` dans `apps/planipret-mobile`
- Connexion : **WebRTC** (latence < WebSocket)
- Modèle : `eleven_turbo_v2_5` pour temps réel FR
- Locale par défaut : `fr` (override possible)
- Timeout tool : 15 s max (garder handlers rapides) — pour analyses email longues, retourner "je traite en arrière-plan" et notifier via `planipret_ava_notifications`
- Secrets requis : `ELEVENLABS_API_KEY` (via connecteur standard), `ELEVENLABS_AGENT_ID`, `ELEVENLABS_TOOL_HMAC_SECRET`

## 6. Étapes de livraison

1. Provisionner l'agent ElevenLabs + secrets
2. Créer `ava-voice-tool-router` + compléter `ms365-actions`
3. Adapter `elevenlabs-signed-url` (variables dynamiques + override serveur)
4. Ajouter hook + bouton vocal côté mobile
5. Tests bout-en-bout : appel, SMS, création meeting, résumé inbox
6. Rollout progressif via feature flag `ava_voice_enabled` sur `planipret_settings`

## Hors-scope (à confirmer)
- Pas de numéro de téléphone entrant pour Ava (appel outbound depuis l'app uniquement)
- Pas de multi-agents par courtier — 1 seul, personnalisé par variables
- Pas de fine-tuning du modèle vocal

Confirme et je passe en mode build.
