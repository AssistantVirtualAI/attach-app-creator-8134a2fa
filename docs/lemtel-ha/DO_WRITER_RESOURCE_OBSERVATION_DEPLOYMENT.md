# Lemtel — déploiement des observations de ressources du writer DO

Ce runbook concerne exclusivement le writer DigitalOcean. Il prépare la réception serveur de six valeurs redacted et bornées : CPU, mémoire, disque et charges 1/5/15. Il n’installe ni ne configure le publisher et ne rend aucune valeur disponible tant qu’une publication serveur valide n’existe pas.

## Préconditions bloquantes

- Une release créée depuis une révision Git détachée, dont l’archive, le `manifest.sha256` et le fichier `.sha256` sont vérifiés hors ligne.
- Une attestation de snapshot chiffré frais du writer, explicitement fournie lors de l’exécution.
- L’hôte est réellement le writer PostgreSQL (`pg_is_in_recovery() = false`) et les conteneurs PostgreSQL et Edge préexistants sont sains.
- L’archive contient exactement cinq fichiers réguliers : migration `0022`, manifeste de ressources, ingress DO, projection admin et métadonnées.

## Garanties transactionnelles

Le déployeur root-only refuse les archives ambiguës, les liens symboliques, un digest inadéquat, un rôle différent du writer, un schéma partiel ou un runtime Edge absent. Il applique seulement la migration additive `0022`, sauvegarde les sources Edge existantes avec permissions root-only puis les remplace atomiquement. Un échec après remplacement restaure les sources et redémarre uniquement le runtime Edge préexistant. La migration additive n’est jamais annulée automatiquement.

## Exclusions explicites

Cette étape ne crée aucun secret, ne lit aucun contenu métier, ne configure ni publisher ni timer, ne contacte aucun fournisseur, et ne démarre aucun runtime standby. Elle ne touche pas Caddy, Hostinger, Cloudflare, DNS, routage, promotion, fencing, téléphonie ou bascule automatique.

Après un déploiement attesté, l’interface affiche toujours `Aucune observation` jusqu’à l’installation séparée et revue du publisher DO. Hostinger demeure `Enrôlement sécurisé requis` jusqu’à son propre enrollment, publication attestée et contrôles indépendants.
