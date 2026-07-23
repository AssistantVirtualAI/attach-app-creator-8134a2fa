# Plan — Audit AVA + Sync Microsoft 365 complet

## Partie 1 — Audit AVA chatbot (vérification connexions & normalisation)

### 1.1 Outils AVA existants confirmés
`ava-tool-executor` expose déjà : `make_call`, `send_sms`, `send_email`, `read_emails`, `send_teams_message`, `list_teams_chats`, `create_teams_chat`, `create_calendar_event`, `get_calendar_today/week`, `move/cancel/update/delete_calendar_event`, `find_contact` (fusion Maestro + local), `search_ms365_contacts`, `push_call_summary`, etc.

### 1.2 Corrections d'audit à faire
- **Normalisation E.164** : centraliser dans un helper `_shared/phone-normalize.ts` (règle : détecte 10 chiffres → préfixe `+1`, strip `()- .`, valide `^\+[1-9]\d{7,14}$`). L'appliquer dans `send_sms`, `make_call`, `resolveContact`, `find_contact`, et `pp-ns-sms` / `pp-ns-calls` côté entrée. Consigner en log si un numéro est rejeté.
- **Vérifier tokens MS365 avant appel** : dans `msAction`, si `ms365_access_token` absent ou expiré → invoquer `ms365-token-refresh` puis réessayer une fois; sinon retourner `{success:false, error:"ms365_not_connected", fallback:"open_settings"}`.
- **`get_integration_status`** : ajouter check réel (ping léger `/me` Graph, `/me` NetSapiens, `/ping` Maestro) au lieu de simple présence du token.
- **Prompt système `pp-ava-chat`** : documenter les outils avec exemples (déjà partiel), ajouter règles bilingues et confirmation textuelle uniforme.

## Partie 2 — Historique courriel & auto-complétion contacts

### 2.1 Nouvelles tables (migration)
```
planipret_email_messages       -- copie locale des mails MS365 (id graph, thread_id, from, to[], cc[], subject, body_preview, body_html, sent_at, received_at, folder, is_read, is_sent_by_me, has_attachments, importance)
planipret_email_threads        -- conversation_id → dernier subject, participants[], last_activity_at, unread_count
planipret_ms_contacts          -- contacts importés MS365 (graph_id, display_name, emails[], phones[], company, job_title, last_synced_at)
planipret_calendar_events      -- events MS365 (graph_id, subject, start, end, attendees[], location, is_online_meeting, join_url)
planipret_teams_conversations  -- chats/sessions Teams (chat_id, topic, members[], last_message_at, last_message_preview)
planipret_teams_messages       -- messages Teams (chat_id, graph_id, from, content, sent_at)
planipret_ms_sync_state        -- par user_id + resource(mail|contacts|calendar|teams) : delta_link, last_full_sync_at, status, error
```
Toutes avec RLS `user_id = auth.uid()`, GRANT `authenticated`+`service_role`, index sur `(user_id, sent_at desc)`, `(user_id, thread_id)`, `(user_id, email)` pour lookup rapide.

### 2.2 Nouvelles edge functions
- `ms365-full-import` : orchestrateur invoqué au signin OU depuis Settings → « Synchroniser Microsoft 365 ». Lance en parallèle 4 workers via `EdgeRuntime.waitUntil` :
  - `ms365-sync-contacts` : `GET /me/contacts?$top=100` + pagination `@odata.nextLink`, upsert dans `planipret_ms_contacts`.
  - `ms365-sync-mail` : premier passage `GET /me/mailFolders/inbox/messages?$top=50` + Sent Items ; passages suivants `GET /me/mailFolders/{id}/messages/delta` avec `delta_link` stocké. Upsert dans `planipret_email_messages`, dédup par `graph_id`.
  - `ms365-sync-calendar` : `GET /me/calendarView/delta?startDateTime=...&endDateTime=+90d`.
  - `ms365-sync-teams` : `GET /me/chats?$expand=members`, puis pour chaque chat `GET /me/chats/{id}/messages` (limité à 50 récents).
- `ms365-sync-status` : retourne progression par ressource (%, dernière erreur, delta link présent) pour l'UI.
- `ms365-contacts-search` : recherche locale rapide `ILIKE` sur `planipret_ms_contacts.display_name`/`emails` (autocomplétion instantanée dans le composer email).

### 2.3 Déclencheurs de sync
1. **À la connexion MS365** : dans `Ms365Callback.tsx` et `pp-ms-auth-callback`, après stockage du token, appeler `ms365-full-import` (mode `initial`).
2. **Depuis Settings** : nouveau bouton « Réimporter maintenant » dans `MMs365Diagnostics.tsx` → `ms365-full-import` (mode `manual`).
3. **Cron delta** : réutiliser cron existant ou nouveau appelant `ms365-full-import` (mode `delta`) toutes les 15 min.
4. **À la déconnexion MS365** : conserver l'historique local (ne pas supprimer) mais marquer `planipret_ms_sync_state.status = 'disconnected'`.

### 2.4 UI courriel améliorée (`MMessages.tsx` + `EmailComposeSheet`)
- Onglet « Boîte de réception » lit d'abord `planipret_email_messages` (instantané), puis rafraîchit via `ms365-actions/read_emails`.
- Fil de conversation (`thread_id`) : quand on ouvre un courriel, afficher tous les messages du même `conversation_id` avec toggle « Répondre » qui préremplit destinataires.
- **Autocomplétion À/Cc** : nouveau composant `RecipientAutocomplete` qui interroge `ms365-contacts-search` (contacts MS365) + `planipret_contacts` (locaux) + « déjà écrit à » (distinct `to` des `planipret_email_messages` de l'utilisateur). Fusion + dédup par email, tri par récence.
- Badge « Déjà en contact » quand l'adresse tapée existe dans `planipret_email_messages` (indique nombre de messages échangés).

### 2.5 Page Contacts améliorée (`MContacts.tsx`)
- Ajouter source badge (Maestro / MS365 / Local).
- Filtrer / rechercher via `planipret_ms_contacts` + `planipret_contacts` + `maestro_clients`.
- Bouton « Réimporter les contacts Microsoft ».

## Partie 3 — Détails techniques

**Delta sync Graph** : `Prefer: odata.maxpagesize=50` header + boucle `@odata.deltaLink` pour incrémental. Sauver `delta_link` dans `planipret_ms_sync_state.delta_link`.

**Rate limits Graph** : respecter `Retry-After` sur 429, backoff exponentiel. Batch requests (`$batch`) quand ≥5 items.

**Sécurité** : toutes les tables scoped `user_id = auth.uid()`. Aucun token Graph exposé côté client. Toutes les invocations Graph via `_shared/ms365-client.ts` centralisé avec refresh auto.

**Rebuild / redeploy** : les 4 nouvelles fonctions + migration + code frontend. Après rebuild : `npx cap sync` pour l'app mobile.

## Livraison ordonnée
1. Migration DB (7 tables + indexes + RLS + GRANT).
2. Helper `_shared/phone-normalize.ts` + `_shared/ms365-client.ts` (fetch + auto-refresh).
3. Edge functions : `ms365-sync-{contacts,mail,calendar,teams}` + `ms365-full-import` + `ms365-sync-status` + `ms365-contacts-search`.
4. Patch `ava-tool-executor` : normalisation E.164 + `get_integration_status` réel.
5. Frontend : `RecipientAutocomplete`, refonte `MMessages` (threads + cache local), badge « Déjà en contact », bouton resync dans Settings + Auth callback.
6. Déclenchement auto sync dans `Ms365Callback.tsx` et `pp-ms-auth-callback`.
