# Activation du publisher de ressources du writer DO

Cette opération est distincte du déploiement du schéma et de l’ingress. Elle vise uniquement le writer DigitalOcean et les six mesures redacted suivantes : pourcentage CPU, mémoire, disque et charges 1/5/15 minutes. Elle ne produit ni trafic, ni capacité, ni identifiant de machine, ni donnée client.

## Préconditions strictes

Le package attesté exige un snapshot chiffré frais du writer, l’identité explicite `digitalocean_writer`, la revue du package et des sources dont les empreintes sont incluses dans le manifeste. Il refuse une configuration, une unité systemd, un timer, un fichier secret ou une variable Edge déjà présents. L’ingress Edge installé doit correspondre exactement à l’empreinte attendue.

## Transaction

Le déployeur crée une valeur HMAC aléatoire uniquement en mémoire, puis écrit deux fichiers nouveaux root-only `0600` : la configuration locale du publisher et l’input Compose Edge. L’unique service Edge est recréé sans dépendances après validation de Compose. Le publisher effectue d’abord une publication smoke-test redacted ; seulement après succès, le timer systemd borné à deux minutes est activé.

Tout échec désactive le timer, retire uniquement les objets créés par cette transaction, recrée Edge sans la variable ajoutée et retourne une attestation redacted. Aucune lecture ou impression de secret n’est autorisée.

## Hors périmètre

Le package ne contacte pas Hostinger, ne crée pas d’enrollment ni de publisher standby, ne modifie pas Caddy, Cloudflare, DNS, téléphonie, FusionPBX, promotion, fencing ou bascule automatique. Son succès ne prouve pas la préparation HA et ne l’active pas.
