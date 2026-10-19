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
