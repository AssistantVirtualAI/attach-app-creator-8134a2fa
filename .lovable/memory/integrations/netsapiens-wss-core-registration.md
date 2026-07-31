---
name: NetSapiens WSS registration target = core1/core2
description: SIP clients must REGISTER to core1/core2.cluster1.ucstack.io:9002, never the portal (voice.ava-telecom.ca → portal1)
type: feature
---

Carrier rule (2026-07, confirmé par l'opérateur): les clients SIP doivent s'enregistrer sur un **noeud de traitement d'appels** `core1.cluster1.ucstack.io:9002` ou `core2.cluster1.ucstack.io:9002`.

`voice.ava-telecom.ca:9002` résout vers `portal1.cluster1.ucstack.io` (serveur portail): le REGISTER est accepté mais l'enregistrement n'est **pas** utilisé pour livrer les appels entrants → boîte vocale directe.

Implémentation:
- `src/lib/planipret/sip/sipEdgePolicy.ts` et `apps/planipret-mobile/src/lib/planipret/sip/sipEdgePolicy.ts`: `isPortalWssUrl` (drop) / `isCoreWssUrl` (préféré), fallback `core1` puis `core2`.
- `supabase/functions/ns-resolve-sip-credentials`: `NS_SIP_WSS_URL` défaut `wss://core1...:9002`, `NS_SIP_WSS_URL_2` = core2; portail filtré.
- `ns-provision-broker-devices`: `core-server` = `core1.cluster1.ucstack.io`.
- `verify-sip-bundle.mjs`: interdit `wss://voice.ava-telecom.ca:9002` dans le bundle.

Remplace l'ancienne théorie "core nodes drain clients (1001)" — la cause réelle du 1001 était le portail / double REGISTER sur la même AOR.
