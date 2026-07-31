# Appels entrants en arrière-plan → boîte vocale

## Ce que j'ai vérifié dans le code (état actuel)

1. `supabase/functions/ns-webhook-setup/index.ts` ligne 11 : `const desired = ["cdr", "message", "voicemail"]`.
   **Le modèle `call` n'est pas abonné.** Aucun événement n'est donc émis quand un appel commence à sonner.
2. `supabase/functions/ns-webhook-receiver/index.ts` ligne 196 : la branche qui envoie le push VoIP (`sendVoipPush`) ne s'exécute que si `type === "call.inbound"`. Comme aucun abonnement `call` n'existe, **cette branche n'est jamais atteinte** → aucun push PushKit → l'app suspendue ne se réveille jamais → l'appel va en boîte vocale. Tout le reste de la chaîne (table `planipret_voip_push_tokens`, JWT APNs, `apns-push-type: voip`, plugin `PpVoipCall`, `PpSipKeepAlive.wakeForPush`) est déjà en place et correct.
3. `ns-webhook-setup` envoie aussi `{ event, target_url }`, alors que la doc NS-API v2 (`docs/netsapiens/webhooks.md`) impose `{ model, post-url, domain, user, subscription-geo-support }`. Les abonnements actuels peuvent donc être partiellement invalides.
4. Le receiver lit `event.type` sur un objet unique, alors que NS poste **un tableau d'objets** dont le schéma est celui de la ressource (`call`), sans champ `type`.
5. `docs/netsapiens/devices.md` : `device-push-enabled` doit valoir `yes` pour que la plateforme accepte qu'un client mobile vive de push plutôt que d'un REGISTER permanent.
6. Latence documentée : les abonnements NS sont livrés par **poll DB toutes les 3 s** — le délai de sonnerie doit en tenir compte.

## Objectif

Réveiller l'app via PushKit dès que l'appel sonne, sans toucher aux DID, aux règles de routage existantes, ni à la config SIP qui fonctionne.

## Plan

### 1. Abonnement NetSapiens au modèle `call` (conforme v2)
- Dans `ns-webhook-setup`, passer `desired` à `["call", "cdr", "message", "voicemail"]`.
- Corriger le corps de la requête au format documenté : `{ model, "post-url", domain, user: "*", "subscription-geo-support": "yes" }`, et faire la détection d'existant sur `model` + `post-url` (gérer le 409 « already exists » comme un succès).
- Aucune suppression des abonnements existants : on ne crée que ce qui manque.

### 2. Normaliser la réception des événements `call`
Dans `ns-webhook-receiver` :
- Accepter un **tableau** d'objets en plus de l'objet unique (boucle sur les entrées).
- Déduire le type : si l'objet porte des champs de la ressource `call` (`orig_callid`/`term_user`/`call-orig-user`…), le traiter comme `call.inbound` quand `remove !== "yes"` et que la direction est entrante vers l'extension du courtier ; ignorer les mises à jour de teardown.
- Dédupliquer par `orig_callid` (mémoire courte en base) pour ne pas envoyer 3–4 pushs pour le même appel, puisque le modèle `call` émet à chaque changement d'état.
- Conserver strictement la logique DND, Realtime et `sendVoipPush` déjà écrite.

### 3. Payload PushKit
- Garder le format actuel, en garantissant la présence de `call_id`, `callerName`, `callerNumber` (le plugin `PpVoipCall` doit toujours signaler un appel CallKit à chaque push, exigence iOS 13+, sinon iOS révoque le token).
- Ajouter un log de résultat APNs par appel pour diagnostiquer côté fonction.

### 4. Vérification `device-push-enabled`
- Ajouter une lecture (GET) dans le diagnostic existant pour afficher `device-push-enabled` et `device-sip-registration-state` des AOR `…M`/`…W`. **Lecture seule** — aucune écriture automatique vers NetSapiens, conformément à la contrainte « no automated DID/NS writes ».
- Si la valeur est `no`, je le signale dans l'écran de diagnostic pour correction manuelle dans le portail.

### 5. Fenêtre de sonnerie
- Vérifier (sans modifier les règles déjà appliquées) que le timeout de sonnerie utilisé par `pp-sync-answering-rules` reste ≥ 30 s, afin de couvrir : poll NS 3 s + APNs ~1 s + réveil + REGISTER + INVITE. Si un courtier est en dessous, je le signale plutôt que de réécrire silencieusement sa règle.

### 6. Tests
- Test unitaire du normalisateur d'événements `call` (tableau, dédup, `remove: yes` ignoré).
- Vérification `OPTIONS`/`POST` sur `ns-webhook-setup` et `ns-webhook-receiver` après déploiement, puis appel réel avec app suspendue.

## Ce qui ne sera pas touché
- Aucune écriture DID / dial-rule / assignation de numéro.
- Aucune modification de `sipEdgePolicy`, du pinning core1, ni du flux de handoff natif ↔ JsSIP corrigé récemment.
- Aucun changement des règles de réponse déjà synchronisées.

## Détails techniques
Fichiers concernés : `supabase/functions/ns-webhook-setup/index.ts`, `supabase/functions/ns-webhook-receiver/index.ts`, un helper `parseNsCallEvents` partagé + son test, et l'écran de diagnostic mobile pour l'affichage `device-push-enabled` (lecture seule).
