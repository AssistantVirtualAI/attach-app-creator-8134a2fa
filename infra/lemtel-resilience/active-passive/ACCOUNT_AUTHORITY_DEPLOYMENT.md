# Lemtel — prévol de déploiement de l’autorité des comptes

Ce prévol est **lecture seule**. Il vérifie que le writer DigitalOcean, son Edge runtime et la base Lemtel peuvent recevoir un déploiement transactionnel ultérieur de :

- la récupération par mot de passe temporaire;
- l’autorité portail/organisation/utilisateur;
- la réconciliation Mobile, Desktop et portail.

Il n’écrit pas la base, ne redémarre pas de conteneur, ne lit ni n’affiche de secret, n’envoie aucun courriel, ne contacte pas Hostinger, ne change ni DNS ni téléphonie.

## Conditions avant déploiement réel

1. Une **sauvegarde DO fraîche** attestée;
2. le prévol avec tous les prérequis à `true`, notamment le sender Resend et `GOTRUE_DISABLE_SIGNUP=true`;
3. un bundle dont les digests sont vérifiés pour les migrations `0004` et `0007`, ainsi que les fonctions `lemtel-onboarding-admin`, `lemtel-password-reset-request`, `lemtel-session-bootstrap` et `lemtel-complete-first-password`;
4. une approbation explicite de la fenêtre transactionnelle;
5. un smoke test avec une adresse synthétique inexistante : réponse générique sans envoi réel.

Le déploiement futur doit toujours être réalisé sur **DO uniquement**, writer actuel. Hostinger reste passif; aucun DNS, Cloudflare, runtime de secours, SIP ou FusionPBX ne doit être modifié.
