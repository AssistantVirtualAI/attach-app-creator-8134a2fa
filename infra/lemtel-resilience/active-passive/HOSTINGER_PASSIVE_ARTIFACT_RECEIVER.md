# Lemtel — récepteur passif d’artefacts Hostinger

## But

Le récepteur dépose les archives Lemtel produites par GitHub sur le standby Hostinger. Il sert à conserver une copie **exacte et vérifiée** de chaque artefact immuable destiné à Lemtel.

## Frontière de sécurité

- une clé GitHub dédiée est limitée par une commande SSH forcée ;
- seule la forme `receive <sha256>` est acceptée ;
- le contenu reçu est vérifié contre le SHA-256 annoncé avant son déplacement atomique ;
- le compte est le receiver déjà restreint `lemtelstorage` ;
- les artefacts GitHub reçus sont conservés sous `/home/lemtelstorage/github-artifacts`, séparés des enveloppes de runtime root-only ;
- aucun artefact reçu n’est appliqué au runtime.

Le bootstrap n’effectue aucune action sur les conteneurs, PostgreSQL, Storage applicatif, ports publics, DNS, FusionPBX/SIP ou promotion.

## Activation contrôlée

Après avoir créé une paire de clés GitHub dédiée, déposer uniquement la clé publique sur Hostinger et exécuter comme root :

```bash
LEMTEL_HA_EXECUTE=bootstrap_hostinger_passive_artifact_receiver \
LEMTEL_HA_ROLE=hostinger_standby \
LEMTEL_HA_ARTIFACT_DEPLOY_PUBLIC_KEY_FILE=/chemin/vers/cle.pub \
bash lemtel-ha-hostinger-passive-artifact-receiver-bootstrap.sh
```

La clé privée correspondante est stockée uniquement dans les secrets de l’environnement GitHub protégé. Les variables `LEMTEL_HOSTINGER_HOST`, `LEMTEL_HOSTINGER_DEPLOY_KEY` et `LEMTEL_HOSTINGER_KNOWN_HOSTS` doivent alors désigner ce standby.

## Remédiation de l’ancien récepteur

Une ancienne installation peut avoir utilisé le répertoire des enveloppes root-only. Cette collision doit être corrigée **sans changer la clé SSH ni les enveloppes existantes**. Le script `lemtel-ha-hostinger-passive-artifact-receiver-isolation-remediate.sh` ne procède que si l’ancien programme forcé, l’autorisation SSH et le répertoire d’enveloppes ont la forme et les permissions attendues. Il crée le répertoire GitHub séparé et remplace uniquement le programme de réception forcé. Toute ambiguïté échoue avant mutation.

Il ne faut jamais rendre le répertoire des enveloppes de runtime accessible au compte `lemtelstorage` pour résoudre un refus de permission.

## Vérification

Un dépôt GitHub doit afficher `artifact_receiver_status=stored`. Le répertoire d’artefacts ne constitue pas un runtime lancé : une validation de release distincte reste obligatoire avant toute application sur le writer actif.
