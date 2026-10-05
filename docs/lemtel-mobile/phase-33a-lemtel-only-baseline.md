# Lemtel — phase 33A : baseline de migration Lemtel-only

## Objectif

Le staging auto-hébergé peut être sain tout en étant volontairement vide. Avant de créer une table, un compte, un bucket ou une fonction métier, Lemtel doit disposer d’une baseline qui sépare ce qui doit être **conçu à neuf** de ce qui pourrait provenir d’un produit partagé.

Cette phase agrège exclusivement deux audits statiques existants : inventaire des fonctions/migrations candidates et fermeture d’imports fonctionnels. Elle ne lit aucune donnée d’origine, ne se connecte à aucun projet, ne rejoue aucun SQL et ne déploie rien.

## Matrice de revue

```sh
node scripts/lemtel-self-hosted-baseline.mjs
```

Le rapport fait ressortir, sans corps de code ni valeur sensible :

- chaque fonction candidate, son nombre de références client, les marqueurs étrangers/cross-product, les imports relatifs non résolus et un résultat de revue bloquant ou manuel ;
- chaque migration candidate, son nombre de déclarations Lemtel/PBX et son résultat de revue ;
- les huit domaines à concevoir séparément : Auth, base/RLS, Storage, fonctions, Realtime, Push, TURN et sauvegarde/restauration.

Un marqueur Planiprêt/cross-product, un import non résolu ou une dépendance SQL inconnue reste un **blocage**, pas une permission de copier ou déployer quoi que ce soit.

## Interdictions maintenues

Le rapport retourne toujours le code `78` et `authorization: false`. Il interdit explicitement :

- export/import de données, comptes Auth, objets Storage ou secrets ;
- écriture de schéma, replay de migrations ou déploiement de fonctions ;
- utilisation des clés du nouveau projet dans les builds Desktop/iOS/Android ;
- cutover utilisateur, changement FusionPBX, travail DigitalOcean ou bascule DNS.

## Décision qui viendra ensuite

Une approbation distincte devra définir un paquet de migration Lemtel vide ou des données Lemtel explicitement sélectionnées, accompagné des politiques RLS, tests de restauration, plan de rollback et recette PBX. Aucune donnée Planiprêt ne fait partie de cette baseline.
