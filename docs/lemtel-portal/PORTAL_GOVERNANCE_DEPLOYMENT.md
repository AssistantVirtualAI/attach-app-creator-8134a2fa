# Déploiement consolidé de la gouvernance du portail Lemtel

Ce déployeur transactionnel est conçu pour un seul writer **DigitalOcean** déjà actif. Il vérifie le bundle, retient un backup des fichiers runtime, applique les migrations Lemtel 0012–0014 et remplace le portail ainsi que les deux fonctions Edge d’autorité.

| Inclus | Exclu explicitement |
|---|---|
| Memberships, cycle de vie des domaines, transfert atomique du owner, contrôles de sessions par famille d’application. | DNS/Cloudflare, routage, configuration PostgreSQL réseau, Hostinger runtime, promotion, fencing, PBX/SIP/WSS/TURN, données de communication, création d’utilisateurs, courriels. |

Le lanceur exige une attestation textuelle de backup chiffré frais. En cas d’échec après remplacement d’un fichier, il restaure les fichiers Edge/portail depuis le backup local et relance uniquement le conteneur Edge existant.
