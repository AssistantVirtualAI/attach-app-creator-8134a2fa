# Lemtel — contrôle-plane téléphonie

## Objectif

Préparer les capacités d’administration téléphonie Lemtel, organisation par organisation, sans connexion à Avastatistic/Planiprêt et sans activation d’un fournisseur téléphonie.

## Autorité et isolation

- Le portail, l’API Edge et la base Lemtel du writer DigitalOcean sont les seules sources d’autorité.
- Chaque lecture est autorisée par un rôle administrateur de l’organisation Lemtel sélectionnée ou un administrateur de plateforme.
- Aucun nom de domaine SIP, secret, extension, IP, enregistrement, message, appel ou identité de client n’est retourné par le catalogue de préparation.
- Le navigateur ne peut pas déclarer une capacité téléphonie disponible ; seul un contrat serveur déployé et contrôlé peut la faire évoluer.

## État initial sûr

Toutes les capacités retournent `not_provisioned`. Cet état signifie que le portail sait **où** l’option sera gérée, mais qu’il n’existe ni PBX, ni enregistrement SIP, ni routage d’appel, ni accès média, ni message, ni écriture fournisseur.

| Domaine | Capacités préparées |
|---|---|
| Système téléphonique | Extensions, utilisateurs, appareils, routes entrantes, horaires, IVR, groupes, passerelles, profils SIP, dialplans, codes fonctionnels, renvois, agents vocaux, conversations agents, clients, paramètres PBX |
| Centre d’appels | Files, agents, conférences, musique d’attente, règles d’enregistrement, messagerie vocale, wallboard, console agent, administration, QA |
| Analytique / médias | Centre média, historique d’appels, enregistrements, insights IA, rapports |
| Communications | SMS, messagerie vocale, chat d’équipe |
| Supervision | Appels actifs, enregistrements/registrations, statut système, santé de synchronisation, audit IA |
| Administration | Utilisateurs et accès, téléchargements, PBX avancé, santé de synchronisation, paramètres |

## Porte d’activation obligatoire

Aucune capacité ne peut évoluer vers une configuration active sans, dans une PR Lemtel distincte et révisable :

1. informations fournisseur approuvées par Kenny/Phil ;
2. modèle de données et RLS Lemtel par organisation ;
3. secrets uniquement côté serveur et jamais dans Desktop/Mobile/portail ;
4. prévol authentifié non destructif ;
5. tests d’intégration réels et audit redacted ;
6. procédure de rollback approuvée.

Cette préparation ne modifie ni FusionPBX, ni SIP/WSS/TURN, ni PushKit/CallKit/FCM, ni DNS/Cloudflare/Hostinger.
