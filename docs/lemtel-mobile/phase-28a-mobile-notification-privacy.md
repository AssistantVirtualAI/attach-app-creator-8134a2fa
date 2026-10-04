# Lemtel — Phase 28A : notifications Mobile limitées à l'extension connectée

Base : `79de1e284`.

## Problème corrigé

Le hook de notifications locales écoutait aussi les SMS, les boîtes vocales et les nouveaux enregistrements avec un repli au niveau organisation. Un membre ou un administrateur pouvait donc recevoir sur son téléphone des notifications d'autres extensions.

## Canaux autorisés

| Canal | Table | Filtre exact | Notification |
|---|---|---|---|
| `notif-cdr-<ext>` | `pbx_call_records` (INSERT) | `extension=eq.<ext>` | Appel entrant manqué |
| `notif-vm-<ext>` | `pbx_voicemails` (INSERT) | `extension=eq.<ext>` | Nouvelle boîte vocale |

Chaque charge reçue est revérifiée : `extension` doit être exactement l'extension connectée, sinon elle est ignorée. Sans extension, aucun canal n'est créé et aucune notification n'est émise. Les deux canaux et l'écouteur natif de tap sont retirés au démontage ou au changement de session.

## Pas de doublon voicemail

Un CDR marqué voicemail ne produit plus de notification. La table `pbx_voicemails` est l'unique source des notifications de boîte vocale (libellé, `dedupeKey` `vm-<id>` et navigation `voicemail` conservés).

## Flux suspendus

Les notifications locales **SMS** et **nouvel enregistrement** sont suspendues. Les flux Realtime `pbx_sms_messages` et `pbx_call_recordings` ne portent pas de colonne d'extension utilisable pour un filtre direct; les écouter au niveau organisation divulguerait l'activité d'autres extensions. Ils ne seront réintroduits que par un flux serveur explicitement lié à l'extension.

## Ce qui ne change pas

Appels SIP JsSIP, portail, PBX/FusionPBX, écrans SMS/appels/enregistrements/messagerie, notifications Push, Desktop et Planiprêt.

## Validation sur appareil (plus tard)

- Appel manqué sur l'extension connectée : une notification, tap vers les appels manqués.
- Message vocal : une seule notification, tap vers la messagerie.
- Activité d'une autre extension de la même organisation : aucune notification.
- Aucun SMS ni enregistrement ne déclenche de notification locale.
