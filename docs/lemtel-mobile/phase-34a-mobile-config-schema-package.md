# Lemtel — phase 34A : paquet de schéma mobile Lemtel-only

## Périmètre

Ce paquet prépare, **dans le dépôt seulement**, le premier schéma vide détenu par Lemtel pour les deux capacités mobiles réimplémentables suivantes : configuration administrée et registre de releases. Il est isolé de `supabase/migrations`, qui reste historique et mutualisé.

Le paquet ne crée ni compte, ni organisation, ni bucket, ni objet Storage, ni fonction serveur. Il ne contient aucun `INSERT`, import de données, clé, endpoint ou secret.

Le fichier SQL est encapsulé dans `BEGIN` / `COMMIT` : lors d’une future application approuvée, une erreur doit annuler le paquet entier plutôt que laisser un schéma partiellement créé.

## Structures préparées

- organisations et appartenances Lemtel, référencées vers de **nouveaux** comptes Auth du projet auto-hébergé ;
- révisions de configuration avec états brouillon/publiée/retirée ;
- métadonnées de releases mobiles avec intégrité SHA-256, activation et retrait ;
- journal administratif minimal ;
- RLS activée et lecture limitée aux utilisateurs membres, aux configurations publiées et aux releases actives.

Les écritures administratives restent réservées aux futurs contrats serveur Lemtel : cette phase ne les implémente pas.

## Contrôle

```sh
node scripts/lemtel-self-hosted-schema-package.mjs
```

Le validateur exige un manifeste `offline_schema_package` avec toutes les autorisations à `false`. Il interdit notamment les données partagées, les opérations DML, les buckets, les rôles privilégiés, les extensions et toute capacité d’application. Il retourne toujours le code `78` et `authorization: false`.

## Étape suivante contrôlée

Avant toute application au staging, il faudra une **nouvelle autorisation explicite** couvrant uniquement :

1. l’écriture de ce schéma vide sur le projet auto-hébergé ;
2. la création ultérieure de comptes Lemtel de test neufs ;
3. la recette RLS avec données synthétiques ;
4. la conception séparée du bucket, des politiques Storage et des fonctions serveur.

Cette autorisation n’inclura jamais l’import de comptes, données, objets ou configurations d’un produit partagé, ni la connexion des clients, ni le PBX, ni DigitalOcean.
