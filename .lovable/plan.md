# Agent vocal AVA — fix déconnexion + page admin complète

## Partie 1 — Fix de la déconnexion de l'agent vocal

### Diagnostic
Le composant `AvaVoiceAgent.tsx` (mobile) suit cette séquence :
1. `getUserMedia` → mic OK
2. `ava-agent-config` (retry ×3)
3. `pp-ava-webrtc-token` (retry ×3) — renvoie `token` **et** `signed_url`
4. `Conversation.startSession({ connectionType: "websocket", signedUrl, overrides })` (retry ×2)
5. Si échec → `onFallbackToChat()` → bascule chatbot

Causes probables de la déconnexion observée :
- **`overrides` non autorisés côté ElevenLabs** : envoyer `overrides.agent.prompt` / `firstMessage` / `language` / `tts.voiceId` alors que ces overrides ne sont pas activés dans le dashboard ElevenLabs ferme le WS immédiatement après connexion.
- **WebSocket signed_url plus fragile que WebRTC** sur mobile iOS (proxy réseau, keepalive). Le code force `websocket` alors que le token WebRTC est déjà minté.
- **Aucune journalisation** de la raison de la fermeture : `onError` ne stocke rien, `fallback()` masque le vrai motif.
- **Retry trop agressif** : 2 tentatives de `startSession` back-to-back peuvent invalider le `signed_url` déjà consommé (usage unique).

### Correctifs

1. **`AvaVoiceAgent.tsx`**
   - Essayer **WebRTC en premier** avec `conversationToken`, puis fallback WebSocket avec `signedUrl` si WebRTC échoue.
   - Ne pas relancer `startSession` sur le même `signed_url` (usage unique) — refetch le token à chaque tentative.
   - Ne passer `overrides` que si `ava-agent-config` renvoie `overrides_enabled: true` (nouveau champ).
   - Sur `onError` / `onDisconnect` prématuré (< 2 s après `onConnect`), loguer dans `planipret_ava_sessions` avec code + message, afficher un état "Erreur — Réessayer" avant de basculer chat (fallback seulement après clic ou 2ᵉ échec).
   - Passer `micStream` déjà obtenu à `startSession` pour éviter une 2ᵉ demande de permission.

2. **`supabase/functions/ava-agent-config/index.ts`**
   - Interroger `GET /v1/convai/agents/:id` ElevenLabs pour lire `platform_settings.overrides` et retourner `overrides_enabled`, `agent_status`, `voice_id_effective`.

3. **`supabase/functions/pp-ava-webrtc-token/index.ts`**
   - Accepter `?type=webrtc|websocket` et ne minter que ce qui est demandé (évite d'invalider inutilement les URLs).
   - Retourner un `error_details` structuré si ElevenLabs renvoie 4xx/5xx (au lieu de `502` opaque).

4. **Nouvelle table `planipret_ava_sessions`** (journal court terme) :
   ```
   id, user_id, session_id, connection_type, agent_id,
   started_at, ended_at, disconnect_reason, error_code, error_message
   ```
   Avec RLS : broker lit ses propres sessions, admins voient tout.

## Partie 2 — Page admin complète pour l'agent vocal

La page `/planipret/admin/ava-agent` existe déjà (`PAAvaAgent.tsx` + `ElevenLabsManagementCard`) mais est limitée à un seul agent partagé. On la refond en tableau de bord complet.

### Nouvelles sections (dans `PAAvaAgent.tsx`)

1. **État de santé** (haut de page)
   - Ping ElevenLabs API + statut compte (crédits restants, quotas)
   - Statut de chaque agent (actif / archivé)
   - Compteur sessions live (via `planipret_ava_sessions` où `ended_at IS NULL`)
   - Erreurs des dernières 24h (top 5 raisons)

2. **Agents (multi-brokers)**
   - Table : broker, extension, `elevenlabs_agent_id`, `voice_agent_enabled`, dernière session, nb sessions 7j, erreurs 24h
   - Actions par ligne : activer/désactiver, resynchroniser prompt/voix, tester (ouvre l'overlay AVA en admin sous cette identité via impersonation), voir logs sessions

3. **Configuration globale** (garde `ElevenLabsManagementCard` existante)
   - Voix par défaut, system prompt de base, outils MCP synchronisés, webhooks
   - Ajout : toggles pour chaque `override` autorisé (prompt / firstMessage / language / tts) — écrit dans `platform_settings.overrides` via `elevenlabs-manage-agent`

4. **Autonomie & sécurité**
   - Sélecteur du `autonomy_mode` par défaut (`confirm | semi_auto | full_auto`)
   - Outils nécessitant confirmation (édition de `CONFIRM_REQUIRED`)

5. **Journal des sessions**
   - Timeline paginée depuis `planipret_ava_sessions` (broker, durée, transport, motif de fin, erreur)
   - Filtre par broker / erreur / période

6. **Test en direct**
   - Bouton "Lancer une session test" → mint token pour l'admin lui-même, ouvre `AvaVoiceAgent` en modale, affiche la trace bas-niveau (events WS/WebRTC) pour debug.

### Nouvelles/étendues edge functions

- `elevenlabs-manage-agent` : ajouter actions `update_overrides_policy`, `get_account_status`, `list_all_agents`, `impersonate_test_token`.
- `planipret-admin-ava-analytics` : ajouter `sessions_live`, `sessions_last_24h`, `top_errors`.

## Détails techniques

### Fichiers modifiés
- `apps/planipret-mobile/src/components/planipret/mobile/AvaVoiceAgent.tsx` + copie `src/components/planipret/mobile/AvaVoiceAgent.tsx`
- `supabase/functions/ava-agent-config/index.ts`
- `supabase/functions/pp-ava-webrtc-token/index.ts`
- `supabase/functions/elevenlabs-manage-agent/index.ts`
- `supabase/functions/planipret-admin-ava-analytics/index.ts`
- `src/pages/planipret/admin/PAAvaAgent.tsx`
- `src/components/planipret/admin/integrations/ElevenLabsManagementCard.tsx`
- Nouveaux : `AvaAgentsTable.tsx`, `AvaSessionsTimeline.tsx`, `AvaHealthPanel.tsx`, `AvaLiveTestModal.tsx`

### Nouvelle migration
- Table `planipret_ava_sessions` + GRANTs + RLS (broker=self, admin=all) + index `(user_id, started_at desc)`.

### Ordre de sortie
```text
1. Migration table sessions
2. Edge functions (config + webrtc-token + manage-agent + analytics)
3. AvaVoiceAgent (WebRTC-first + logging + no auto-fallback)
4. PAAvaAgent refonte (health + agents + sessions + test)
```

### Ce que ça change pour l'utilisateur
- L'agent vocal ne bascule plus silencieusement en chat : il retente proprement, affiche l'erreur réelle, ne coupe la voix qu'après confirmation ou 2ᵉ échec.
- L'admin voit d'un coup d'œil quels courtiers ont un agent, qui a des erreurs, et peut tester + activer/désactiver la voix par broker.

Confirmez pour que je lance l'implémentation (Partie 1 puis Partie 2), ou dites-moi si vous voulez qu'on fasse d'abord uniquement le fix de la déconnexion.
