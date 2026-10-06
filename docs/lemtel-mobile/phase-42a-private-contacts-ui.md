# Phase 42A — Interface de consentement privé Lemtel

## Portée

Cette phase raccorde les sources UI mobiles au consentement privé préparé en phase 41B. Elle est entièrement inerte dans les builds actuels : `LEMTEL_PRIVATE_CONTACTS_UI_ENABLED` exige une origine non historique et le flag de build explicite `VITE_LEMTEL_PRIVATE_DIRECTORY=approved`.

## Isolation

- Le panneau Lemtel est distinct du panneau historique Planiprêt.
- Le consentement est lu/écrit avec la clé liée à l’origine et au compte Auth déjà définie par le cycle privé.
- L’accès système Contacts n’est demandé qu’après le consentement privé enregistré.
- Le carnet de l’appareil n’est jamais lu, mis en cache ou synchronisé par cette interface.
- La suppression future passe par `deleteLemtelDeviceContactsAndRevoke`, qui exige que le serveur confirme la suppression owner-private avant retrait du consentement local.

## État actuel

Le flag n’est pas configuré dans les builds. Aucun écran ne devient visible, aucun accès système n’est demandé et aucune suppression ne peut s’exécuter. La synchronisation reste une phase séparée : elle exigera une validation d’appareil réel, la fonction staging déjà déployée, une configuration de build explicitement autorisée et un rollback.

Aucun élément Planiprêt, FusionPBX, DNS, VPS ou Lovable ne change dans cette phase.
