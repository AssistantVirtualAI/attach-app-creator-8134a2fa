# Exercice supervisé en mode « review »

But : prouver toute la chaîne de bascule automatique **sauf la promotion** — détection d’une vraie panne du
writer DO, verrou « Hostinger prêt », clôture réelle de DO via l’API DigitalOcean (double confirmation d’arrêt),
commande de promotion signée, livrée une seule fois à l’agent Hostinger qui la valide et s’arrête en
`manual_promotion_action_required`. Hostinger reste standby : au rallumage, DO reprend son rôle tout seul
(clôture au démarrage confirmée par la réplication).

## Outils

- `scripts/lemtel-cloudflare-arbiter-bootstrap-operator.mjs` + `LEMTEL_DRILL_AUTHORIZATION=supervised_review_drill:<1-4>` :
  nouvelle révision scellée et autorisation de drill **de quelques heures** (champ `authorization_kind`), signée avec
  le secret de drill et scellée avec la clé d’état, tous deux en mémoire ; le mode reste `disabled`.
- `scripts/lemtel-cloudflare-arbiter-mode.mjs` : bascule `disabled` ↔ `active` seulement (tous les autres bindings
  hérités), `active` refusé sans configuration scellée ni autorisation valides pour la révision courante.
- `lemtel-ha-hostinger-failover-agent-control.sh` : `start` (répertoire de preuves, unités revues, timer), `stop`,
  `archive` (déplace les preuves à usage unique après l’exercice), `status`.
- L’unité de l’agent accepte désormais 600 s et l’écriture dans `/etc/systemd/system` (nécessaires au mode `execute`).

## Déroulé (≈ 10–15 min de coupure)

1. Préparation : bootstrap + autorisation 3 h ; agent en `review`.
2. Agent démarré ; arbitre `active` ; attendre l’état `healthy`.
3. Panne provoquée : arrêt du conteneur Caddy de DO → Cloudflare répond 521/522.
4. Attendu : `incident_suspected` ×5 → `fence_wait_graceful` (arrêt DO) → `fence_poll_terminal` → `fence_verified`
   → `promotion_command_ready` → `manual_promotion_action_required/command_dispatched_to_agent` ; registre agent :
   `manual_promotion_action_required`.
5. Retour : arbitre `disabled`, agent arrêté, DO rallumé, clôture au démarrage confirmée, Caddy relancé,
   site vérifié via le Load Balancer, preuves de l’exercice archivées.

Toute dérive (état `blocked`, délai dépassé) : arbitre `disabled`, agent arrêté, rallumage de DO, puis analyse.

## First real drill (2026-10-19, 04:52–05:12) and the fixes it produced

Result: detection through the DigitalOcean-only probe (`522`), five failure cycles, signed standby readiness,
**real DigitalOcean shutdown** with two terminal confirmations, signed command prepared and delivered once to
the Hostinger agent; restore powered DigitalOcean back on, the boot fence confirmed writer authority through
replication, site and probe back to `200` about 20 minutes after the outage started.

Defects found and fixed:

- **Stage attestation always failed inside the agent sandbox** (`ProtectHome=true` hid
  `/home/lemtelstorage/storage-current`). The agent stopped at `received_guard_pending` with no reason because
  local script output was discarded. Fixes: `ProtectHome=read-only`; every local step now reports its fixed
  `reason=` token in the ledger and the blocked status; and the **standby readiness itself runs the full stage
  attestation in check mode** (no evidence written), so the arbiter can no longer fence while the takeover would
  fail. The agent prints `hostinger_standby_readiness=<ready|reason>` on every poll.
- **Every other cycle was skipped** (`cycle_not_due`): the cron is not exactly 60 s apart. A 10 s tolerance keeps
  one cycle per minute (detection in ~5 min instead of ~10).
- **The delivery reason was overwritten** by later ticks (`manual_promotion_action_required` without
  `command_dispatched_to_agent`), so the launcher never saw the end of the drill. The reason is now kept.
- **No way to close an incident after a drill**: the next sealed bootstrap would block forever with
  `previous_revision_incident_manual_review`. New operator tool
  `scripts/lemtel-cloudflare-arbiter-incident-archive.mjs` (arbiter disabled, writer droplet active, Hostinger
  confirmed in recovery, explicit intent) copies the sealed record to an archive key and removes the live one.
- Launcher defects (not in the repository): wrong droplet status parsing (would not have powered DigitalOcean back
  on) and a stop condition that could not match.
