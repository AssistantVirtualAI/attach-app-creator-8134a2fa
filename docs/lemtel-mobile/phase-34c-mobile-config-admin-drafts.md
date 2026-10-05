# Lemtel — phase 34C : contrat administrateur de brouillons mobiles

## Objet

Le schéma Lemtel-only est désormais présent sur le staging vide, mais **aucune fonction Edge Lemtel n’est encore déployée**. Cette phase ajoute au dépôt un paquet source isolé pour la future administration de brouillons de configuration mobile.

Le code vit sous `infra/lemtel-self-hosted/functions/`, et non dans `supabase/functions/` : il ne peut donc pas être confondu avec une fonction historique ou mutualisée.

## Capacités prévues — source seulement

Une fois les prérequis approuvés et le paquet déployé séparément, la fonction ne permettra qu’à un membre Lemtel actif ayant le rôle `owner` ou `admin` de :

- créer un brouillon de configuration `staging` ou `production`;
- modifier un brouillon existant, toujours lié à la même organisation et au même canal;
- lister au plus 50 brouillons de sa propre organisation.

Les entrées sont strictes : UUID, canal fermé, révision positive, corps exact sans attribut additionnel, versions bornées et objets JSON limités. Les clés sensibles ou liées à l’infrastructure sont refusées dans les objets de configuration. Les erreurs ne renvoient jamais la requête brute.

## Frontières de sécurité

- l’identité Auth vient exclusivement du jeton `Bearer` contrôlé côté serveur;
- l’appartenance est cherchée côté serveur dans `lemtel_organization_memberships`, avec organisation, utilisateur, statut `active` et rôle `owner`/`admin`;
- les écritures ne sont pas directes : la fonction attend la future RPC `lemtel_mobile_config_draft_write`, qui devra créer ou modifier le brouillon **et** son audit minimal dans la même transaction, ou ne rien écrire;
- cette RPC future ne recevra que l’opération, l’acteur, l’organisation, le canal, la révision et les champs validés; son audit ne devra jamais conserver les objets `flags`, `messages` ou `settings`;
- les réponses sont `no-store`; aucun CORS permissif n’est ajouté avant la conception du portail Lemtel.

## Explicitement exclu

Cette phase n’implémente ni publication/retrait atomique, ni manifeste client, ni Storage, ni upload, ni registre de releases, ni Auth utilisateur, ni push, ni PBX/TURN/SIP, ni appel externe. Elle ne déploie aucune fonction et n’ajoute aucune clé ou variable privée aux applications. Elle ne peut pas écrire de brouillon avant qu’un paquet SQL séparé et approuvé crée la RPC atomique.

La publication/retrait demande une opération transactionnelle serveur distincte afin de respecter les contraintes d’unicité de configuration publiée. Le manifeste client reste exclu jusqu’à la conception d’un remplacement autonome de `mobile-config`.

## Vérification hors ligne

```sh
node --test scripts/lemtel-self-hosted-mobile-config-admin.test.mjs
```

Le test vérifie notamment la politique `deployment_authorized: false`, les actions fermées, les limites de contenu, la frontière organisationnelle, l’absence de dépendance Planiprêt/PBX/Storage et les écritures restreintes aux brouillons.
