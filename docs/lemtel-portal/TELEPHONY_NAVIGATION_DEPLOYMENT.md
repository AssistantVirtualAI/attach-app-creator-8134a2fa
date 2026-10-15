# Lemtel — déploiement de navigation téléphonie

> **Statut : package de portail statique uniquement.** Cette livraison rend navigables les domaines du catalogue téléphonie Lemtel déjà contrôlé par le serveur. Elle ne provisionne pas de PBX ni un fournisseur.

## Portée

`lemtel-ha-do-writer-portal-navigation-deploy.sh` vérifie un manifeste SHA-256, le rôle writer PostgreSQL et la route de portail existante. Il remplace transactionnellement le seul bundle statique sous `/lemtel-portal/` et conserve une sauvegarde privée du bundle précédent sur le writer.

## Préconditions

- attestation de sauvegarde chiffrée fraîche du writer ;
- package vérifié incluant `portal.tar`, `deployment-metadata.json`, `manifest.sha256` et ce script ;
- conteneurs writer et Caddy fonctionnels ;
- route Caddy Lemtel déjà présente et non ambiguë.

## Interdictions vérifiées

Le script ne modifie ni données/schéma PostgreSQL, ni Edge Functions, ni Cloudflare/DNS, ni Hostinger, ni promotion/fencing/failover. Il ne contacte aucun PBX/SIP/WSS/TURN ni fournisseur de téléphonie.

## Vérification après livraison

1. Ouvrir `/lemtel-portal/telephony` puis les huit sections de navigation.
2. Changer d’organisation : le catalogue est chargé uniquement par l’API Lemtel autoritaire pour cette organisation.
3. Vérifier que tous les modules affichent **Non provisionné** avec leurs prérequis d’activation.
4. Ne tester aucune écriture métier, aucun appel, média, chat, SMS ou enregistrement : ces sources ne sont pas encore provisionnées.
