# Opérateur de bootstrap scellé de l’arbitre

`scripts/lemtel-cloudflare-arbiter-bootstrap-operator.mjs` injecte la configuration scellée dans l’arbitre
`lemtel-failover-arbiter`, puis le **ramène en `disabled`**. Il ne met jamais `active`.

## Déroulé

1. Gates locales (intention exacte, compte, empreinte de la source, date de compatibilité, nouvelle révision
   `lemtel-failover-…`, droplet, origine `https://lemtel-failover-arbiter.<sous-domaine>.workers.dev`, tokens, puits).
2. Le token DigitalOcean doit **lire** le droplet writer actif (aucune action n’est demandée).
3. Prélecture Cloudflare : mode `disabled`, bindings attendus, révision différente de l’actuelle.
4. Cron de l’arbitre à chaque minute (le mode `disabled` ne fait rien à chaque réveil).
5. Secrets générés en mémoire. Le secret d’approbation de drill va **d’abord** dans le Trousseau macOS
   (`lemtel-failover-drill-approval-<révision>`), vérifié, avant tout changement du Worker.
6. Bootstrap via `injectBootstrapConfiguration` : version `bootstrap` (clé RSA publique, secrets de bootstrap,
   clé AES d’état), attente de la clé publique servie, POST chiffré, puis **toujours** version `disabled` ne gardant
   que `STATE`, `ARBITER_SERIALIZER`, `FAILOVER_MODE=disabled`, `CONFIG_REVISION` et la clé AES (héritée).
7. Configuration de l’agent Hostinger via le script `lemtel-ha-hostinger-failover-agent-configure.sh`
   (secret agent, `PROMOTION_EXECUTION_MODE=review`), validée par le preflight de l’agent ; l’agent n’est ni activé
   ni démarré. Échec : état précédent restauré.

## Politique injectée

Observation chaque minute, panne retenue après **5 cycles** consécutifs (≈ 5 min) et avec un état de préparation
Hostinger récent, arrêt gracieux 120 s avant `power_off`, délai max d’arrêt 900 s, commande valable 300 s,
configuration valable 89 jours.

Le déployeur de version désactivée accepte désormais aussi la clé AES d’état (`CONFIG_STATE_ENCRYPTION_KEY`,
`secret_text`) et l’hérite strictement ; tout autre binding supplémentaire reste refusé.
