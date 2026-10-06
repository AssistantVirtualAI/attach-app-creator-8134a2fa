# Phase 41A — Adaptateurs mobiles Lemtel : annuaire privé et diagnostic WSS

## Objectif

Cette phase prépare le code mobile afin qu’un **futur build Lemtel distinct** puisse appeler les fonctions staging déjà validées : `lemtel-caller-lookup` et `lemtel-wss-diagnostics`. Elle ne change ni `BACKEND_URL`, ni la clé publique, ni les sessions, ni les applications distribuées.

## Verrouillage par défaut

L’adaptateur est inactif sauf si ces deux conditions sont vraies dans un build futur :

1. l’origine n’est plus l’origine historique;
2. `VITE_LEMTEL_PRIVATE_DIRECTORY=approved` est défini dans un environnement de build protégé.

La valeur actuelle n’est pas définie. Les builds existants conservent donc exactement les appels historiques et les nouveaux builds non configurés conservent le repli local sans envoyer de données à Lemtel.

## Garanties d’isolation

| Flux | Ancienne origine | Nouvelle origine sans flag | Future origine Lemtel + flag |
| --- | --- | --- | --- |
| Lookup appelant | `pp-caller-lookup` existant | Repli local numéro seulement | `lemtel-caller-lookup`, membre/organisation courants seulement |
| Journal WSS | `pp-wss-fallback-log` existant | Journal local seulement | `lemtel-wss-diagnostics` avec identifiants ordinaux, état et latence bornée |
| Contacts appareil | Comportement historique inchangé | Désactivé | Toujours désactivé dans cette phase |

L’adaptateur prend l’organisation uniquement depuis les credentials Lemtel déjà stockés et validés comme UUID. Il ne reçoit jamais l’organisation depuis une saisie UI. Aucun endpoint WSS, mot de passe SIP, URL brute ou raison libre n’est transmis : le journal reçoit seulement `candidate-<index>`, un code de panne fermé et une latence 0–30 000 ms.

## Ce qui reste interdit

La synchronisation de contacts appareil reste désactivée pour Lemtel. Avant de l’activer, il faudra un consentement explicitement distinct, lié à l’origine et au compte, une suppression serveur atomique respectant ce scope et une validation sur appareil réel. Rien dans cette phase ne déploie le code, ne configure un flag de build, ne bascule une application, ne collecte un contact, ne change FusionPBX ou ne modifie Planiprêt.
