# Lemtel — phase 35B : transitions administratives de configuration mobile

## Objet

Les paquets SQL 34D et 35A décrivent respectivement les transactions de brouillon et de publication/retrait. Cette phase relie le contrat source `lemtel-mobile-config-admin` à ces deux RPC, dans le dépôt seulement. Aucun code Edge n’est copié vers le VPS et le manifest de fonction interdit toujours déploiement, import et cutover.

## Actions futures fermées

Le contrat ne reconnaît que `create_draft`, `update_draft`, `list_drafts`, `publish` et `retire`. Tous les appels exigent un JWT valide et un membre Lemtel actif `owner` ou `admin` de l’organisation ciblée. Les corps restent exacts; publication et retrait n’acceptent que l’organisation, le canal et l’identifiant de configuration.

Les actions de brouillon appellent uniquement `lemtel_mobile_config_draft_write`. Publication et retrait appellent uniquement `lemtel_mobile_config_publish`. Il n’existe aucun `insert`, `update`, `upsert` ou `delete` direct depuis la fonction Edge : les RPC devront être appliquées et testées avant tout déploiement de cette source.

## Ce qui reste exclu

Il n’y a pas de manifeste client public, de Storage ou upload, de release, de compte Auth, de PBX/TURN/SIP, de push, de DNS, de DigitalOcean, ni de modification de client. Aucun brouillon ou changement d’état ne peut être exécuté tant que les RPC restent non appliquées.

## Contrôle

```sh
node --test scripts/lemtel-self-hosted-mobile-config-admin.test.mjs
```

Les régressions vérifient les actions fermées, la frontière Auth/organisation, les limites de contenu, les deux RPC nommées et l’absence de mutation directe. Elles ne déploient rien.
