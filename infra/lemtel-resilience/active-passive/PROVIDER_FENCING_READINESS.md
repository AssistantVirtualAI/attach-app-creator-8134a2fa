# Lemtel — préparation du fencing fournisseur

> **Statut : préparation vérifiée en lecture seule, aucune action fournisseur autorisée.** Ce document ne donne aucun identifiant de ressource, adresse, token, clé ou détail d’exploitation.

Le 13 octobre 2026, les APIs DigitalOcean et Hostinger ont répondu aux inventaires lecture seule. Cette preuve confirme les accès de consultation et les inventaires de VPS ; elle ne confirme **pas** le droit d’arrêter une machine, et elle ne lance aucune action.

## Décision de sécurité

Le fencing automatique reste désactivé. L’arbitre doit refuser une promotion dans les cas suivants :

- l’ancien writer est encore accessible ou son état fournisseur est ambigu ;
- aucun reçu fournisseur n’atteste l’action de fencing ;
- l’état terminal du VPS n’est pas confirmé ;
- PostgreSQL/Storage/runtime du standby ne sont pas prêts ;
- le Load Balancer Cloudflare n’est pas configuré et validé.

Une perte réseau seule est toujours insuffisante. Elle peut isoler l’arbitre du writer sans arrêter ses écritures : promouvoir le standby dans ce cas créerait deux writers.

## Ordre de fencing prévu — DigitalOcean

1. L’arbitre ouvre un incident unique et fige son identifiant.
2. Il lit l’état du writer et confirme que la demande cible le writer attendu.
3. Après l’autorisation explicite d’incident, il demande d’abord un arrêt gracieux `shutdown`.
4. Il attend l’action renvoyée par le fournisseur jusqu’à l’état terminal.
5. Si le délai approuvé expire sans arrêt confirmé, il demande `power_off`, puis attend de nouveau l’état terminal.
6. Il relit l’état du VPS. La promotion reste bloquée tant que l’état ne confirme pas qu’il n’est plus actif.
7. Il écrit un reçu redacted d’incident. Seul ce reçu, lié à l’identifiant d’incident, peut être présenté au garde de promotion Hostinger.

DigitalOcean recommande précisément la séquence arrêt gracieux puis `power_off` en secours, et expose une action récupérable par son identifiant pour suivi. [1]

## Ordre de fencing prévu — Hostinger

Quand Hostinger serait le writer après un failover confirmé, le même principe s’inverse :

1. l’arbitre lit l’état du VPS attendu ;
2. il demande l’action `stop` uniquement après autorisation d’incident ;
3. il conserve le reçu de l’action ;
4. il relit le VPS jusqu’à l’état terminal non actif ;
5. il écrit le reçu redacted avant toute promotion de DO.

Hostinger documente `POST /api/vps/v1/virtual-machines/{virtualMachineId}/stop` et la lecture de l’état du VPS via `GET /api/vps/v1/virtual-machines/{virtualMachineId}`. [2] [3]

## Arbitre indépendant : contrat minimal

L’arbitre doit s’exécuter hors de DO et Hostinger. Il doit avoir son propre journal d’incidents et produire une décision **deny by default**. Sa chaîne de décision est :

```text
Sondes indépendantes + état fournisseur cohérent
  → incident unique
  → fencing fournisseur confirmé
  → reçu redacted à usage unique
  → prévol standby local
  → promotion contrôlée
  → démarrage runtime contrôlé
  → routage uniquement après santé publique
```

Le Load Balancer Cloudflare ne décide jamais seul d’une promotion PostgreSQL. Sa fonction est de diriger les requêtes vers un pool sain **après** que le writer correspondant a été prouvé prêt. Cloudflare décrit l’active-passive comme deux pools, le secondaire n’étant choisi que lorsque le primaire passe sous son seuil de santé. [4]

## Non inclus

- aucun arrêt/démarrage VPS ;
- aucun token ou identifiant fournisseur ;
- aucun DNS, Cloudflare Load Balancing, pool ou monitor ;
- aucune promotion PostgreSQL ou activation de runtime Hostinger ;
- aucun changement téléphonie.

## Étapes restantes avant activation

1. Obtenir une autorisation explicite pour tester les permissions d’action fournisseur dans une fenêtre contrôlée ; ce test peut arrêter un writer, il n’est donc pas effectué ici.
2. Déployer l’arbitre indépendant en observation seule et tester ses décisions de refus.
3. Prouver la réplication PostgreSQL synchrone et la durabilité Storage double-écriture.
4. Configurer et tester le Load Balancer Cloudflare après confirmation explicite du coût.
5. Exécuter un drill complet de fencing, promotion, reprise de trafic et reconstruction inverse.

## Références

[1]: https://docs.digitalocean.com/reference/api/reference/droplet-actions/ "DigitalOcean Droplet Actions"
[2]: https://docs.hostinger.com/api-reference/endpoints/vps/virtual-machine/stop-virtual-machine "Hostinger Stop Virtual Machine"
[3]: https://docs.hostinger.com/api-reference/endpoints/vps/virtual-machine/get-virtual-machine-details "Hostinger Get Virtual Machine Details"
[4]: https://developers.cloudflare.com/load-balancing/load-balancers/common-configurations/ "Cloudflare Active-Passive Failover"
