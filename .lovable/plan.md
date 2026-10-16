# Bascule d'appel app ↔ widget fiable, et synchronisation complète des appels, enregistrements et textos

## But
- Pendant un appel dans l'app, le bouton « Continuer sur le widget » fait sonner le widget du courtier (ex. 113x). L'appel passe sans couper l'appelant, puis l'app se libère.
- Même chose dans l'autre sens depuis le widget : un bouton de Scott qui appelle notre service.
- L'historique d'appels, les enregistrements, les transcriptions et les textos sont les mêmes dans l'app et le widget.

## Constat à corriger
- La convention officielle est `<poste>M` pour l'app et `<poste>x` pour le widget.
- Certaines fiches courtier gardent encore l'ancien `<poste>W` comme « widget » (c'est le cas de Marc : 1136W). La bascule ciblerait alors le mauvais appareil.

## Étape 1 — Ciblage sûr
- La bascule cible toujours `<poste>x` (widget) ou `<poste>M` (app), calculé à partir du poste, sans se fier à la fiche.
- Avant de transférer, le système vérifie dans NetSapiens que l'appareil cible est réellement connecté. Sinon, refus clair (« Widget non connecté ») et l'appel continue où il est.
- Le bouton de l'app n'apparaît que si le widget est connecté.

## Étape 2 — Bascule sans coupure
- Transfert de l'appel côté appelant (l'autre partie de l'appel) vers l'appareil cible du même courtier, avec un délai de sonnerie de 20 s.
- L'ancien appareil ne raccroche qu'après la réponse du nouvel appareil.
- Si personne ne répond, l'appel revient ou reste sur l'appareil d'origine, jamais à la messagerie.
- Le bouton affiche l'état : « Bascule en cours… », « Continué sur le widget » ou « Échec, appel conservé ».
- Essai réel sur ton poste 113 (app → widget, puis widget → app) avant de déclarer la bascule fonctionnelle.

## Étape 3 — Synchronisation complète
- Appels : historique unique par poste, qui couvre 113M et 113x. Chaque ligne indique « Cellulaire » ou « Widget ». Un appel basculé reste une seule ligne.
- Enregistrements et transcriptions : rattachés à l'appel du poste, quel que soit l'appareil, et lisibles dans l'app. Le widget les reçoit par avis.
- Textos : le fil du poste est déjà partagé. On vérifie qu'un texto envoyé depuis le widget apparaît dans l'app, et l'inverse.
- Avis au widget de Scott : appel en cours, appel terminé, enregistrement prêt, transcription prête, texto reçu ou envoyé. Ils sont activés après sa confirmation.

## Étape 4 — Instructions pour Scott (courriel en anglais)
- Le lien du service de bascule, comment s'authentifier, la requête `{ "target": "mobile" }` et les réponses possibles.
- Le widget doit s'inscrire uniquement comme `<poste>x`, jamais `<poste>M`.
- Il ne doit pas répondre automatiquement aux appels entrants.
- Il doit accepter un appel basculé vers lui comme un appel entrant normal.
- Le format des avis d'appel, d'enregistrement, de transcription et de texto.
- Le scénario de test commun.

## Hors périmètre
Numéros, routage des numéros, Lemtel et crons : aucun changement.

## Détails techniques
- `pp-call-handoff` : utiliser `widgetDeviceId(ext)` / `mobileDeviceId(ext)` et ignorer `ns_widget_device_id` quand il vaut `<ext>W`. Vérifier l'inscription via `GET /domains/{d}/users/{u}/registrations`. Le transfert passe par `PATCH .../calls/{id}/transfer` vers `sip:<ext>x@<domain>`, sur la jambe de l'appelant (selon docs/netsapiens/calls.md et le guide de transfert). L'action `status` renvoie un booléen.
- Le service accepte aussi l'appel depuis le widget, avec la clé machine Maestro et `user_id` Maestro, et vérifie que le courtier possède bien le poste.
- `planipret_phone_calls` : ajout du champ appareil, déduit de l'AOR du CDR (M/x/W), et fusion des segments d'un appel basculé par orig_callid.
- `_shared/maestro-widget-sync.ts` : nouveaux types d'avis `recording_ready`, `transcript_ready`, `sms`, sous le drapeau `PP_WIDGET_CALL_EVENTS`.
- Tests Deno : ciblage x/M, refus si l'appareil n'est pas inscrit, propriété du poste, avis expurgés.
- Le bouton de l'app est en code web (copies miroir), donc aucune nouvelle version native n'est requise pour lui.
