# Lemtel — phase 32C : permissions de bootstrap auto-hébergé

## Problème évité

Un fichier `.env` doit rester privé, mais un `umask 077` appliqué globalement au bootstrap peut aussi rendre les scripts SQL montés par PostgreSQL illisibles par l’utilisateur du conteneur. Dans ce cas, l’initialisation s’arrête avant les migrations suivantes, sans qu’un conteneur DB apparemment sain ne prouve que la plateforme est prête.

Cette phase ajoute un garde-fou **hors ligne** qui distingue explicitement :

- `.env` doit être un fichier régulier en mode `0600` ;
- les sept scripts DB requis doivent être des fichiers réguliers, lisibles par le conteneur (`other-read`) et non inscriptibles par groupe/autres ;
- le résultat reste non autorisant, même lorsque toutes les permissions sont correctes.

## Contrat

```sh
node scripts/lemtel-self-hosted-bootstrap-permissions.mjs --root=<staging-directory>
```

Le script ne lit jamais le contenu de `.env`, n’imprime aucun chemin fourni ni contenu de fichier, ne modifie aucune permission, ne lance pas Docker et ne contacte aucun réseau. Il retourne toujours le code `78` après une revue, avec `authorization: false` et `POLICY_REVIEW_REQUIRED`.

Le contrôle est une prévention de configuration. Il ne constitue pas :

- une autorisation de déploiement, de migration ou de cutover client ;
- une preuve de TLS, Auth, stockage, fonctions ou sauvegarde ;
- une permission d’accéder à Planiprêt, FusionPBX ou DigitalOcean.

> Les répertoires DB/Storage d’un staging ne peuvent être réinitialisés qu’après vérification qu’ils sont vides et dans le cadre d’une autorisation explicite distincte.
