# Lemtel — gates de failover automatique pour la topologie HA actuelle

## Portée et état réel attesté

Cette documentation et les fichiers sous `infra/lemtel-resilience/automatic-failover/` décrivent **uniquement** la topologie Lemtel actuelle :

| Élément | État réel attesté | Conséquence |
|---|---|---|
| Writer PostgreSQL | `do_writer` | Seul writer autorisé avant incident. |
| Standby PostgreSQL | `hostinger_private_hot_standby` | Privé, en recovery et streaming synchrone. |
| Intégrité des écritures | Synchronisme PostgreSQL et preuve de durabilité de stockage exigés | Aucun basculement sur santé ambiguë ou preuve de stockage incomplète. |
| Runtime Hostinger | Runtime chiffré staged, runtime arrêté | Le staging n’autorise ni démarrage ni trafic. |
| Cloudflare | Monitor, pool DO et pool Hostinger présents | **Aucun Load Balancer ni routage actif**. Le monitor ne promeut jamais PostgreSQL. |

Le contrat de base conserve tous les flags d’activation à `false`, notamment le fencing fournisseur automatique, la promotion, le démarrage runtime, le routage trafic et le failback.

## Ce qui n’est pas prêt

Le failover automatique est **bloqué fail-closed** tant que les preuves suivantes ne sont pas fournies et validées pour l’incident :

1. attestation locale signée de fencing du `do_writer`, reçue de façon sécurisée hors bande ;
2. drill de fencing fournisseur et drill de promotion Hostinger ;
3. preuve du standby privé en recovery/streaming, de l’intégrité stockage et de l’absence de listener PostgreSQL public ;
4. preuve de writer unique après promotion ;
5. configuration et drill du Load Balancer/routage Cloudflare avec priorité `do_writer`, puis `hostinger_private_hot_standby` ;
6. drill de reverse failback et validation du retry mobile.

Le module `scripts/lemtel-current-topology-failover-gate.mjs` est volontairement pur et en mémoire : sans toutes ces preuves fournies par l’appelant, il retourne `automatic_failover_blocked` avec le code `78`. Même avec un jeu complet de preuves, son succès signifie seulement `manual_failover_readiness_evidence_complete` ; il n’active aucune action automatique.

## Ordre strict d’une procédure manuelle ultérieure

> Cet ordre est une barrière de sécurité : aucune étape ultérieure ne compense une étape antérieure absente ou ambiguë.

1. **Fencing fournisseur du writer DO** — recevoir et vérifier hors bande l’attestation signée que `do_writer` ne peut plus écrire.
2. **Promotion Hostinger** — seulement après la preuve de fencing ; le garde-fou de promotion vérifie recovery/streaming, stage chiffré arrêté et absence de base publique, mais ne promeut jamais lui-même.
3. **Runtime Hostinger** — seulement après un état local de promotion existant et une preuve signée de writer unique ; le garde-fou post-promotion ne démarre jamais le runtime.
4. **Routage Cloudflare** — seulement après les trois étapes précédentes et une configuration Load Balancer/routage explicitement autorisée. Le monitor Cloudflare observe ; il ne fence pas et ne promeut pas.

Le **failback automatique est désactivé**. Tout retour vers DO exige une nouvelle procédure humaine, des preuves fraîches et un drill validé ; il ne doit pas être inféré d’un retour de santé.

## Fichiers de garde-fou

| Fichier | Rôle limité |
|---|---|
| `infra/lemtel-resilience/automatic-failover/current-topology-contract.json` | Contrat strict de la topologie actuelle, de ses exclusions et de ses gates. |
| `lemtel-ha-do-writer-provider-fence-evidence.sh` | Contrat root-only de réception hors bande ; aucun appel fournisseur et aucun fencing réel. |
| `lemtel-ha-hostinger-auto-promotion-guard.sh` | Vérification locale root-only de readiness ; aucune promotion ni démarrage runtime. |
| `lemtel-ha-hostinger-post-promotion-runtime-guard.sh` | Vérification locale root-only post-promotion ; aucun démarrage runtime ni routage. |
| `scripts/lemtel-current-topology-failover-gate.mjs` | Évaluation pure en mémoire, bloquée par défaut. |

Ces fichiers **remplacent pour l’état actuel** le chemin historique à rôles inversés (`hostinger_primary` / `digitalocean_standby`). Les scripts historiques sont conservés sans modification : ils peuvent documenter un drill ancien et **ne doivent pas automatiser** la topologie actuelle `do_writer` / `hostinger_private_hot_standby`.

## Limites explicites

Aucun de ces artefacts ne contient de secret, token, adresse IP ou identifiant fournisseur. Ils ne modifient pas Planipret, Avastatistic, FusionPBX, ni la téléphonie. Ils ne contactent pas un fournisseur, Cloudflare, PostgreSQL distant, ni aucun runtime.
