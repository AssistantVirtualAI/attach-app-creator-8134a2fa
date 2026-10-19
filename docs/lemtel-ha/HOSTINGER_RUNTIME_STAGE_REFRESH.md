# Rafraîchissement du runtime de secours Hostinger et marqueur du writer promu

L’inventaire du 19 octobre a montré que le runtime préparé sur Hostinger avait dérivé du runtime en service sur DO
(Caddyfile ancien, pas de route d’ingestion de trafic, fonctions Edge plus anciennes) et embarquait une **copie
périmée du marqueur `/lemtel-lb-ready`**. Aucun marqueur n’était publié par un Hostinger promu : le moniteur
Cloudflare l’aurait vu soit toujours sain (copie statique), soit jamais sain. Hostinger n’avait pas non plus de
certificat pour `lemtel.assistantvirtualai.com`.

## Rafraîchissement (`lemtel-ha-hostinger-runtime-stage-refresh.sh`, sur Hostinger)

- Entrée : enveloppe runtime créée sur DO (`lemtel-ha-do-writer-runtime-envelope-create.sh`, chiffrée `age` pour
  l’identité Hostinger, inclut désormais `volumes/pooler/pooler.exs`), empreinte SHA-256 vérifiée.
- Contenu limité à la liste blanche (compose, `.env`, fonctions, Caddy, Envoy, pooler) ; liens, chemins absolus ou `..`
  refusés ; base et Storage jamais inclus.
- Aucun marqueur de préparation n’est mis en scène ; dossiers temporaires du portail retirés.
- Caddy du secours : `tls internal` pour l’hôte Lemtel (Cloudflare en SSL « full » l’accepte) : la promotion n’attend
  jamais un certificat ACME en pleine panne. Si la zone passe un jour en « full (strict) », il faudra un certificat
  Origin CA à la place.
- Ancien stage conservé dans `/var/lib/lemtel-ha/runtime-stage-backups/`, restauré si l’échange échoue ; artefact et
  `current.sha256` mis à jour pour l’attestation de stage.
- Refus si la base de secours n’est pas en recovery ou si un runtime promu tourne.

## Marqueur du writer promu

`lemtel-ha-do-writer-lb-ready-refresh.sh` accepte le rôle `hostinger_promoted_writer`
(`LEMTEL_HA_EXECUTE=refresh_hostinger_writer_l7_ready`) : mêmes contrôles (Caddy, base writer, Auth), Auth vérifiée
**localement** (le chemin public ne mène à Hostinger qu’une fois ce marqueur vu par Cloudflare), `writer_role` =
`hostinger_writer`. Après démarrage du runtime promu, le script de démarrage installe une unité et un timer persistants
(rafraîchissement toutes les 30 s) et indique `lb_ready_marker=present|absent`.
