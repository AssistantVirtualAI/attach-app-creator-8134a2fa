# Valider et réparer l'enregistrement téléphonique — sans nouvelle soumission

Objectif : confirmer que l'application mobile déjà installée s'enregistre bien sur le système téléphonique pour chaque courtier, et corriger ce qui cloche en utilisant uniquement le serveur et la mise à jour à distance du contenu de l'app (pas de passage par l'App Store).

## Ce qui est possible sans soumission

- Tout ce qui vit côté serveur : création/alignement du poste mobile, réglages du poste, réveil des appareils, jeton de notification, abonnements d'événements.
- Le contenu web de l'app, qui se met à jour tout seul au démarrage (canal « prod » déjà en place, version actuelle 1.0.21).
- Ce qui reste impossible sans nouvelle version : le moteur d'appel natif. L'enregistrement et l'état « en ligne » peuvent être réparés; l'audio des appels dépend toujours d'une build native complète.

## Étapes

1. **Mesure de l'état réel**
   - Interroger le système téléphonique pour les 40 postes : poste mobile présent, mot de passe aligné, enregistrement vivant, échéance, jeton de notification, abonnement d'appel.
   - Produire un tableau clair : qui est enregistré, qui ne l'est pas, et la raison exacte de chaque échec.

2. **Correction serveur des causes trouvées**
   - Réaligner les postes mobiles mal configurés (nom, mot de passe, transport, durée d'enregistrement, notifications activées).
   - Recréer les abonnements d'événements manquants et réenregistrer les jetons de réveil périmés.
   - Forcer un réenregistrement sur les postes hors ligne et revérifier après coup.

3. **Auto-réparation côté app, livrée à distance**
   - Renforcer le contrôle au réveil de l'app : détecter « je me crois en ligne mais le serveur ne me voit pas », réparer, et afficher un état honnête.
   - Ajouter une relance espacée (évite de dupliquer l'enregistrement et de couper la ligne précédente).
   - Publier ce contenu comme mise à jour à distance : les courtiers l'auront au prochain démarrage, sans rien installer.

4. **Validation**
   - Test sur le poste 113 : déconnexion/reconnexion, mise en arrière-plan, retour au premier plan — vérifier chaque fois côté serveur que la ligne mobile est bien vivante.
   - Test sur un échantillon d'autres courtiers.
   - Rapport final : nombre de postes enregistrés avant/après, cas restants et pourquoi.

## Détails techniques

- Lecture : `pp-sip-registration-check` (lecture seule), `/domains/{d}/users/{e}/devices`, `pp-mobile-device-status`.
- Écriture : `ns-resolve-sip-credentials` (provisionnement `<ext>M`), `pp-admin-sip-ops` (`force_register`, `force_register_all`, `reprovision`), `mobile-register-push`, abonnements webhook `call`.
- Côté app (OTA) : `src/lib/planipret/sip/sipBackendCheck.ts`, `sipStabilityMonitor.ts`, `aorTransportRecovery.ts`, `nativePpSipService.ts` — pas de code natif touché.
- Publication : `mobile-release-publish` + `mobile-config` (canal `prod`), bundle appliqué au redémarrage suivant.
- Invariants respectés : aucune écriture DID/règles de réponse, propriété exclusive de l'AOR `<ext>M`, pas de REGISTER en double, aucun secret journalisé.
