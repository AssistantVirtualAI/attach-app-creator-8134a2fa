# Lemtel — phase 31F : santé du Control Plane avant mise en service

**Statut : code préparé sur branche, pas de déploiement.** Cette phase ne change ni IONOS, ni Hostinger, ni DigitalOcean, ni Planiprêt, ni FusionPBX. Elle ne crée aucune migration.

## Correction

Le `Dockerfile` du Control Plane sondait invariablement `127.0.0.1:8080`, même quand `CONTROL_PLANE_PORT` était configuré autrement. Le nouveau healthcheck exécuté **à l’intérieur** de l’image lit la configuration validée, appelle `/health/live` sur le port effectivement configuré et exige `200`, `application/json` et l’identité `lemtel-control-plane`. Il refuse HTML/parking, réponse d’un autre service, 503, panne de connexion, corps trop long et réponse goutte-à-goutte après une échéance totale de deux secondes. Il reste un test de **vie du seul Control Plane** : la disponibilité de la base et de Redis se vérifie séparément à `/health/ready`; la santé de l’ensemble Auth, base, Storage et fonctions Lemtel relève encore du contrat distinct `/health/lemtel/ready` de la phase 31E.

La CI Lemtel exécute désormais, sur les modifications pertinentes, le typage et les tests du Control Plane, construit **localement** l’image Docker puis la démarre avec des valeurs fictives générées à la volée, `--network none`, sans port publié et sur `CONTROL_PLANE_PORT=18080`. Elle exige un état Docker `healthy`, puis vérifie qu’un port non écouté reste refusé; elle détruit le conteneur de test même après un échec. Elle ne publie ni ne déploie l’image. Validation locale de la phase : `npm run check`, `npm test` (**60/60**) et `npm run build` réussissent. Le sandbox n’a pas Docker : le démarrage effectif de l’image doit être confirmé par la CI de PR.

## État du domaine après installation HTTPS annoncée par le propriétaire

Au contrôle externe du **4 octobre 2026 vers 17 h (heure de l’Est)**, `lemtel.avastatistic.ca` résout vers le VPS Hostinger désigné avec un A unique et sans AAAA. Les connexions TCP aux ports 80 et 443 s’ouvrent. Toutefois le serveur n’envoie pas d’en-têtes HTTP sur 80 dans le délai imparti et la négociation TLS sur 443 ne produit pas de réponse HTTPS utilisable depuis le sandbox; le navigateur utilisateur n’a pas non plus chargé le domaine. L’installation indiquée par le propriétaire **n’est pas encore un service externe fonctionnel démontré**. L’invite Hostinger s’ouvre dans un onglet non accessible à l’outil; un diagnostic `ss`, `systemctl is-active` et `docker ps` depuis le VPS a été demandé **sans secrets**. Ne pas attribuer cet échec à une cause (certificat, proxy, pare-feu ou application) sans l’inventaire système.

La politique `schemas/lemtel-staging-admission/staging-admission-policy.json` reste `denied`/`offline_only`; la sonde HTTPS, le correctif Docker et la CI ne la changent pas. Ni le Control Plane ni la pile complète ne sont déclarés hébergés; le secours DigitalOcean n’a pas été testé ici.
