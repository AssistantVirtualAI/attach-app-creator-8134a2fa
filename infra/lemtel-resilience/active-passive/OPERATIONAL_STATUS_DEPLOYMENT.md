# Lemtel — déploiement du statut opérationnel administrateur

> **Statut : préparé, non déployé.** Ce document ne redémarre aucun service et ne constitue pas une autorisation d’écriture sur le writer.

## But

La page **Exploitation** du portail Lemtel permet aux administrateurs de plateforme de consulter un instantané sûr de l’état du writer, du secours, des services applicatifs et des liens de distribution.

Elle ne peut jamais :

- accéder directement à un serveur depuis le navigateur ;
- afficher une adresse, un hostname, une clé, un mot de passe, une donnée utilisateur, une donnée d’appel ou un enregistrement ;
- démarrer Hostinger, promouvoir une base, modifier Cloudflare ou déclencher une bascule ;
- activer FusionPBX, SIP, WSS, TURN ou une fonction téléphonique.

## État attendu au moment d’un déploiement

- DigitalOcean reste le writer PostgreSQL et runtime public uniques ;
- Hostinger reste fencée et nécessite une reconstruction en standby avant toute réplication inverse ;
- le routage canonique reste sur le writer DigitalOcean ;
- la bascule automatique reste désactivée ;
- les alertes existantes restent le canal d’incident principal.

## Autorisation requise

Avant toute commande mutante, obtenir une approbation qui couvre exactement :

1. l’application de la migration `0006_lemtel_operational_status.sql` sur le writer DigitalOcean privé ;
2. le déploiement de la version correspondante de `lemtel-onboarding-admin` et du portail ;
3. l’activation du seul minuteur de publication redacted sur DigitalOcean.

Cette approbation ne couvre **pas** Hostinger, DNS/Cloudflare, PostgreSQL public, promotion, failback ou téléphonie.

## Séquence d’application contrôlée

1. Geler les autres déploiements et vérifier, en lecture seule, que DO reste le writer unique et que Hostinger est fencée.
2. Vérifier une sauvegarde chiffrée récente du writer et l’état sain du runtime existant.
3. Produire l’artefact statique avec le workflow manuel `.github/workflows/lemtel-operations-portal-build.yml`. Il injecte les variables canoniques seulement dans GitHub Actions, construit exclusivement l’entrée Lemtel à la base `/lemtel-portal/`, exclut les fichiers publics Planiprêt et ne déploie rien lui-même.
4. Appliquer la migration Lemtel `0006` sur la base privée du writer. Elle crée une unique ligne d’état avec RLS et retire tout accès navigateur direct.
5. Déployer ensemble la fonction Edge `lemtel-onboarding-admin` et l’artefact privé du portail contenant la page **Exploitation**, à partir du manifeste spécifique `operational-status-deployment-manifest.json`. Le manifeste historique `edge-functions/deployment-manifest.json` reste réservé au package mobile-config et ne doit pas être détourné.
6. Utiliser exclusivement `lemtel-ha-promoted-writer-operations-portal-deploy.sh` : il revalide le writer, l’attestation de sauvegarde et les empreintes du package, applique la migration idempotente, sauvegarde Caddy et la fonction existante, puis annule automatiquement les fichiers/runtimes si une étape postérieure échoue.
7. Configurer uniquement une route statique authentifiée `/lemtel-portal/` dans le Caddy déjà actif, avec fallback SPA limité à ce préfixe. Ne pas modifier la route API existante, DNS ou Cloudflare.
8. Installer le publieur `lemtel-ha-promoted-writer-status-publish.sh` et activer son minuteur uniquement sur DO avec le rôle `digitalocean_promoted_writer`.
9. Vérifier qu’un administrateur de plateforme authentifié obtient un instantané redacted avec horodatage récent ; vérifier qu’un administrateur d’organisation non plateforme reçoit un refus contrôlé.
10. Vérifier que la page affiche les liens de distribution configurés, sans créer de paiement, abonnement ou checkout.
11. Consigner l’horodatage de la première observation et laisser les alertes existantes surveiller l’état.

## Plan d’annulation

En cas d’échec du statut :

1. arrêter et désactiver seulement le minuteur de publication DO ;
2. conserver DO comme writer et Hostinger fencée ;
3. conserver le DNS inchangé ;
4. ramener le portail à l’état « télémétrie en attente » ou revenir à l’artefact précédent après validation ;
5. ne pas utiliser un échec de télémétrie comme justification de bascule automatique.

> L’état opérationnel est un **outil de lecture**. Il n’est pas un mécanisme de reprise ni une autorisation de failback. Tant qu’une sonde redacted séparée n’a pas vérifié le secours ou le routage, la page affiche **Inconnu** plutôt qu’un état déduit.
