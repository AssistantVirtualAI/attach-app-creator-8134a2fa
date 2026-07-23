# Plan — Corriger SSO Microsoft, envoi SMS/Appels AVA et intégration MS365

## 1. Bouton « Continuer » gris dans l’écran Microsoft (mobile Planiprêt)

**Cause** : l’écran « Essayez‑vous de vous connecter à AVA Soft Phone ? » est la page de conformité mobile Entra ID. Le bouton reste désactivé quand `redirect_uri` envoyé ne correspond pas exactement à un URI **de plateforme mobile/desktop publique** enregistrée, ou quand `client_id` est marqué « web » seulement.

**Actions**
- Dans `src/lib/ms365AuthLogin.ts` + `apps/planipret-mobile/src/lib/ms365AuthLogin.ts` : forcer le scheme `planipret://auth/ms365-callback` sur natif (Capacitor) et l’URL HTTPS `${origin}/planipret/ms365-callback` sur web. Ne jamais mélanger.
- Dans `pp-ms-auth-start` : renvoyer explicitement `redirect_uri` selon le paramètre `platform` (`mobile` vs `web`) reçu du client, et l’enregistrer dans le state PKCE.
- Dans `pp-ms-auth-callback` : valider que le `redirect_uri` de l’échange token = celui du state (sinon `invalid_grant`).
- Documenter (README) que Scott doit avoir enregistré dans Entra, sous le **même** App Registration :
  - Plateforme **Mobile and desktop applications** → `planipret://auth/ms365-callback`
  - Plateforme **Web** → `https://avastatistic.ca/planipret/ms365-callback` + Supabase callback
  - Activer `Allow public client flows = Yes`
- Ajouter un fallback UX : si l’écran mobile Microsoft bloque, MobileAuthScreen affiche un bouton « Ouvrir dans le navigateur système » (`@capacitor/browser` → `Browser.open`), qui contourne le WKWebView.

## 2. Envoi SMS via chatbot AVA (numéro jamais reçu)

**Cause probable** : `send_sms` retourne `success:true` dès que NS-API répond 200, mais NS-API renvoie souvent 200 avec `result: { error: "..." }` (ex. DID non SMS‑enabled, destinataire non valide, from mismatch). De plus, l’UI ne montre pas le message envoyé dans la vraie thread.

**Actions**
- `supabase/functions/pp-ns-sms/index.ts` : après `res.ok`, inspecter `result` — si `result?.error` ou `result?.status === "failed"`, renvoyer `{ ok: false, error: result.error }` (200 → 200 mais avec ok=false). Ajouter log clair (`console.error`).
- Renforcer `normalizeE164` : rejeter tout numéro < 10 chiffres au lieu de préfixer `+`.
- `ava-tool-executor` `send_sms` : après appel `pp-ns-sms`, si `ok`, **diffuser un événement Realtime** (`broadcastNav`) vers `/mplanipret/messages?thread=<id>` pour ouvrir la conversation dans l’app et afficher le message envoyé.
- Ajouter tool `open_sms_composer` : au lieu d’envoyer directement, permet à AVA d’ouvrir l’UI SMS avec `to` et `message` préremplis, l’utilisateur appuie sur Envoyer. Utile quand `to` est ambigu ou message long. AVA choisit `send_sms` (confirmation écrite) vs `open_sms_composer` selon le prompt.
- Mettre à jour prompt système `pp-ava-chat` : après confirmation écrite, appeler `send_sms` **puis** `navigate_to /mplanipret/messages` pour que le courtier voie la thread.

## 3. Appels via chatbot AVA (« Je lance l’appel » sans rien)

**Cause** : `make_call` appelle `pp-ns-calls` action `start` qui déclenche le click‑to‑call NetSapiens (ring vers le softphone puis compose la destination). Si le device n’est pas registered ou si le CID n’est pas SMS/voix, l’appel échoue silencieusement.

**Actions**
- `pp-ns-calls` : renvoyer `device_registered:false` quand aucun endpoint n’est actif, avec message explicite; propager dans réponse AVA.
- `ava-tool-executor` `make_call` : si `device_registered === false`, retomber sur **ouverture du dialer mobile** avec le numéro préchargé (nouvel event Realtime `open_dialer` → mobile app écoute et navigue vers `/mplanipret/calls` + ouvre `FabDialer` avec numéro).
- Ajouter tool `open_dialer` (pareil à open_sms_composer) pour laisser AVA décider : `make_call` (direct via PBX) vs `open_dialer` (composeur UI).
- Prompt AVA `pp-ava-chat` : après confirmation, appeler `make_call`; si `device_registered:false`, tomber sur `open_dialer` automatiquement et informer le courtier.
- Ajouter listener global dans `MobileApp.tsx` / `PlanipretMobile.tsx` pour événements Realtime `pp:navigate` avec `open_dialer` / `open_sms_composer` payload et rediriger vers le bon écran avec les params.

## 4. Intégration Microsoft complète du chatbot

Vérifier que les tools existants sont bien exposés et fonctionnent :
- Emails : `send_email` (déjà), ajouter `reply_email`, `forward_email` via `ms365-actions`.
- Calendrier : `create_calendar_event`, `move_calendar_event`, `cancel_calendar_event`, `update_calendar_event` (déjà). Vérifier confirmation écrite pour delete/update.
- Teams : `list_teams_chats`, `create_teams_chat`, `send_teams_message` (déjà). Vérifier que `ms365-teams-list` retourne 200 avec le token courtier.
- Ajouter au **prompt système** de `pp-ava-chat` la liste complète des capacités MS365 pour qu’AVA les propose spontanément.
- Ajouter test `pp-call-e2e-check` étendu qui vérifie l’auth MS365 par courtier avant chaque session de chat, avec bannière « Reconnecter Microsoft » si `needs_reconnect`.

## Détails techniques

**Fichiers principaux modifiés**
- `src/lib/ms365AuthLogin.ts`, `apps/planipret-mobile/src/lib/ms365AuthLogin.ts`
- `src/components/planipret/mobile/MobileAuthScreen.tsx` + variante mobile (bouton fallback navigateur)
- `supabase/functions/pp-ms-auth-start/index.ts`, `pp-ms-auth-callback/index.ts` (validation redirect_uri par plateforme)
- `supabase/functions/pp-ns-sms/index.ts` (inspection result NS-API, normalisation stricte)
- `supabase/functions/pp-ns-calls/index.ts` (device_registered dans réponse)
- `supabase/functions/ava-tool-executor/index.ts` (tools `open_dialer`, `open_sms_composer`, fallback make_call → open_dialer, navigate après send_sms)
- `supabase/functions/pp-ava-chat/index.ts` (prompt système + confirmations)
- `src/pages/planipret/mobile/MMessages.tsx`, `MCalls.tsx` + `FabDialer` (écoute events Realtime `open_*`, préremplissage)
- `apps/planipret-mobile/**` équivalent

**Verrous respectés**
- Aucune modification de `/mplanipret` routes, `MplanipretGuard`, `App.tsx` (mémoire `mplanipret-isolation-locked`).
- Landing page non touchée.

## Étape de validation
1. Rebuild + `npx cap sync` iOS/Android.
2. Test SSO MS : bouton « Continuer » actif, retour dans l’app authentifié.
3. Test chat : « envoie SMS à X » → confirmation écrite → SMS reçu + navigation vers thread.
4. Test chat : « appelle X » → soit ring téléphone, soit dialer préchargé.
5. Test chat : email, événement calendrier, message Teams — vérifier retour succès + effet réel dans Outlook/Teams.
