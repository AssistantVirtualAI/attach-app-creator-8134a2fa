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

1. binding et migration Durable Object isolés Lemtel, singleton/lease/ledger revus sans fallback KV ;
2. reçu HMAC de fencing du `do_writer`, validé par l’agent puis persisté root-only, lié au même incident et avec deux confirmations terminales ;
3. drill de fencing fournisseur et drill de promotion Hostinger ;
4. preuve du standby privé en recovery/streaming, de l’intégrité stockage et de l’absence de listener PostgreSQL public ;
5. preuve de writer unique après promotion ;
6. configuration et drill du Load Balancer/routage Cloudflare avec priorité `do_writer`, puis `hostinger_private_hot_standby` ;
7. drill de reverse failback et validation du retry mobile.

Le module `scripts/lemtel-current-topology-failover-gate.mjs` est volontairement pur et en mémoire : sans toutes ces preuves fournies par l’appelant, il retourne `automatic_failover_blocked` avec le code `78`. Même avec un jeu complet de preuves, son succès signifie seulement `manual_failover_readiness_evidence_complete` ; il n’active aucune action automatique.

## Ordre strict d’une procédure manuelle ultérieure

> Cet ordre est une barrière de sécurité : aucune étape ultérieure ne compense une étape antérieure absente ou ambiguë.

1. **Fencing fournisseur du writer DO** — l’arbitre vérifie `shutdown`/`power_off`, action terminale, état `off` et deux confirmations ; l’agent Hostinger valide le reçu HMAC puis le persiste root-only.
2. **Promotion Hostinger** — seulement après le reçu persisté ; le script de promotion vérifie incident, recovery/streaming, stage chiffré arrêté, absence de base publique et fencé DO avant de promouvoir.
3. **Runtime Hostinger** — seulement après un état local de promotion existant et le même reçu HMAC ; le script de runtime vérifie writer promu, Storage et absence de listener PostgreSQL public avant de démarrer le runtime.
4. **Routage Cloudflare** — seulement après les trois étapes précédentes et une configuration Load Balancer/routage explicitement autorisée. Le monitor Cloudflare observe ; il ne fence pas et ne promeut pas.

Le **failback automatique est désactivé**. Tout retour vers DO exige une nouvelle procédure humaine, des preuves fraîches et un drill validé ; il ne doit pas être inféré d’un retour de santé.

## Fichiers de garde-fou

| Fichier | Rôle limité |
|---|---|
| `infra/lemtel-resilience/automatic-failover/current-topology-contract.json` | Contrat strict de la topologie actuelle, de ses exclusions et de ses gates. |
| `lemtel-failover-arbiter-worker.mjs` | Classe Durable Object et Worker status-only : lease/ledger transactionnels avant observation/fencing/préparation, sans binding/migration provisionnés ni commande HTTP. Voir [correction source-only](DURABLE_OBJECT_SERIALIZATION_SOURCE_ONLY.md). |
| `lemtel-ha-hostinger-failover-agent.sh` | Validation HMAC, ledger one-time, persistance root-only du reçu et orchestration locale `review`/`execute`. |
| `lemtel-ha-hostinger-current-topology-promote.sh` | Promotion locale uniquement après reçu HMAC, stage et gates PostgreSQL. |
| `lemtel-ha-hostinger-current-topology-runtime-start.sh` | Démarrage runtime local uniquement après promotion et reçu HMAC ; aucun routage. |
| `scripts/lemtel-current-topology-failover-gate.mjs` | Évaluation pure en mémoire, bloquée par défaut. |

Ces fichiers **remplacent pour l’état actuel** le chemin historique à rôles inversés (`hostinger_primary` / `digitalocean_standby`). Les scripts historiques sont conservés sans modification : ils peuvent documenter un drill ancien et **ne doivent pas automatiser** la topologie actuelle `do_writer` / `hostinger_private_hot_standby`.

## Limites explicites

Aucun de ces artefacts ne contient de secret, token, adresse IP ou identifiant fournisseur. Ils ne modifient pas Planipret, Avastatistic, FusionPBX, ni la téléphonie. Ils ne contactent pas un fournisseur, Cloudflare, PostgreSQL distant, ni aucun runtime.
