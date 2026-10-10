# Routage canonique Lemtel via Cloudflare

Le nom public canonique approuvé pour Lemtel est **`lemtel.assistantvirtualai.com`**. La zone Cloudflare `assistantvirtualai.com` est active et une recherche lecture seule a confirmé qu’aucun enregistrement ne porte actuellement ce nom. Cette décision ne crée pas de DNS et ne déplace aucun trafic.

## Prévol primaire effectué

Hostinger exécute Caddy et publie déjà les ports HTTPS nécessaires. Le proxy est configuré par variables d’environnement et l’URL primaire actuelle n’est pas encore le nom canonique. Ces faits établissent que le routage doit être appliqué par une procédure transactionnelle : sauvegarde de la configuration, ajout du nom à la configuration proxy, validation de Caddy, test HTTPS, puis seulement une configuration durable des URL Lemtel. Aucun de ces changements n’a été fait dans cette phase.

## Séquence contrôlée

1. Préparer un runtime Supabase/Edge chiffré mais inactif sur DigitalOcean. Il ne doit pas ouvrir de listener public ou démarrer Storage avant une promotion approuvée.
2. Préparer Hostinger pour accepter le nom canonique tout en conservant le nom existant durant la migration. Vérifier Caddy et Auth via le nouveau nom.
3. Créer l’enregistrement Cloudflare du nom canonique vers le primaire, avec le type de record déterminé depuis l’origine primaire et sans exposer d’adresse dans les scripts ou le dépôt. Confirmer TLS et Auth.
4. Mettre à jour les builds Lemtel vers le nom canonique uniquement après validation du chemin primaire.
5. Appliquer fencing, promotion manuelle et drill documenté avant de rendre un chemin DigitalOcean routable. Aucun Load Balancer ou basculement DNS automatique ne sera activé avant ces preuves.

## Limites

Cloudflare DNS et un health check ne constituent pas un mécanisme de fencing. Une promotion sans isoler Hostinger pourrait produire deux writers PostgreSQL. Le routage reste donc désactivé sur DigitalOcean jusqu’au test de fencing et au drill approuvés. Aucune configuration FusionPBX, SIP, WSS, TURN ou téléphonie ne fait partie de ce document.
