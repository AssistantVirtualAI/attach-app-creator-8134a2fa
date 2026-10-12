# Lemtel — contrôleur sortant d’artefacts du writer DigitalOcean

> **Statut : conception prête, non installée.** Le workflow GitHub ne contacte pas le writer DO par SSH tant que DO est le writer public.

## Pourquoi

Le receiver SSH DO est fermé aux connexions entrantes des runners GitHub. C’est une frontière de sécurité attendue : ouvrir le port SSH à des plages larges de runners serait moins sûr que de conserver le writer sans accès entrant GitHub.

Le dépôt GitHub continue de construire un artefact immuable checksumé et de le déposer sur le standby Hostinger. Lorsque DO est le writer, le statut d’artefact DO reste **non attesté** jusqu’à l’installation du contrôleur sortant ci-dessous.

## Cible

Un minuteur local **sur DO**, exécuté avec une identité GitHub en lecture seule, doit :

1. récupérer uniquement la branche `lemtel/integration` via une connexion sortante HTTPS ou SSH connue ;
2. vérifier le commit et construire ou télécharger l’artefact Lemtel immuable correspondant ;
3. écrire le SHA-256, le commit court et l’horodatage dans une attestation locale protégée ;
4. ne jamais démarrer de conteneur, appliquer de runtime, modifier Caddy, DNS, firewall, PostgreSQL, Storage, Hostinger ou la téléphonie.

## Prérequis d’installation

- accès root contrôlé au writer DO ;
- identité GitHub **lecture seule** limitée au dépôt Lemtel, sans permission d’écriture ;
- répertoire local dédié, propriétaire root, hors des volumes runtime ;
- vérification initiale manuelle de la première attestation ;
- procédure de rollback : désactiver seulement le minuteur local et supprimer l’identité de lecture seule.

## Ce que cela ne fait pas

Le contrôleur sortant fournit une **parité d’artefact attestée**, pas un déploiement automatique du runtime. Les mises à jour du runtime public restent soumises à leur package vérifié, à une sauvegarde fraîche et au déploiement transactionnel du writer. Cette séparation empêche qu’un commit ou un artefact seul modifie des services en production.

## Sécurité

- aucune adresse, clé, jeton ou empreinte n’est écrite dans ce document ;
- aucun accès SSH entrant GitHub n’est ajouté au writer ;
- un échec de récupération laisse le runtime existant intact et publie seulement un état d’attention ;
- ce mécanisme ne modifie pas le statut du failover automatique, qui reste désactivé.
