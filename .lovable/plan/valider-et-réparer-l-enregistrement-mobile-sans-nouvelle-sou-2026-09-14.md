# Valider et réparer l'enregistrement mobile — sans nouvelle soumission

Objectif : que l'application mobile soit réellement vue « en ligne » par le système téléphonique, et le rester, avec des correctifs livrés à distance uniquement.

## Ce que la mesure montre aujourd'hui

- Les 225 postes mobiles existent et pointent vers le bon serveur d'appels. Aucun poste à créer.
- Une seule ligne mobile est vivante (poste 113), et elle est tenue par le service d'arrière-plan, pas par l'application elle-même : le contrôle signale « moteur d'appel en arrière-plan seulement ».
- 219 courtiers n'ont aucun jeton de réveil : leur téléphone ne peut pas être réveillé à distance.
- Les iPhone n'envoyaient pas leur jeton de notification standard ; seul le jeton d'appel était présent.

## Correctifs livrés à distance

1. **Un seul propriétaire de la ligne.** Au démarrage et à chaque retour au premier plan : si le service d'arrière-plan tient la ligne, il la libère et l'application la reprend, puis on revérifie auprès du serveur. Plus de double enregistrement sur la même ligne.
2. **État honnête à l'écran.** L'écran d'état affiche qui tient la ligne (application ou service d'arrière-plan), depuis quand, et un bouton « Réparer maintenant » qui relance la séquence complète.
3. **Jeton de réveil garanti.** Vérification à l'ouverture : si le serveur n'a pas de jeton pour ce téléphone, l'app le renvoie, avec relances espacées, et le confirme au serveur.
4. **Surveillance et reprise.** Contrôle périodique ; si le serveur ne voit plus la ligne, réenregistrement automatique avec attente croissante pour ne pas marteler le serveur.
5. **Réparation côté serveur.** Réalignement des postes mal configurés, recréation des abonnements d'appel manquants, purge des jetons périmés, puis forçage d'enregistrement et nouvelle mesure.

## Validation

- Mesure avant/après sur les 225 postes : ligne présente, jeton présent, abonnement présent, enregistrement vivant.
- Test réel sur le poste 113 : l'application prend la ligne, la garde après mise en arrière-plan puis retour, et le serveur la voit.
- Échantillon de courtiers ayant l'app installée : même vérification.
- Publication d'une mise à jour à distance et confirmation qu'un téléphone la télécharge.

## Livrable

Tableau par courtier : en ligne / réparé / en attente d'installation de l'app, avec la cause exacte. Plus une conclusion nette : ce qui est réglé à distance, et ce qui exigerait une nouvelle soumission.

## Limite à connaître d'avance

L'audio des appels passe par le moteur d'appel natif : il est déjà dans l'application installée ou il ne l'est pas. Cette partie-là ne peut pas être ajoutée à distance. Tout le reste — enregistrement, réveil, état, réparation — l'est.

## Détails techniques

- Lecture : `pp-sip-registration-check`, `pp-mobile-device-status`, `/domains/{d}/users/{e}/devices`, CDR.
- Écriture : `pp-admin-sip-ops` (`status`, `force_register_all`, `reprovision`), `ns-resolve-sip-credentials`, `mobile-register-push`, abonnements webhook `call`.
- Côté app (OTA) : `sipBackendCheck.ts`, `sipStabilityMonitor.ts`, `aorTransportRecovery.ts`, `pushBootstrap.ts`, `permissions/notifications.ts`, écran d'état SIP — aucun code natif touché.
- Publication : `ota:bundle` + `mobile-release-publish` (canal `prod`).
- Invariants : aucune écriture DID ni règle de réponse, propriété exclusive de l'AOR `<ext>M`, pas de REGISTER en double, aucun secret journalisé.
