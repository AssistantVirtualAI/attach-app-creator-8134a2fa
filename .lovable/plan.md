## Objectif

Trouver la vraie cause du renvoi immédiat en boîte vocale (ext. 113, domaine planipret.ca) alors que `113_web` et `113_mobile` sont bien enregistrés, puis corriger.

## État vérifié maintenant

- `pp-sync-answering-rules` écrit une règle "Default" avec sim-ring vers `sip:113@`, `sip:113_mobile@`, `sip:113_web@` + `forward-no-answer → vmail:113`, timeout 35s par défaut.
- Aucune fonction ne vérifie aujourd'hui la **route entrante du DID** ni la **cause de libération SIP** des appels. `pp-call-diagnostic` ne regarde que CDR/enregistrement/transcription, pas le routage entrant.
- Diagnostic non confirmé : la cause exacte n'est pas encore identifiable sans lire l'état réel côté NetSapiens. Première étape = mesurer, pas patcher.

## Étape 1 — Diagnostic inbound (nouvelle fonction `pp-inbound-diagnostic`)

Lecture seule, admin only. Pour une extension donnée, retourne l'état brut NS :

1. `GET /domains/{d}/users/{ext}` → champs `do-not-disturb`, `call-forward-*`, `voicemail-*`, `presence`.
2. `GET .../users/{ext}/answerrules` (chemin déjà auto-détecté) → règle Default telle que **NS la voit** (timeframe réellement matché, sim-ring list, timeout, no-answer target).
3. `GET .../users/{ext}/devices` (ou `/subscriptions`) → registrations réelles : `expires`, IP/port publics, NAT, user-agent.
4. `GET /domains/{d}/phonenumbers` (inventaire DID) → destination du/des DID entrants : est-ce `113`, une file, un AA, ou directement `vmail:113`.
5. Derniers CDR entrants (`/cdrs?...`) avec `release-code` / `disconnect-reason` / `term-user` / durée de sonnerie : distingue
   - 0s de sonnerie + term = `vmail` → problème de **routage** (DID/règle/timeframe),
   - sonnerie mais 480/408/486 sur les devices → problème **SIP/NAT/device**,
   - 302/DND → renvoi caché sur l'utilisateur.

Sortie : un verdict lisible (`ROUTING_TO_VOICEMAIL`, `TIMEFRAME_NOT_MATCHED`, `DEVICES_UNREACHABLE`, `HIDDEN_FORWARD`, `DID_NOT_POINTING_TO_EXT`) + payloads bruts.

## Étape 2 — Page admin de diagnostic

Bouton "Diagnostic appels entrants" dans le portail admin Planiprêt (page appareils mobiles / SIP) : sélection du courtier, affichage du verdict + détails NS bruts, en FR/EN.

## Étape 3 — Correction selon le verdict

Appliquée seulement après lecture du verdict :

- **DID → mauvaise destination** : corriger la destination d'inventaire vers l'extension (via NS-API) et l'inclure dans le sync.
- **Timeframe non matché** : la règle est inerte → recréer avec le timeframe réellement retourné par NS au lieu de `*`.
- **Sim-ring invalide** : NS refuse parfois des AOR de devices dans la sim-ring list → basculer sur "ring user's extension + ring all user's phones" (flags) plutôt qu'une liste d'AOR.
- **Devices injoignables (NAT/registration fantôme)** : renforcer keep-alive/re-REGISTER natif et le push VoIP de réveil avant l'INVITE.
- **Renvoi/DND caché sur l'utilisateur** : forcer la remise à zéro des champs utilisateur, pas seulement de la règle.

## Étape 4 — Validation

Appel test via `pp-mobile-testcall` puis re-run du diagnostic : confirmer sonnerie sur `113_mobile` et CDR avec sonnerie > 0s avant tout renvoi en boîte vocale.

## Détails techniques

- Nouvelle fonction : `supabase/functions/pp-inbound-diagnostic/index.ts`, utilise `nsFetch` + garde admin (`is_planipret_admin` / `is_super_admin`) comme `pp-sync-answering-rules`.
- Aucun secret exposé ; les réponses NS sont tronquées et loguées dans `planipret_edge_function_runs`.
- Modifications potentielles ensuite : `pp-sync-answering-rules` (timeframe réel + flags de sonnerie), `ns-webhook-receiver` (push avant INVITE), config natif keep-alive.
