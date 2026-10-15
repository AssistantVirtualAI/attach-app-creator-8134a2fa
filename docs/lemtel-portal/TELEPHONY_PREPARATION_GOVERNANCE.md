# Gouvernance déclarative de préparation téléphonie Lemtel

## Objectif

Le control-plane téléphonie contient maintenant un **marqueur de préparation par organisation et par capacité du catalogue**. Il permet à un administrateur de déclarer qu’un domaine fonctionnel peut être soumis à revue, puis de le réinitialiser. C’est une étape de gouvernance Lemtel, pas une activation de téléphonie.

## Données stockées

La table `lemtel_telephony_preparation_states` contient uniquement :

- l’organisation Lemtel ;
- une clé interne du catalogue Lemtel ;
- l’état unique `review_ready` ;
- une révision et un horodatage ;
- l’identifiant de l’acteur autorisé.

L’absence de ligne signifie `not_started`. Les transitions sont atomiques via une fonction SQL réservée au `service_role`; le navigateur n’a aucun droit direct sur la table ou la fonction.

## Autorité et audit

- La lecture et l’écriture passent uniquement par `lemtel-onboarding-admin`.
- Un administrateur de l’organisation active est requis à chaque appel.
- La clé de capacité est contrôlée contre le catalogue serveur Lemtel.
- Chaque transition ajoute un événement d’audit Lemtel redacted.
- Le contexte d’organisation est repris du serveur ; aucun état de tenant venant du client n’est accepté sans contrôle d’adhésion.

## Frontières strictes

Cette gouvernance ne stocke ni ne transmet :

- fournisseur, host, URL, adresse, numéro ou destination ;
- mot de passe, clé, jeton, secret, configuration SIP/WSS/TURN ou média ;
- appel, SMS, message, transcription, enregistrement ou donnée client ;
- commande de PBX, de réseau, de runtime, de Cloudflare, de promotion ou de fencing.

> `review_ready` signifie seulement « prêt à être revu ». Il ne signifie pas que la capacité est provisionnée, connectée, fonctionnelle ou autorisée à produire du trafic.

## Porte d’activation distincte

Une capacité ne peut évoluer vers une configuration active qu’après : informations fournisseur approuvées par Kenny/Phil, conception serveur isolée/RLS, secrets côté serveur, prévol réel, validation fonctionnelle et déploiement transactionnel approuvé. Aucune de ces étapes n’est déclenchée par ce marqueur.
