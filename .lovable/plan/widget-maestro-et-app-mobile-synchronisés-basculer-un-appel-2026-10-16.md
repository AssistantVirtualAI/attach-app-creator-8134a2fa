# Widget Maestro et app mobile synchronisés : basculer un appel et partager l'historique

## But
1. Un courtier en appel sur le widget peut le reprendre sur son cellulaire, et l'inverse, sans couper l'appelant.
2. Les appels faits ou reçus sur le widget sont visibles dans l'app, et ceux de l'app dans le widget.
3. Les deux sonnent ensemble, et répondre sur l'un arrête la sonnerie de l'autre, sans le bloquer.

## Étape 1 — Vérification (lecture seule)
- Lire dans NetSapiens quels appareils de chaque courtier sont réellement connectés, pour confirmer que le widget et le cellulaire utilisent des appareils distincts. C'est la cause probable de « je dois répondre dans Maestro ».
- Vérifier si l'historique d'appels de l'app inclut déjà les appels du widget, car les deux passent par le même poste.
- Vérifier ce que le webhook de Scott peut recevoir. Aujourd'hui, il ne reçoit que la synchronisation du profil courtier.

## Étape 2 — Bascule d'appel (reprendre l'appel ailleurs)
- Ajouter un bouton « Continuer sur mon cellulaire » côté widget et « Continuer sur le widget » côté app.
- Le serveur demande à NetSapiens de transférer l'appel en cours vers l'autre appareil du même courtier. L'autre appareil sonne ou reprend l'appel, puis le premier se libère.
- Le bouton n'apparaît que si l'autre appareil est connecté.
- Côté widget, Scott doit ajouter le bouton. On lui fournit un lien serveur sécurisé et un courriel en anglais.

## Étape 3 — Historique et appel en cours partagés
- Source unique : les fiches d'appels NetSapiens du poste, qui couvrent tous les appareils. L'app les affiche avec l'appareil utilisé (cellulaire ou widget).
- On envoie au webhook de Scott un avis « appel en cours » et « appel terminé » pour chaque courtier lié à Maestro. Le widget peut ainsi afficher les appels faits sur l'app, et proposer « Reprendre ici ».
- Ces envois réutilisent l'envoi Maestro existant : sans bloquer les appels, avec anti-doublon et sans jamais exposer de secret.

## Étape 4 — Tests
- Test serveur : la bascule n'agit que sur l'appel du courtier lui-même, et l'avis envoyé ne contient aucun secret.
- Recette réelle avec Marc après la release : répondre sur le widget, reprendre sur le cellulaire, puis l'inverse. Vérifier aussi l'historique des deux côtés.

## Dépendances
- Scott doit mettre en ligne /sync, accepter les avis d'appel et ajouter le bouton dans le widget.
- L'app iPhone : le bouton et la reprise d'appel demandent une nouvelle version, regroupée avec la release prévue.

## Hors périmètre
Aucun changement aux numéros, au routage des numéros, aux textos, à Lemtel ou aux crons.

## Détails techniques
- Bascule : NS-API v2 calls (transfer ou intercept vers l'AOR `1136M` ou l'identité du widget), via une nouvelle fonction `pp-call-handoff` qui vérifie que le JWT et le poste appartiennent au courtier.
- Avis d'appel : abonnement NetSapiens `call` déjà reçu par ns-webhook-receiver, transmis par `_shared/maestro-widget-sync.ts` avec un nouveau type d'événement. Le format est à valider avec Scott.
- Une règle à ajouter dans AGENTS.md.
