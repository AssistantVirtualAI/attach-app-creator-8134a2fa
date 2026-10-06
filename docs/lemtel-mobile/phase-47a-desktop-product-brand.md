# Phase 47A — Marque produit et stabilité du test Desktop Lemtel

## Objectif

Supprimer les éléments de marque AVA visibles dans le softphone Desktop Lemtel et fiabiliser un paquet local de validation macOS séparé de l’ancienne installation.

## Interface produit

Le flux de connexion Lemtel conserve uniquement :

- le logo Lemtel canonique ;
- **courriel** et **mot de passe** ;
- une identité Lemtel Communications ;
- les paramètres de téléphonie chargés après connexion par le serveur.

Il ne doit pas afficher de sélecteur extension/domaine, de logo AVA, de mention « Powered by AVA » ni de lien vers une propriété produit tierce.

Les surfaces modifiées sont le formulaire de connexion, le pied de page du softphone, les réglages, le rail latéral et l’espace Intelligence.

## Paquet local macOS de test

Les anciennes installations et les paquets de test partageaient l’identifiant `com.lemtel.softphone`, ce qui pouvait faire réapparaître une ancienne fenêtre. Un paquet de test local doit donc :

1. utiliser un identifiant distinct, `com.lemtel.softphone.hostingeremailtest` ;
2. utiliser un profil macOS de test isolé ;
3. désactiver `hardenedRuntime` uniquement pour le **test local non distribué** lorsqu’aucune signature Apple Developer/nor notarisation n’est disponible ;
4. rester non publié et non livré aux utilisateurs.

> Les versions distribuées doivent retrouver une signature Apple Developer, le hardened runtime et une notarisation avant toute diffusion. Le paquet local de test n’est pas une release.

## Validation

La garde `LemtelDesktopBranding.test.ts` interdit la réintroduction de « Powered by AVA » ou « AVA Statistic » sur les surfaces Desktop Lemtel concernées.
