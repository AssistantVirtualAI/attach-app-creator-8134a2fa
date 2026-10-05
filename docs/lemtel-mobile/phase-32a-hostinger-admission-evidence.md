# Lemtel — phase 32A : preuve d’admission Hostinger, hors ligne

**État : préparation de décision; aucun déploiement, aucun runtime, aucun changement VPS/DNS/PBX ou migration.** La cible reste une pile Lemtel autonome sur Hostinger et un secours DigitalOcean ultérieur. La politique v1 actuellement suivie reste `denied` / `offline_only` : ni ce document ni le validateur ne créent une permission opérationnelle.

## Pourquoi cette phase existe

Le primaire Hostinger a été inspecté par le propriétaire dans sa Console Web : Docker Compose est disponible, l’espace disque est disponible et UFW n’autorise que SSH. La même inspection a montré qu’aucun processus n’écoute 80/443 et qu’aucun conteneur n’est en cours ou arrêté. Il faut donc une installation future de la pile Lemtel et de son ingress HTTPS, pas le redémarrage hypothétique d’un certificat existant.

Ces faits, une désignation de responsable de surveillance/secrets et une durée de rétention de journaux ne doivent jamais être utilisés pour déduire qu’un déploiement est permis. Ils sont des éléments à vérifier, pas une commande d’installation.

## Validateur d’évidence

`scripts/lemtel-hosting-admission-evidence.mjs` accepte uniquement un document JSON non secret **local** sous `schemas/lemtel-staging-admission/evidence/`. Le répertoire contient un `.gitignore` qui exclut les fichiers JSON : ne pas commiter les observations opérationnelles, noms de personnes, adresses, journaux, mots de passe ou clés. Chaque prérequis est un état fermé : `not_provided`, `verified` ou `rejected`.

```sh
node scripts/lemtel-hosting-admission-evidence.mjs \
  --file=schemas/lemtel-staging-admission/evidence/<non-secret>.json
```

Le script ne lit que le chemin contraint, ne révèle ni identifiant de demande ni valeur entrée, et retourne toujours le code **78**. Même si toutes les preuves indiquent `verified`, sa sortie est `evidence_complete_not_authorization` avec `authorization: false` et `POLICY_REVIEW_REQUIRED`.

> Une preuve complète est une entrée de revue. Elle n’autorise ni Docker, ni UFW, ni TLS, ni DNS, ni données persistantes, ni accès PBX, ni mise à jour des applications.

## Éléments qui restent nécessaires

Avant tout premier staging Lemtel isolé :

1. Créer un snapshot Hostinger frais immédiatement avant une fenêtre approuvée, puis en conserver la preuve hors Git.
2. Préparer une politique d’admission nouvelle et revue, qui décrit explicitement ses capacités, son rollback, les responsables de monitoring/secrets et la rétention approuvée; **ne pas modifier le JSON v1 pour le faire paraître admis**.
3. Valider un périmètre vide/isolé sans données Planiprêt, les secrets privés, le TLS DNS et l’absence de modification FusionPBX.
4. Installer seulement après une décision opérationnelle distincte une pile versionnée avec reverse proxy et tests Auth/DB/Storage/Functions/Realtime; le Compose de développement du Control Plane ne doit pas être promu en production.
5. Concevoir le secours DigitalOcean, la réplication et les tests de failover après preuve de fonctionnement du primaire, et non via un retournement manuel du DNS.

Les tests du validateur garantissent que les documents invalides, les chemins hors répertoire d’évidence et une preuve complète restent tous non autorisants.
