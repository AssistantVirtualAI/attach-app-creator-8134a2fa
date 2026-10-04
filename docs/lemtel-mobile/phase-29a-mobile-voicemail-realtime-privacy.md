# Lemtel — Phase 29A : confidentialité Realtime Mobile de la boîte vocale

## Problème de départ
`VoicemailScreen.tsx` s'abonnait à `pbx_voicemails` avec un filtre `domain_uuid` (canal global `vm-mobile`) : un téléphone était réveillé par les messages vocaux de toutes les extensions du domaine.

## Correctif
- Extension connectée : `String(mobile.extension || '').trim()`; sans token ou sans extension, aucun canal.
- Filtre exact : `extension=eq.${ext}`; canal `vm-mobile-${ext}`.
- Événements couverts : `INSERT`, `UPDATE`, `DELETE` sur `pbx_voicemails`.
- Contrôle défensif : avant `reload()`, l'extension de `payload.new` (ou `payload.old` pour `DELETE`) doit être exactement `ext`, sinon la charge est ignorée. Aucune écriture, aucun affichage de la charge brute.
- Le canal est retiré à l'unmount et à chaque changement de token/extension; plus de dépendance à `mobile.domainUuid`.

## Hors périmètre (inchangé)
Liste serveur `mobile-voicemails`, lecture audio, appel SIP, portail, PBX, Edge, RLS.

## Phase suivante requise
Autorisation serveur des URL audio signées (le filtre Realtime client ne protège pas l'audio).
