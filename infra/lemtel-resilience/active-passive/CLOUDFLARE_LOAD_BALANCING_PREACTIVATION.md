# Lemtel — préactivation Cloudflare Load Balancing

> **État : abonnement actif, aucun Load Balancer créé, aucun routage modifié.**
>
> Ce document prépare une configuration sûre. Il ne crée ni pool, ni sonde, ni origine, ni changement DNS/Cloudflare.

## Rôle exact du Load Balancer

Cloudflare Load Balancing distribuera les **nouvelles requêtes HTTPS** vers un writer réellement prêt :

1. **pool prioritaire : DigitalOcean**, uniquement pendant que DO est le writer PostgreSQL et que son runtime est prêt ;
2. **pool de secours : Hostinger**, uniquement après fencing confirmé de DO, promotion PostgreSQL vérifiée, démarrage contrôlé du runtime Hostinger et état *writer ready* validé.

> Cloudflare ne promeut jamais PostgreSQL et ne démarre jamais Hostinger. Une panne de sonde seule ne justifie pas une promotion.

Un appel VoIP en cours ne peut pas être garanti pendant une bascule. Ce mécanisme vise les nouvelles requêtes après une promotion sûre.

## Configuration cible — à créer seulement après les garde-fous

| Élément | Valeur prévue | Garde-fou |
| --- | --- | --- |
| Nom canonique | `lemtel.assistantvirtualai.com` | reste inchangé ; remplacement de la route DNS-only uniquement dans la fenêtre approuvée |
| Stratégie | active–passive par priorité | aucune répartition aléatoire ni active-active |
| Pool primaire | DO writer actuel | ne retourne `200` que si DO est le writer unique et son runtime est sain |
| Pool secours | Hostinger après promotion | reste indisponible tant que Hostinger est un standby privé |
| Sonde HTTPS | endpoint redacted *writer ready* | ne révèle ni adresse, ni état DB détaillé, ni secret, ni données client |
| Bascule de trafic | priorité Cloudflare | seulement quand le pool de secours est devenu réellement prêt après le garde de promotion |

La sonde ne doit pas utiliser un simple endpoint HTTP générique. L’endpoint *writer ready* devra répondre `200` uniquement lorsqu’il confirme :

- un seul writer PostgreSQL ;
- runtime applicatif prêt ;
- digest immuable de l’artefact vérifié ;
- fraîcheur Storage vérifiée ;
- sur Hostinger, autorisation de promotion à usage unique et fencing de DO déjà attesté.

Sinon il répond un statut non prêt, sans information d’infrastructure.

## Pourquoi aucune ressource Cloudflare n’est créée maintenant

Les conditions suivantes ne sont pas encore démontrées :

1. arbitre indépendant opérationnel ;
2. fencing fournisseur exercé avec reçu terminal ;
3. réplication PostgreSQL synchrone validée ;
4. durabilité Storage double-écriture validée ;
5. garde de promotion et runtime Hostinger validés ;
6. fenêtre finale de routage autorisée.

Créer un pool Hostinger routable avant ces preuves ferait courir le risque de diriger du trafic vers un standby non promu ou de créer une situation à deux writers. Le Load Balancer ne remplace pas ces contrôles.

## Séquence de création future

Après tous les prérequis et une autorisation de fenêtre de routage :

1. créer la sonde *writer ready* ;
2. créer le pool DO avec cette sonde ;
3. créer le pool Hostinger, sans le rendre sain avant promotion vérifiée ;
4. créer le Load Balancer avec priorité DO puis Hostinger ;
5. remplacer la route DNS-only canonique par le Load Balancer ;
6. exécuter un drill complet : fencing, promotion, runtime, santé publique, reprise de trafic puis reconstruction inverse.

Toute étape échouée annule l’activation et conserve un seul writer. Aucun retour automatique vers DO n’est autorisé.

## Hors périmètre

- aucune adresse ou identifiant fournisseur ;
- aucun secret ;
- aucun port PostgreSQL public ;
- aucune téléphonie SIP/WSS/TURN ni appel réel ;
- aucune donnée ou modification Planipret.

## Références

- [Cloudflare — active-passive failover](https://developers.cloudflare.com/load-balancing/load-balancers/common-configurations/)
- [Cloudflare — monitors](https://developers.cloudflare.com/load-balancing/monitors/)
- [Cible Lemtel de failover synchrone](./SYNCHRONOUS_AUTOMATIC_FAILOVER_TARGET.md)
- [Préparation du fencing fournisseur](./PROVIDER_FENCING_READINESS.md)
