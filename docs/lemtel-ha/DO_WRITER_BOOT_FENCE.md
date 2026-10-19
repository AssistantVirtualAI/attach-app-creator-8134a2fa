# Clôture au démarrage du writer DO

**Problème.** Après une bascule automatique, l’arbitre éteint DO. Si DO est rallumé (à la main, par erreur ou
par une maintenance DigitalOcean), ses conteneurs repartent seuls et l’ancien marqueur `/lemtel-lb-ready` est
encore sur le disque : le Load Balancer, qui préfère DO, renverrait les clients vers une base périmée pendant
que Hostinger est le writer, et la copie Storage de DO écraserait celle de Hostinger.

**Garde (`lemtel-ha-do-writer-boot-fence.sh`).**

- `boot-clear` (avant Docker) : supprime toujours le marqueur.
- `decide` (après Docker, réseau, WireGuard) : l’autorité de writer n’est confirmée **pour ce démarrage** que si
  le standby Hostinger réplique de nouveau depuis DO ; à défaut, après 10 minutes, si l’arbitre ne montre aucun
  incident et que Hostinger ne sert pas en writer promu. Sinon DO reste clôturé : conteneurs Lemtel arrêtés,
  état persistant `/var/lib/lemtel-ha/boot-fence/fenced`.
- Le marqueur et la copie Storage ne tournent que si `/run/lemtel-ha/writer-authority-confirmed` existe
  (conditions systemd ajoutées par l’installeur) : par défaut, après un redémarrage, ils sont bloqués.
- `unfence` : étape opérateur du retour planifié, avec accusé explicite, refusée tant que Hostinger sert en
  writer promu. `status` : lecture seule.

**Installation (`lemtel-ha-do-writer-boot-fence-apply.sh`).** Confirme d’abord l’autorité pour le démarrage
courant (standby en réplication), puis ajoute les unités et conditions ; tout échec retire ce qui a été ajouté.
N’arrête aucun conteneur.

**À savoir.** Un redémarrage normal de DO laisse le marqueur absent jusqu’à la reprise de la réplication
(environ une minute). Avec l’arbitre actif (5 cycles d’une minute), un redémarrage planifié de DO doit se faire
arbitre désactivé.
