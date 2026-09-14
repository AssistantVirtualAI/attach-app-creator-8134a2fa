# Enregistrement de tous les courtiers + tests bout en bout

Objectif : vérifier poste par poste que chaque courtier est réellement enregistré sur le système téléphonique, forcer l'enregistrement partout où ce n'est pas le cas, et tester l'app mobile de bout en bout.

## Ce qui est déjà mesuré

- 225 courtiers ont une extension, et tous ont leur ligne mobile créée côté système téléphonique.
- Seuls quelques téléphones montrent une ligne active (111, 113, plus des inscriptions récentes pour trois autres courtiers) : la très grande majorité des lignes mobiles n'est pas enregistrée, ce qui est attendu tant que l'app n'est pas ouverte sur l'appareil.
- 24 jetons de réveil existent, répartis sur 6 courtiers seulement.

Conséquence à énoncer clairement : une ligne mobile ne peut rester enregistrée que si l'app est installée et ouverte au moins une fois sur le téléphone du courtier. Forcer côté serveur réaligne la configuration et relance l'enregistrement, mais ne crée pas d'enregistrement pour un téléphone qui n'a jamais installé l'app.

## Étape 1 — Recensement complet (225 courtiers)

Pour chaque courtier : ligne mobile présente, mot de passe aligné, état d'enregistrement, échéance, serveur de rattachement, jeton de réveil, abonnement d'appel.
Résultat : trois groupes — en ligne, configuré mais téléphone jamais vu, configuration à réparer.

## Étape 2 — Réparation et forçage en lot

- Réaligner les lignes mal configurées (mot de passe, serveur, expiration).
- Recréer les abonnements d'événements manquants et purger les jetons périmés.
- Lancer le forçage d'enregistrement sur l'ensemble des postes, par vagues, puis remesurer.
- Réveiller par notification les appareils qui ont un jeton valide mais pas de ligne active, puis remesurer.

## Étape 3 — Tests bout en bout sur l'app mobile

Sur le poste 113 d'abord, puis sur un échantillon de courtiers réellement en ligne :

- Connexion : la ligne mobile se crée et s'enregistre automatiquement.
- Appel sortant : sonnerie, audio, raccrochage, journal d'appel.
- Appel entrant : réveil de l'app, sonnerie, prise et refus.
- En cours d'appel : muet, haut-parleur, attente, clavier, transfert.
- Boîte vocale : enregistrement de la voix, publication, écoute.
- Textos, historique et remontée vers Maestro.

Chaque test réel est restauré à l'état initial (aucune donnée de courtier altérée).

## Livrable

Tableau final : nombre de courtiers en ligne, réparés, et ceux en attente d'installation de l'app, avec la cause exacte pour chaque cas restant, plus le résultat de chaque fonctionnalité testée et un feu vert ou non pour la soumission.

## Détails techniques

- Lecture : `pp-sip-registration-check`, `GET /domains/{d}/users/{e}/devices`, `pp-mobile-device-status`, CDR.
- Écriture : `pp-admin-sip-ops` (`reprovision`, `force_register`, `force_register_all`), `ns-resolve-sip-credentials` (AOR `<ext>M`), `mobile-register-push`, abonnements webhook `call`, `sip-wake-push`.
- Invariants : aucune écriture DID ni règle de réponse, propriété exclusive de l'AOR `<ext>M`, pas de REGISTER en double, aucun secret journalisé.
