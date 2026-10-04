# Lemtel — phase 31E : preuve réseau avant mise en service

**État au 4 octobre 2026 : non prêt.** Le sous-domaine `lemtel.avastatistic.ca` résout vers l’IPv4 du VPS Hostinger désigné; la réponse DNS AAAA indique **aucun enregistrement**. La sonde HTTPS épinglée sur l’IPv4 du primaire **expire par délai** : elle ne permet donc d’attester ni le certificat ni le service applicatif Lemtel. Un test manuel indépendant du callback DNS sur `example.com` a reçu une réponse HTTPS; ce témoin ne fait pas partie de l’exécution automatique. La Droplet DigitalOcean, déjà réservée au secours, n’a pas été sondée par cette exécution faute d’une IPv4 de secours injectée dans la commande; aucune reprise automatique ni sauvegarde restaurable n’est ainsi démontrée. La politique d’admission de staging v1 est toujours `denied`.

La sonde en lecture seule `scripts/lemtel-hosting-readiness.mjs` exige :

1. un seul A public pointant sur le VPS Hostinger fourni, sans AAAA non vérifié; un échec DNS AAAA différent de `ENODATA` bloque le verdict;
2. une connexion HTTPS avec certificat valide pour **le même nom** sur chacun des deux VPS, Hostinger et DigitalOcean, par SNI et connexion individuelle à leurs IPv4;
3. une réponse JSON `200` à `GET /health/lemtel/ready`, marquée `service: "lemtel-api"`, `status: "ready"`, et `dependencies.auth`, `database`, `storage`, `functions` à `true`;
4. la levée distincte et vérifiable des décisions d’admission. **Le présent script ne peut ni les accorder, ni changer le DNS, ni démarrer de service, ni déclencher une bascule.**

**Important :** l’endpoint de santé Lemtel décrit ici est un **contrat futur**; il n’est pas implémenté par la pile actuelle. Un site parking IONOS, une page HTML `200`, un simple serveur web, une réponse Supabase générique ou un JSON indiquant une dépendance indisponible ne constituent pas une preuve de bon fonctionnement. Les tests CI utilisent seulement des faux résolveurs et des réponses HTTPS simulées; **aucune CI n’interroge les VPS**. Le mode rapport renvoie toujours le code `78` et ne révèle ni IP ni corps de réponse.

Pour un diagnostic ponctuel **une fois les IPv4 vérifiées dans les consoles fournisseur** :

```bash
LEMTEL_PRIMARY_IPV4=<IPv4_Hostinger> \
LEMTEL_STANDBY_IPV4=<IPv4_DigitalOcean> \
  node scripts/lemtel-hosting-readiness.mjs --report
```

Une exécution sans IPv4 de secours a produit : `dns_primary_match=true`, `dns_ipv6_verified=true`, `hostinger_primary=timeout`, `digitalocean_standby=not_checked`, raisons `ADMISSION_DENIED`, `hostinger_primary_timeout`, `digitalocean_standby_public_ip_missing`. Les erreurs de certificat, de délai et de connexion sont rapportées séparément. Ces constats ne sont **pas** un déploiement. Le besoin immédiat reste une pile Lemtel isolée, ses services Auth/DB/Storage/Functions et ses secrets autorisés, un TLS Hostinger effectif, puis une pile de secours répliquée/recettée et un routeur de bascule à contrôle de santé. La validation Kenny/Phil des paramètres PBX et des appels entrants demeure séparée; le modèle « connexion PBX seulement pendant un appel » exige toujours une solution de réveil push pour les appels entrants mobiles.
