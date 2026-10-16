# Marc-Alexandre : impossible de répondre sur l'app quand le widget Maestro est ouvert, et appels coupés au 2e appel

## Problèmes signalés
1. Quand le widget Maestro et l'app sont ouverts, l'appel ne peut être répondu que dans Maestro, pas sur le cellulaire.
2. Quand un deuxième appel entre, l'appel en cours tombe.

## Étape 1 — Diagnostic en lecture seule (aucun changement)
- Lire la configuration NetSapiens du poste de Marc : appareils inscrits (widget, app iPhone, autres), sonnerie simultanée, appels simultanés autorisés, appel en attente.
- Lire les traces SIP de ses appels récents : quel appareil répond, si l'app reçoit l'appel, si elle reçoit une annulation, et ce qui se passe à l'arrivée du 2e appel (refus, BYE, CANCEL).
- Comparer avec un poste qui n'a pas le problème.
- Séparer les preuves des hypothèses.

## Étape 2 — Rapport et décision
- Expliquer la cause confirmée en langage simple.
- Dire si c'est réglable côté système (réglage NetSapiens du poste ou de l'appareil du widget) ou si ça demande un changement dans l'app iPhone ou dans le widget de Scott.

## Étape 3 — Correctif (seulement après ton accord)
- Correctif côté système : appliqué au poste de Marc d'abord, avec relecture, puis aux autres courtiers touchés.
- Si le correctif touche l'app iPhone : préparé seulement, sans soumission. Il serait regroupé avec la release déjà prévue.
- Si le correctif touche le widget : courriel en anglais pour Scott.

## Hors périmètre
Aucun changement aux numéros, au routage des numéros, aux textos, à Lemtel ou aux crons, sans accord explicite.

## Détails techniques
- Lecture NS-API v2 : devices et registrations du user, answer rules (sim-ring), user fields (limites d'appels, call waiting), CDR et traces récentes.
- L'éventuelle modification passe par le plugin PpPjsip (gestion du 2e INVITE, du 486 ou du call waiting) et reste en attente de la release iOS.
