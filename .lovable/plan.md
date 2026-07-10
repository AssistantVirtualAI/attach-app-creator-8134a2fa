# Plan AVA — Chatbot + Agent Vocal IA (ElevenLabs) omniscient

Objectif: dans l'app mobile Planiprêt, un toggle transforme le chatbot texte en agent vocal IA (ElevenLabs Conversational AI) qui reconnaît le courtier, le salue par prénom, et peut TOUT faire (appels, SMS, emails M365, calendrier, Maestro, voicemails, deals, contacts, stats). Voix configurable depuis Settings.

---

## Phase 1 — Fondations & audit
- Auditer l'existant: `elevenlabs-agent-config`, `elevenlabs-tool-handler`, `pp-ava-chat`, `MAvaChat.tsx`, table `planipret_elevenlabs_config`, toggles portail admin (App mobile / Agent IA).
- Confirmer connecteur ElevenLabs lié (sinon `standard_connectors--connect elevenlabs`) → `ELEVENLABS_API_KEY`.
- Ajouter colonnes manquantes sur `planipret_profiles`: `ava_voice_id`, `ava_voice_stability`, `ava_voice_similarity`, `ava_voice_style`, `ava_agent_enabled`, `ava_chat_enabled`, `elevenlabs_agent_id`, `elevenlabs_conv_id`.

## Phase 2 — Provisioning d'un agent ElevenLabs par courtier
- Edge fn `pp-ava-provision-agent`: crée (ou met à jour) un agent ElevenLabs personnalisé par courtier via `POST /v1/convai/agents/create` avec:
  - system prompt dynamique (nom, extension, domaine, contexte Planiprêt/Maestro)
  - `first_message`: "Bonjour {prénom}, comment je peux t'aider aujourd'hui?"
  - liste complète des tools (webhook tools pointant vers `elevenlabs-tool-handler`)
  - voix par défaut (paramètres du profil)
- Déclenché quand admin active le toggle "Agent IA" ou au premier login courtier.
- Stocke `elevenlabs_agent_id` dans `planipret_profiles`.

## Phase 3 — Catalogue d'outils (tool registry) exhaustif
Étendre `elevenlabs-tool-handler` avec TOUS les outils, chacun mappé à une edge fn existante:
- **Téléphonie**: `make_call`, `hangup_call`, `transfer_call`, `get_call_history`, `get_active_calls`, `read_voicemails`, `mark_voicemail_read`
- **SMS**: `send_sms`, `read_sms_thread`, `list_sms_threads`
- **Emails M365**: `read_emails`, `search_emails`, `summarize_email`, `send_email`, `reply_email`, `archive_email`
- **Calendrier**: `list_events`, `create_calendar_event`, `update_event`, `cancel_event`, `find_free_slot`
- **Maestro CRM**: `search_contact`, `get_contact`, `create_contact`, `update_contact`, `list_deals`, `get_deal`, `create_task`, `list_tasks`, `complete_task`, `add_note`
- **Stats & brief**: `get_daily_briefing`, `get_stats_today`, `get_pipeline_summary`
- **Navigation app**: `open_page` (voicemail, emails, deals, contacts, appels), `open_contact`, `open_deal`
- Chaque outil: schéma JSON strict, `needsApproval` pour actions destructives (envoi email/SMS, création RDV, appel).

## Phase 4 — Token WebRTC & sécurité
- Edge fn `pp-ava-elevenlabs-token`: retourne un `conversation_token` WebRTC scopé à l'agent du courtier (`GET /v1/convai/conversation/token?agent_id=...`).
- Auth JWT courtier obligatoire; audit log dans `ai_request_audit_log`.
- Rate limiting par user_id.

## Phase 5 — UI mobile: toggle Chat ↔ Vocal
- `MAvaChat.tsx`: ajouter switch header "💬 Chat / 🎙️ Vocal".
- Mode Chat: comportement actuel (`pp-ava-chat`).
- Mode Vocal: monte `<VoiceAgentPanel>` utilisant `@elevenlabs/react` `useConversation`:
  - Bouton micro central animé (waveform via `getInputByteFrequencyData`)
  - Statut: "AVA écoute...", "AVA parle...", transcripts live
  - Historique messages persistant dans `planipret_ava_conversations`
- Préférence toggle sauvée par courtier.

## Phase 6 — Client tools & navigation intégrée
- Enregistrer `clientTools` dans `useConversation` pour actions locales:
  - `navigate_to(page)` → `useNavigate`
  - `show_toast(message)`, `open_dialer(number)`, `open_sms_composer(number, text)`
  - `confirm_action(label)` → dialog natif de confirmation avant action destructive
- Permet à l'agent d'ouvrir n'importe quelle page du mobile pendant la conversation.

## Phase 7 — Settings vocaux (Studio Voix)
- Nouvelle page `MSettingsVoice.tsx`:
  - Liste voix ElevenLabs via `GET /v1/voices` (edge fn `pp-ava-list-voices`)
  - Preview 3s par voix (`POST /v1/text-to-speech/{voice_id}` avec phrase test)
  - Sliders: stability, similarity, style, speed
  - Champ prompt système personnalisable (avec reset au défaut)
  - Sauvegarde → update `planipret_profiles` + `PATCH /v1/convai/agents/{id}` pour propager à ElevenLabs.

## Phase 8 — Toggles portail admin fonctionnels
- Portail admin `PAUsers.tsx`: toggles "App mobile" et "Agent IA":
  - Activer "Agent IA" → provisionne agent ElevenLabs (Phase 2) + met `ava_agent_enabled=true`
  - Désactiver → `DELETE /v1/convai/agents/{id}` + flag off
  - Activer "App mobile" → active chatbot texte uniquement
- Feedback loading + toast erreurs.

## Phase 9 — Contexte proactif & mémoire
- Injecter contexte dynamique dans chaque conversation (via `contextual_update`):
  - Rappels du jour, appels manqués, voicemails non lus, deals actifs, RDV à venir
- Persistance conversations dans `planipret_ava_conversations` (transcript complet + tool_calls) pour continuité entre sessions.
- Résumé automatique post-conversation (edge fn `pp-ava-summarize`).

## Phase 10 — QA, permissions natives, monitoring
- Permissions micro iOS/Android (Capacitor) + prompts UX clairs.
- Tests E2E Playwright: toggle chat↔vocal, chaque tool, provisioning, changement voix.
- Dashboard admin: usage ElevenLabs (minutes, coût), taux erreur tools, feedback courtiers.
- Docs courtier: guide "Parler à AVA".
- Sentry pour erreurs WebRTC/tool calls.

---

## Détails techniques
- **Stack**: ElevenLabs Conversational AI (WebRTC), `@elevenlabs/react` `useConversation`, Supabase Edge Functions (Deno), Capacitor mobile.
- **Sécurité**: `ELEVENLABS_API_KEY` server-only; tokens WebRTC courts; approval côté client pour actions destructives; audit log complet.
- **Modèle**: agent ElevenLabs avec LLM configuré côté ElevenLabs (GPT-4o ou Gemini) + tools webhook vers Supabase.
- **Voix par défaut**: `EXAVITQu4vr4xnSDxMaL` (Sarah, français bilingue) — modifiable par courtier.

Confirme et je passe en mode build pour exécuter les phases dans l'ordre (1→10).