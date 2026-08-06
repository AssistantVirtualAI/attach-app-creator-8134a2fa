---
name: NetSapiens ring announcement (avis d'enregistrement)
description: Avis d'enregistrement d'appel — entrants uniquement; music-on-ring est domain-only, ignoré sur l'objet user
type: feature
---

## Règle métier
L'avis « cet appel est enregistré » s'adresse **uniquement aux personnes qui appellent le DID d'un courtier**.
Un courtier ne doit **jamais** l'entendre sur ses propres appels **sortants**.

## Côté app (corrigé 2026-08-04)
- `playRecordingNotice(callKey, direction)` — retourne immédiatement si `direction === "out"`.
- `PpActiveCallScreen.tsx` (web + `apps/planipret-mobile`) n'appelle la fonction que si `snap.direction === "in"`.

## Côté NetSapiens — mesuré, ne pas re-tester à l'aveugle
- `music-on-ring-enabled` au niveau du **domaine** joue le média précoce sur **toutes** les jambes qui sonnent, entrantes **et sortantes** → c'était la cause du message entendu par les courtiers. Maintenant à `no`.
- `music-on-ring-enabled` sur l'objet **user** : le `PUT` renvoie `202 Accepted` mais la valeur **n'est jamais persistée** (relecture = `null`). Le scoping par utilisateur est un **no-op**.
- Les answer rules n'offrent **aucune** annonce pré-décrochage (seulement `call-screening`, qui fait enregistrer son nom à l'appelant — pas équivalent).
- Conséquence de l'état actuel : plus d'avis en média précoce du tout. Pour le restaurer aux **entrants seulement**, il faut passer par le **routage entrant (dial-rule / DID)** — et toute écriture DID doit respecter l'invariant `dial-rule-translation-destination-user`.

## Edge function `pp-ns-ring-announcement`
- `status` — lit l'état domaine + par utilisateur.
- `scope_users` / `fix` — coupe le domaine (état recommandé aujourd'hui).
- `restore` / `enable_domain` — **dépannage uniquement**, réintroduit le message sur les sortants.

## Incident 2026-08-05 — intro de file bloquante
`queue-intro-message` est joué **avant** que la file sonne les agents et **n'est pas interruptible** :
le courtier voyait l'appel, décrochait, l'intro continuait, puis timeout → boîte vocale, avec compteur
d'appel actif côté mobile (incohérence « un appel sur deux »).
Correctif : `queue-intro-message-enabled: "no"`, l'avis est joué en **musique d'attente**
(`music-on-hold-name = ava-recording-notice`) — média de sonnerie, coupe net au décrochage.
Action `repair_queues` de `pp-ns-did-announcement` (bouton « Réparer les files ») pour corriger les files existantes.

## Champs réels des files (mesurés 2026-08-06)
- Création/MAJ file : `queue` (obligatoire), `callqueue-dispatch-type: "Ring All"`,
  `callqueue-agent-dispatch-timeout-seconds`, `callqueue-max-wait-timeout-minutes`.
  Les clés `queue-type` / `music-on-hold-*` / `queue-intro-*` sont **ignorées** (400 ou silencieux).
- Agent : POST `.../callqueues/{q}/agents` avec `queue`, `user`, `device: sip:{ext}@{domain}`.
- **Aucune MOH par file** : la file hérite du MOH du **domaine** (`GET /domains/{d}/moh`),
  dont l'unique fichier est `moh-01.wav` = l'avis d'enregistrement.
- `pp-ns-did-announcement` : `enable` ne repointe plus un DID si la file n'existe pas ;
  le self-heal au boot ne tourne que si l'en-tête `x-selfheal: 1` est présent (sinon IDLE_TIMEOUT) ;
  `status`/`enable`/`disable` acceptent `offset`/`limit` pour traiter par lots.
- État au 2026-08-06 : tous les DID étaient en `to-user-residential` (aucun avis). Poste 111 activé et validé.
