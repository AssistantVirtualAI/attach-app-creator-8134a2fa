# Contrat MIME L7 du writer Lemtel

## Fait observé

L'attestation redacted exécutée sur le writer a confirmé :

- le minuteur L7 s'exécutait avec succès ;
- le marqueur JSON local était valide et frais ;
- la route Caddy persistée était encore la forme historique `legacy_no_header` ;
- l'attestation HTTPS stricte a échoué et le déployeur a restauré Caddy.

Aucun Cloudflare/DNS, Hostinger, promotion, fencing, téléphonie ou failover automatique n'est impliqué dans ce correctif.

## Cause prise en compte

Le contrat précédent dépendait de `header Content-Type application/json` dans un bloc `handle`. Un problème Caddy documenté pour Caddy v2.11.2 montre que l'adaptateur peut supprimer silencieusement ce gestionnaire `header` lorsque des blocs `handle` sont présents, même si `caddy validate` réussit.

Le serveur de fichiers Caddy s'appuie sur l'extension de fichier pour inférer le type MIME lorsqu'il sert un fichier statique. Le marqueur doit donc être servi sous le nom interne `lemtel-lb-ready.json`, tout en gardant l'URL publique exacte `/lemtel-lb-ready`.

## Contrat cible

```caddyfile
@lemtel_load_balancer_ready path /lemtel-lb-ready
handle @lemtel_load_balancer_ready {
  root * /etc/caddy
  rewrite * /lemtel-lb-ready.json
  file_server
}
```

Le rafraîchisseur écrit uniquement le JSON minimal dans `lemtel-lb-ready.json`. En cas d'échec local, il supprime à la fois ce fichier et l'ancien marqueur sans extension. L'absence du fichier doit rester un 404 définitif.

Le déployeur conserve son verrou, sa sauvegarde Caddy, sa validation, son rollback et l'attestation externe stricte : HTTP 200, `Content-Type: application/json`, schéma JSON exact et fraîcheur. Une valeur ambiguë ou un type MIME inattendu restaure la configuration précédente et laisse le failover automatique désactivé.

## Sources

- https://github.com/caddyserver/caddy/issues/7598
- https://caddyserver.com/docs/caddyfile/directives/header
- https://github.com/caddyserver/caddy/issues/3190
