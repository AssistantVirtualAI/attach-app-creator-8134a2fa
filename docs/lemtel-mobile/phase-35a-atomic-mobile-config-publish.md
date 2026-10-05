# Lemtel — phase 35A : publication atomique de configuration mobile

## Objet

La phase 34D prépare les brouillons. Cette phase prépare séparément le changement d’état qui publiera ou retirera une révision, toujours **dans le dépôt uniquement**. Aucun changement n’est effectué sur Hostinger.

## Contrat de transition

La RPC `lemtel_mobile_config_publish` accepte seulement `publish` et `retire`. Avant toute transition, elle verrouille la ligne d’organisation, puis vérifie que l’acteur est un membre actif `owner` ou `admin` de cette organisation.

Une publication verrouille le brouillon demandé, retire l’éventuelle révision déjà publiée du même canal, publie le brouillon avec le même instant de transition et ajoute l’audit `config_published`. Un retrait vise seulement la révision actuellement publiée et ajoute `config_retired`. Le tout est exécuté dans une transaction; tout conflit ou échec annule la transition et l’audit associé.

`PUBLIC`, `anon` et `authenticated` ne peuvent pas exécuter cette RPC. Seul le rôle de service pourra l’appeler plus tard, après que la fonction Edge Lemtel aura vérifié le JWT et l’appartenance de l’utilisateur.

## Limites et prérequis

Le manifeste reste entièrement non autorisant : application SQL, déploiement Edge, import et cutover client sont à `false`. Il n’y a ni compte Auth, ni organisation, ni configuration client, ni Storage, ni release, ni PBX, ni push, ni DNS ou DigitalOcean dans ce paquet.

L’application future exigera une autorisation d’écriture distincte, de nouveaux comptes Lemtel de test, une organisation/appartenance de test, une recette synthétique RBAC, concurrence et rollback, puis une autorisation distincte de déploiement Edge.

## Vérification hors ligne

```sh
node --test scripts/lemtel-self-hosted-atomic-config-publish-rpc.test.mjs
```

Le validateur ne fait aucune connexion et renvoie toujours le code `78` avec `authorization: false`.
