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
