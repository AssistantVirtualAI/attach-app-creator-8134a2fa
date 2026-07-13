# Rendre l'agent vocal AVA pleinement opérationnel : MS365 live + téléphonie + Claude

## Objectif
Quand un courtier parle à AVA (agent vocal ElevenLabs), elle doit pouvoir, en direct, sans intervention manuelle :
- Chercher un contact dans **le répertoire Microsoft 365** (People + Contacts + `planipret_contacts` + Maestro).
- **Appeler** (via NS/PBX) et **envoyer un SMS**.
- **Envoyer un courriel** MS365, **résumer** les courriels reçus et **proposer une réponse** rédigée par **Claude (Anthropic)**.
- **Créer, modifier, annuler** un rendez‑vous dans le calendrier MS365.
- Tout résumer (courriels, appels, journée).

## État actuel (déjà en place — à vérifier, pas à refaire)
- `ms365-actions` couvre déjà : `read_emails`, `read_email_detail`, `send_email`, `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `send_teams_message`, `search_contact` (via `/me/people` + `/me/contacts`).
- `ava-tool-executor` expose déjà : `make_call`, `send_sms`, `send_email`, `read_emails`, `summarize_email`, `list_calendar_events`, `create_appointment`/`create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `search_client` (Maestro), `search_contact` (MS365).
- `pp-ava-chat` déclenche déjà l'auto‑lookup répertoire quand un nom/email est mentionné.
- `ms365-token-refresh` + `ms365-status` + `pp-autoconfigure_from_profile` gèrent le refresh automatique du token MS365.

## Ce qui manque / à corriger

### 1. Vérifier que l'agent ElevenLabs voit bien tous les outils MS365 + téléphonie
Aujourd'hui l'agent peut avoir une liste d'outils partielle côté ElevenLabs (webhook tools) même si le back-end expose tout. Étape :
- Ajouter dans `elevenlabs-manage-agent` une action `sync_tools` qui **écrit dans `platform_settings.tools` de l'agent** la liste canonique complète pointant sur `ava-tool-executor` avec le header `X-Ava-Tool-Name`, pour :
  `make_call, hangup_call, send_sms, get_sms_conversations, get_voicemails, read_emails, summarize_email, send_email, search_contact, list_calendar_events, create_calendar_event, update_calendar_event, delete_calendar_event, search_client, create_appointment, propose_email_reply, summarize_inbox`.
- Bouton "Resynchroniser les outils" dans `PAAvaAgent` qui appelle cette action pour l'agent par défaut et pour chaque broker ayant un `elevenlabs_agent_id`.

### 2. Intégration Claude (Anthropic) pour résumé + brouillon de réponse
- Vérifier que le secret `ANTHROPIC_API_KEY` est présent (utilisé par `ava-email-analyzer`, `ai-analyze-call`). Sinon le demander.
- Nouvel outil `propose_email_reply(message_id, tone?, language?)` dans `ava-tool-executor` :
  1. `read_email_detail` via `ms365-actions` pour récupérer le corps + expéditeur + sujet.
  2. Appel Claude (`claude-sonnet-4` ou courant) avec un prompt système FR‑CA courtier hypothécaire : renvoie `summary` (3‑4 phrases) + `draft_reply` (ton pro, québécois, salutation adaptée).
  3. Retourne `{ summary, draft_reply, to, subject_suggested }`. La voix lit le résumé et propose l'envoi ; confirmation → `send_email` avec le brouillon.
- Nouvel outil `summarize_inbox(limit=10)` : `read_emails` top N → Claude → renvoie un digest priorisé (client chaud, urgent, à répondre aujourd'hui).
- Fallback : si `ANTHROPIC_API_KEY` absent, retomber sur `google/gemini-3-flash-preview` via Lovable AI Gateway (déjà utilisé ailleurs) — l'outil ne casse pas.

### 3. Répertoire "live" étendu
- Dans `search_contact` (`ms365-actions`) : ajouter fallback `/users` (Azure AD directory) via `.default` scope si tenant B2B, puis merger avec `planipret_contacts` et `planipret_maestro_clients` — retour unifié `{source, name, email, phone, company}`.
- Étendre `pp-ava-chat` (déjà fait pour local) pour aussi injecter les résultats MS365 people dans le contexte système avant la réponse.

### 4. Système téléphonique lié à l'agent vocal
- Vérifier que `make_call` et `send_sms` fonctionnent quand la commande vocale contient uniquement un **nom** : ajouter dans `ava-tool-executor.make_call` une résolution automatique si `to_number` est absent mais `contact_name` fourni → `search_contact` → prendre le premier téléphone → sinon retourner `contact_not_found`.
- Idem pour `send_sms`.

### 5. UI d'état "connexion live"
- Dans `PAAvaAgent` (health panel) + page Courtiers, afficher pour chaque broker :
  - MS365 : connecté / token valide jusqu'à / dernier refresh (`ms365-status`).
  - Anthropic : configuré oui/non.
  - ElevenLabs agent : outils sync'd (nb d'outils vs attendus).
  - Téléphonie NS : extension enregistrée.
- Bouton "Tester" : envoie une commande vocale simulée (`pp-ava-chat` en mode test) qui déclenche `search_contact` → `propose_email_reply` sur le dernier courriel, sans envoyer.

## Fichiers touchés
- `supabase/functions/elevenlabs-manage-agent/index.ts` → action `sync_tools`.
- `supabase/functions/ava-tool-executor/index.ts` → outils `propose_email_reply`, `summarize_inbox` ; résolution nom→numéro dans `make_call`/`send_sms`.
- `supabase/functions/ms365-actions/index.ts` → `search_contact` élargi (Azure AD + merge).
- `supabase/functions/pp-ava-chat/index.ts` → injection MS365 people dans le contexte.
- `src/pages/planipret/admin/PAAvaAgent.tsx` + nouveau `AvaLiveConnectionsPanel.tsx`.
- Migration : rien (tout existe).

## Ordre de livraison
1. Vérifier / ajouter `ANTHROPIC_API_KEY` (via `add_secret` si absent).
2. `ava-tool-executor` : `propose_email_reply` + `summarize_inbox` + résolution nom→numéro.
3. `elevenlabs-manage-agent` : `sync_tools` + bouton admin.
4. `search_contact` élargi + injection dans `pp-ava-chat`.
5. Panneau d'état "connexions live" dans la page admin AVA et sur la page Courtiers.
6. Test end‑to‑end vocal (via `pp-ava-chat` mode test) : "Envoie un courriel à Jean Tremblay pour reporter notre rendez‑vous de demain à vendredi 14 h" → résolution → brouillon Claude → confirmation → envoi + update calendrier.

Confirmez pour que je passe en mode build. Si vous voulez qu'on **saute Claude et qu'on garde uniquement Gemini** (déjà gratuit via Lovable AI), dites‑le — ça évite d'ajouter la clé Anthropic.