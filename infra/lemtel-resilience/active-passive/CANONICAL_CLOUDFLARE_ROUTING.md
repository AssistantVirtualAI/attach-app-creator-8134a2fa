# Routage canonique Lemtel via Cloudflare

Le nom public canonique Lemtel est **`lemtel.assistantvirtualai.com`** dans la zone Cloudflare `assistantvirtualai.com`.

## État réel — writer DO et standby Hostinger

L’état actuellement vérifié est :

1. PostgreSQL **DigitalOcean** est le writer unique et le runtime public DO dessert le nom canonique ;
2. **Hostinger** est un standby PostgreSQL privé en recovery avec WAL streaming, sans listener PostgreSQL public ;
3. Storage DO → Hostinger est une copie périodique attestée ;
4. le nom canonique conserve sa route DNS-only manuelle vers DO ;
5. Cloudflare Load Balancing est souscrit mais aucun Load Balancer, pool, moniteur ni routage de bascule n’est créé.

> Le routage actuel est un chemin manuel à writer unique. Ce n’est pas un mécanisme de failover automatique.

## Garanties conservées

- Le record est DNS-only : aucun Load Balancer Cloudflare ne reçoit actuellement le trafic applicatif.
- PostgreSQL DigitalOcean n’a aucun port hôte ou listener public.
- Aucun FusionPBX, SIP, WSS, TURN, provisionnement d’extension ou téléphonie réelle n’a été changé.
- Hostinger est un **standby privé**. Il ne doit jamais être promu ou démarré comme runtime writer sans fencing validé et autorisation de promotion.
- Aucun failover, changement de route automatique ni failback n’est actif.

## Retour vers Hostinger

Le failback est une opération distincte : il faut d’abord reconstruire/resynchroniser Hostinger comme standby à partir du writer DO, contrôler la réplication PostgreSQL et Storage dans le bon sens, puis approuver une nouvelle fenêtre avec fencing, cutover et validation. Un simple redémarrage Hostinger est interdit, car il pourrait créer deux writers.

La topologie Cloudflare prévue, ses garde-fous et les prérequis avant toute création de ressources sont consignés dans [CLOUDFLARE_LOAD_BALANCING_PREACTIVATION.md](./CLOUDFLARE_LOAD_BALANCING_PREACTIVATION.md).
