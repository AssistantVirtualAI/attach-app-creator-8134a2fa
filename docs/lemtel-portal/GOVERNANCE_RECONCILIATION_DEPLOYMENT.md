# Lemtel — réconciliation du portail de gouvernance

> **Statut : réconciliation contrôlée des sources applicatives.** Elle s’emploie uniquement lorsque les migrations de gouvernance ont déjà été attestées dans le catalogue PostgreSQL, mais que la livraison du bundle/Edge a été interrompue avant sa finalisation.

## Ce que le script vérifie

- rôle PostgreSQL writer et conteneurs actifs ;
- cinq objets de gouvernance déjà présents : memberships, session controls, transfert de propriété, bootstrap context et présence client ;
- manifest SHA-256, route Caddy Lemtel unique et montages runtime ;
- sauvegarde privée avant remplacement et rollback des sources Edge/portail en cas d’échec.

## Ce que le script fait

Après la preuve de schéma existante, il réconcilie la fonction d’administration Lemtel, le catalogue téléphonie, le bootstrap de session et le bundle statique du portail. Le redémarrage est limité au conteneur Edge Lemtel existant.

## Ce que le script ne fait pas

Il ne réexécute aucune migration, ne crée ni utilisateur ni domaine, ne lit aucune donnée métier, ne modifie ni Cloudflare/DNS, ni Hostinger, ni promotion/fencing/failover, et ne contacte aucun fournisseur téléphonie.
