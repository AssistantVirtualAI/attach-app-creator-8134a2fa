# Lemtel — préparation du fencing fournisseur

> **État actuel :** lecture DigitalOcean attestée ; accès lecture Hostinger à réparer. Aucune action fournisseur, promotion, DNS, routage ou téléphonie n’est déclenchée par ce document.

## Décision fail-closed

L’arbitre indépendant refuse toute promotion si l’un des éléments suivants manque : une lecture fournisseur cohérente, un reçu de fencing, la confirmation d’état terminal de l’ancien writer, le prévol local du standby, ou la santé applicative après promotion.

Une perte de réseau ne suffit jamais à promouvoir Hostinger. Cloudflare mesure la santé HTTP mais ne décide pas seul de la promotion PostgreSQL.

## Ordre de fencing contractuel

1. Ouvrir un incident unique et lire l’état du writer attendu.
2. DigitalOcean : demander `shutdown`, attendre le résultat, puis utiliser `power_off` seulement si l’arrêt gracieux ne confirme pas l’état terminal.
3. Hostinger : utiliser son action d’arrêt seulement lorsque l’accès VPS est de nouveau validé.
4. Relire l’état terminal non actif, créer un reçu redacted à usage unique, puis seulement autoriser le garde local de promotion.

## Préconditions restantes

- Réparer l’autorisation API VPS Hostinger : le dernier inventaire lecture seule a retourné un refus d’accès.
- Déployer l’arbitre hors des deux VPS en observation/refus par défaut.
- Prouver la durabilité Storage double-écriture, la parité runtime et les drills de fencing/promotion/failback.
- Créer et tester le monitoring Cloudflare avant tout routage.

## Références

- https://docs.digitalocean.com/reference/api/reference/droplet-actions/
- https://docs.hostinger.com/api-reference/overview
- https://developers.cloudflare.com/load-balancing/load-balancers/common-configurations/
