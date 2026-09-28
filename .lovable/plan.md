# Fiche client complète + création client Maestro (app mobile)

## 1. Appel entrant d'un client existant
- À la sonnerie/réponse, identifier l'appelant (numéro → contacts locaux + recherche Maestro par téléphone, déjà en place via la recherche d'appelant).
- Si trouvé : ouvrir automatiquement la fiche client (avec l'identifiant Maestro) par-dessus l'écran d'appel, sans jamais bloquer ni interrompre l'appel (boutons CallKit/app inchangés).
- Si inconnu : bandeau « Numéro inconnu » avec bouton « Créer le client ».

## 2. Créer un client depuis l'historique d'appels
- Bouton « Créer comme client Maestro » sur chaque appel dont le numéro n'est lié à aucun client.
- Petit formulaire : prénom, nom, courriel (facultatif), téléphone prérempli.
- Création dans Maestro, puis relecture Maestro pour confirmer (jamais « créé » sans confirmation), puis apparition dans la liste des contacts clients et rattachement des appels/textos passés à ce numéro.

## 3. Fiche client = historique complet
Une seule fiche (utilisée aux points 1 et 3), onglets :
- Profil (coordonnées Maestro vérifiées)
- Contrats / dossiers Maestro
- Appels (avec lecture de l'enregistrement et transcription — si consentement approuvé)
- Textos
- Courriels
- Tâches (terminer / reporter depuis la fiche)
- Chronologie « Tout » combinant le reste

## Détails techniques
- Étendre `pp-contact-timeline` pour agréger : appels (`planipret_phone_calls` + enregistrements/transcriptions), SMS, courriels, tâches Maestro, contrats/dossiers Maestro; recherche par `mid` ou téléphone normalisé E.164.
- Nouvelle action `create_client` (fonction Maestro existante `maestro-actions`) : POST vers l'endpoint clients Maestro puis GET de relecture. L'endpoint de création client n'est pas documenté dans nos docs actuels — première étape : le confirmer dans l'API Maestro; si indisponible pour le jeton courtier, le bouton affichera un message clair.
- Mobile : `ContactTimeline` réutilisé en onglets dans `apps/planipret-mobile`; ouverture auto depuis l'événement d'appel entrant (JS seulement, aucune modification PJSIP/CallKit/PushKit natif).
- Livraison par OTA (JS) si possible; aucun polling ajouté (relecture après action et broadcast temps réel existant).
- Aucun changement DID/SIP/NetSapiens/secrets; tâches NetSapiens suspendues restent suspendues.
