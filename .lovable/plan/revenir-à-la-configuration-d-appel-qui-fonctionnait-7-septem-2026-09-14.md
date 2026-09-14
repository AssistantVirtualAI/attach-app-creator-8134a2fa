# Revenir à la configuration d'appel qui fonctionnait (7 septembre)

## Ce que les données montrent

J'ai retrouvé la dernière preuve d'appel réussi depuis l'application mobile : **7 septembre 2026, 14h00 UTC, poste 113**, appel sortant de 32 secondes, audio réel transporté par le téléphone lui-même (flux audio venant de l'appareil, codec G.711). Le 13 septembre, seuls des appels entrants ont abouti. Aucun appel sortant réussi depuis le 7 septembre.

Entre cette date et aujourd'hui, la partie « appel » de l'application a été réécrite (plus de 800 lignes modifiées) : nouvelle règle qui refuse tout chemin de secours, reprise automatique de la ligne, et nouvelles vérifications. C'est exactement la période où les appels sortants ont cessé d'aboutir.

## Objectif

Remettre le comportement d'appel tel qu'il était le 7 septembre, livré à distance (sans nouvelle soumission), en gardant les écrans de diagnostic utiles, puis prouver par un vrai appel que ça fonctionne.

## Étapes

1. **Reconstituer la version de référence** : extraire la version exacte du code d'appel datée d'avant le 7 septembre et la comparer ligne à ligne avec la version actuelle pour isoler chaque changement de comportement (prise de ligne, refus de secours, ordre d'initialisation, délais).
2. **Restaurer le chemin d'appel d'origine** : rétablir la logique de placement d'appel et d'enregistrement telle qu'elle était, y compris le repli qui existait alors, au lieu du blocage ajouté le 14 septembre.
3. **Garder ce qui aide** : l'écran d'état (qui tient la ligne, depuis quand, bouton « Réparer maintenant ») et l'envoi du jeton de réveil restent, car ils n'interfèrent pas avec l'appel.
4. **Forcer l'enregistrement côté serveur** : réaligner le poste mobile de chaque courtier sur les mêmes réglages qu'au 7 septembre et relancer l'enregistrement pour tout le monde depuis le serveur.
5. **Vérifier réellement** : lancer un appel sortant et un appel entrant sur le poste 113, puis confirmer dans les relevés d'appels du système téléphonique que l'audio a bien circulé (durée > 0 et flux audio présent), comme sur l'appel du 7 septembre.
6. **Rapport final** : tableau des courtiers enregistrés / à réparer / en attente d'ouverture de l'app, avec feu vert ou non pour soumettre la mise à jour.

## Détails techniques

- Base de référence : dernier état du dossier SIP avant le 7 septembre (commit `6d94dee6f`, 31 août) ; delta à revoir : `useMplanipretSoftphone.ts` (550 l.), `outboundRoute.ts` + test (nouveaux), `sipOwnershipRepair.ts` (nouveau), `nativePpSipService.ts`, `nativeSipService.ts`, `PpPjsip.swift` / `PpVoipCall.swift` (non livrables OTA — analysés seulement pour comprendre, pas modifiés).
- Preuve CDR du 7 septembre : `call-orig-from-user: 113M`, relais audio côté appareil `192.168.0.109:4000`, `call-audio-codec: G.711 u-law`, durée 32 s.
- Restauration OTA uniquement (bundle JS) : aucun changement iOS natif, PJSIP/CallKit/session audio non touchés.
- Serveur : `pp-admin-sip-ops` (`force_register`, `force_register_all`), `ns-resolve-sip-credentials` (alignement du poste `<ext>M`), `pp-sip-registration-check` pour le contrôle.
- Validation : relevés CDR NetSapiens après appel test, `npx tsc --noEmit`, suite de 93 tests, build.

## Limite connue

Si la version installée sur ton téléphone n'embarque pas le moteur d'appel natif, aucune livraison à distance ne pourra faire passer l'audio. L'étape 5 le tranchera de façon définitive : soit l'appel test aboutit avec audio, soit une soumission est nécessaire — et je te le dirai clairement.
