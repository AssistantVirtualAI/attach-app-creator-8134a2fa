# Enregistrement mobile + test en profondeur du système téléphonique

Deux objectifs : (1) confirmer et réparer l'enregistrement de l'app mobile sur le système téléphonique sans passer par une nouvelle soumission, (2) tester chaque fonctionnalité téléphonique pour tous les courtiers avant la prochaine mise à jour.

## Ce qui est réparable sans soumission

- Tout le serveur : postes mobiles, mots de passe, réglages, réveil des appareils, jetons de notification, abonnements d'événements, boîte vocale, textos, enregistrements.
- Le contenu web de l'app, qui se met à jour seul au démarrage (canal « prod », version 1.0.21).
- Exception : le moteur d'appel natif. L'audio des appels exige une build native complète — c'est le seul point qui impose une soumission.

## Partie 1 — Enregistrement mobile

1. **Mesure réelle** sur les 40 postes : poste mobile présent, mot de passe aligné, enregistrement vivant, échéance, jeton de réveil, abonnement d'appel. Tableau : qui est en ligne, qui ne l'est pas, et pourquoi.
2. **Correction serveur** : réaligner les postes mal configurés, recréer les abonnements manquants, réenregistrer les jetons périmés, forcer un réenregistrement puis revérifier.
3. **Auto-réparation livrée à distance** : au réveil de l'app, détecter « je me crois en ligne mais le serveur ne me voit pas », réparer, afficher un état honnête, avec relance espacée pour ne pas dupliquer l'enregistrement.

## Partie 2 — Test en profondeur, fonctionnalité par fonctionnalité

Pour chacune : un test réel sur le poste 113, puis un échantillon d'autres courtiers, puis une vérification de couverture sur les 40 comptes.

- Appels sortants : composition, sonnerie, audio, raccrochage, journal.
- Appels entrants : réveil de l'app, sonnerie, prise d'appel, refus, renvoi.
- En cours d'appel : muet, haut-parleur, attente, clavier, transfert simple et supervisé, second appel et conférence.
- Boîte vocale : enregistrement de sa voix, voix de synthèse, publication et activation, écoute, transcription, résumé, suppression — pour tous les courtiers, pas seulement le poste 113.
- Messages texte : envoi, réception, fil sans doublons.
- Enregistrements d'appels : activation, stockage, lecture.
- Avis d'enregistrement et règles de réponse : entrants seulement, routage DID intact.
- Notifications et réveil : app fermée, arrière-plan, premier plan.
- Remontée vers Maestro : appels, textos, résumés.

## Livrable

Rapport par fonctionnalité : testé / réparé / bloqué, avec la cause exacte et le nombre de courtiers couverts. Feu vert ou non pour la soumission, clairement énoncé.

## Détails techniques

- Lecture : `pp-sip-registration-check`, `/domains/{d}/users/{e}/devices`, `pp-mobile-device-status`, CDR.
- Écriture : `ns-resolve-sip-credentials` (poste `<ext>M`), `pp-admin-sip-ops` (`force_register`, `force_register_all`, `reprovision`), `mobile-register-push`, abonnements webhook `call`.
- Boîte vocale : `pp-greeting-record`, `pp-greeting-generate`, `pp-ns-voicemail`, `ns-transcription`.
- Côté app (mise à jour à distance) : `sipBackendCheck.ts`, `sipStabilityMonitor.ts`, `aorTransportRecovery.ts`, `outboundRoute.ts` — aucun code natif touché.
- Publication : `mobile-release-publish` + `mobile-config` (canal `prod`).
- Invariants : aucune écriture DID ni règles de réponse, propriété exclusive de l'AOR `<ext>M`, pas de REGISTER en double, aucun secret journalisé, aucune donnée réelle de courtier altérée (tout test restauré à l'état initial).
