# Ce qui peut être poussé du portail vers l'application mobile

Trois niveaux, du plus simple au plus puissant. Les niveaux 1 et 2 existent déjà (page **Application mobile** du portail admin). Le niveau 3 demande une intégration native.

## Niveau 1 — Réglages à distance (déjà en place)

Effet immédiat au prochain rafraîchissement de l'app (au lancement, puis toutes les 5 minutes). Aucun rebuild, aucune soumission aux stores.

| Ce qu'on change | Effet dans l'app |
|---|---|
| Interrupteurs de fonctionnalités | Masquer/afficher un onglet (AVA, Messages, Contacts, Stats) ou une fonction (enregistrements, boîte vocale, Microsoft 365, Maestro, assistance IA) |
| Bannière d'annonce | Bandeau texte en haut de l'écran d'accueil |
| Nouveautés | Message « quoi de neuf » après une mise à jour |
| Mode maintenance | Écran bloquant avec message personnalisé |
| Version minimale requise | Force la mise à jour store si l'app est trop vieille |
| Version recommandée | Invite non bloquante à mettre à jour |
| Réglages numériques | Durée de sonnerie, intervalle de rafraîchissement auto, URL de support |

## Niveau 2 — Mises à jour de contenu web (OTA, déjà en place)

Un paquet ZIP du contenu web (écrans, textes, logique JS/CSS) est téléversé dans le portail, activé d'un clic, et l'app le télécharge au démarrage suivant. Retour arrière en un clic si problème.

Ce qui passe par ce canal :
- Nouveaux écrans et nouvelles pages
- Refonte visuelle, couleurs, mises en page
- Corrections de bugs dans la logique JS
- Nouveaux textes, traductions FR/EN
- Nouveaux appels aux fonctions serveur

## Niveau 3 — À brancher pour que l'OTA s'applique vraiment

Aujourd'hui le paquet est publié et signé côté serveur, mais l'app ne le charge pas encore. Il reste à ajouter côté mobile :

1. Intégrer `@capgo/capacitor-updater` (ou équivalent) dans les deux apps.
2. Au démarrage : appeler `mobile-config`, comparer la version active, télécharger le ZIP signé, vérifier le SHA-256, appliquer au redémarrage suivant.
3. Brancher `useRemoteConfig` sur les écrans : garde d'onglets, bannière, écran de maintenance, écran de mise à jour forcée.
4. Ajouter un script de build qui produit le ZIP au bon format et affiche le numéro de version.

## Ce qui restera toujours une mise à jour store

Tout ce qui touche le code natif :
- Pile SIP / PJSIP, CallKit, ConnectionService
- Notifications push VoIP, permissions (micro, contacts, caméra)
- Icône, nom, écran de démarrage, entitlements
- Ajout ou retrait d'un plugin Capacitor
- Montée de version d'iOS/Android minimum

## Détails techniques

- Tables : `mobile_app_config`, `mobile_app_releases`, `mobile_app_config_audit` (écriture réservée aux admins, journalisée).
- Fonctions : `mobile-config` (lecture par l'app), `mobile-config-admin` (édition), `mobile-release-publish` (téléversement, activation, rollback).
- Stockage : bucket privé `mobile-bundles`, URL signée 1 h.
- Canaux séparés `prod` et `beta` pour tester avant diffusion générale.
