
## Diagnostic

Trois problèmes distincts confirmés en lisant le code :

1. **RDV créé « virtuellement » mais pas dans Outlook**  
   Le prompt liste deux outils quasi identiques : `create_appointment` (Maestro CRM uniquement, aucun appel à Graph) et `create_calendar_event` (Outlook via `ms365-actions`). L'agent choisit souvent `create_appointment` quand on lui dit « prends un RDV », ce qui écrit dans Maestro mais **jamais** dans le calendrier Microsoft. De plus, `create_calendar_event` retourne `success: !!j?.success` mais le message affiché est toujours « RDV créé » — donc en cas d'échec Graph (token expiré, scope manquant), l'agent l'annonce comme un succès.

2. **Contacts Microsoft introuvables**  
   `resolveContact` interroge bien `/me/people` + `/me/contacts` via `msAction("search_contact")`, mais **aucun tool `find_contact` / `search_contact` n'est exposé** dans `TOOL_NAMES` (ava-agent-config). L'agent ne peut donc chercher un contact que de manière indirecte (via `send_email` avec `contact_name`), pas explicitement. En plus, le scope OAuth actuel manque `Contacts.Read`, ce qui fait tomber `/me/contacts` sur certains tenants.

3. **Teams non branché**  
   Aucun tool Teams n'est exposé à l'agent (ni `send_teams_message`, ni `list_teams_chats`, ni `create_teams_chat`). Les fonctions existent (`ms365-actions` → `send_teams_message`, `ms365-teams-list`, `ms365-teams-messages`) mais ne sont pas déclarées dans `TOOL_NAMES` ni implémentées dans `ava-tool-executor`.

## Correctifs

### 1. `supabase/functions/ava-tool-executor/index.ts`
Ajouter les tools manquants :
- **`find_contact`** — wrap direct de `msAction("search_contact")` + fallback contacts locaux/Maestro. Retourne `{ email, phone, name, source }` pour que l'agent puisse ensuite appeler `send_email`, `make_call`, `send_teams_message`.
- **`list_teams_chats`** — appelle `ms365-teams-list` pour lister les chats récents (id + participants).
- **`send_teams_message`** — route vers `ms365-actions/send_teams_message`. Accepte : `chat_id` OU (`team_id` + `channel_id`) OU `contact_name` / `contact_email` → résout l'utilisateur Graph (`/users?$filter=mail eq …`), crée un chat 1-1 via `ms365-teams-messages/create_chat`, puis envoie.
- **`create_teams_chat`** — wrap `ms365-teams-messages/create_chat` (1-1 ou groupe).

Modifier :
- **`create_calendar_event`** — si `j.success` est faux, retourner `{ success: false, error, message: "Le rendez-vous n'a PAS été créé dans Outlook : <raison Graph>" }` pour empêcher AVA d'annoncer un faux succès.
- **`create_appointment` (Maestro)** — après création Maestro, si MS365 est connecté, **mirroir automatique** dans Outlook via `create_calendar_event` (mêmes participants, dates, sujet). Retourner `{ maestro_id, outlook_event_id, outlook_synced: true|false }`.

### 2. `supabase/functions/ava-agent-config/index.ts`
- Ajouter à `TOOL_NAMES` : `find_contact`, `list_teams_chats`, `send_teams_message`, `create_teams_chat`.
- Section CAPACITÉS du prompt : ajouter bloc « TEAMS » et « CONTACTS ».
- Nouvelle règle d'orchestration explicite :
  > **RDV/MEETING** — Un « rendez-vous dans le calendrier » = **TOUJOURS** `create_calendar_event` (Outlook). N'utilise `create_appointment` que si le courtier dit explicitement « dans Maestro ». Après appel, vérifie `success === true` avant d'annoncer la réussite ; si `false`, lis la raison au courtier.
  > **CONTACT** — Avant tout envoi (courriel, SMS, Teams, appel) sans coordonnées explicites, appelle d'abord `find_contact` pour résoudre nom → email/téléphone/id Microsoft.
  > **TEAMS** — Pour envoyer un message Teams à une personne : `find_contact` → `send_teams_message { contact_email }` (le tool crée le chat 1-1 automatiquement).

### 3. Scopes OAuth Microsoft
Ajouter `Contacts.Read` (et confirmer `User.Read.All` pour la résolution des IDs Teams) dans la constante `MS_SCOPE` de :
- `supabase/functions/ms365-actions/index.ts`
- `supabase/functions/ms365-teams-messages/index.ts`
- `supabase/functions/ms365-oauth-exchange/index.ts` (à vérifier)

Les courtiers déjà connectés devront **reconnecter** Microsoft une fois (message dans l'UI). J'ajoute une détection : si `ms365_scopes` ne contient pas `Contacts.Read`, le tool `find_contact` retourne `{ success: false, needs_reconnect: true, message: "Reconnecte Microsoft 365 pour activer les contacts" }`.

## Vérification

1. `tsgo` sur les fonctions modifiées.
2. Depuis l'app mobile, session AVA :
   - « Trouve Jean Dupont » → doit appeler `find_contact` et retourner email/tél.
   - « Envoie un message Teams à Jean : test » → `find_contact` → `send_teams_message` → confirmer dans Teams.
   - « Book un RDV demain 14h avec Jean » → `create_calendar_event` → vérifier l'évènement dans Outlook mobile ; en cas d'échec Graph, AVA doit dire « pas créé » et pourquoi.
3. `supabase--edge_function_logs` sur `ava-tool-executor` et `ms365-actions` pour valider les appels réels.

## Aucun impact

- Aucune migration DB.
- Aucun changement UI (les tools sont côté serveur/agent).
- Comportement existant (`send_email`, `read_emails`, `create_calendar_event`, etc.) conservé, juste plus robuste.
