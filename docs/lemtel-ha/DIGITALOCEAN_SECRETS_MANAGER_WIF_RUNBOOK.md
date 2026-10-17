# Lemtel — DigitalOcean Secrets Manager et fédération WIF

> **Statut : préparation source-only.** Ce document ne crée aucun secret, coffre, proxy App Platform, OAuth App, Droplet, tag, route, compte, rôle, service, timer, migration, runtime, publisher, Cloudflare/DNS, promotion, fencing, routage ou failover.

## Décision de sécurité

Le signer de plateforme requis par l’enrôlement des nœuds ne peut pas être utilisé depuis le crédential systemd local actuel : le système a signalé que sa clé de chiffrement locale n’est pas située sur un support chiffré. Le crédential local déjà créé reste inactif et ne doit pas être lu comme une autorisation d’enrôlement, de publication ou de failover.

DigitalOcean Secrets Manager apporte un stockage de valeurs masquées et versionnées, mais sa lecture documentée par `doctl` repose sur un jeton API. Un jeton persistant sur le writer ne satisfait pas la décision « identité de charge de travail, pas de secret persistant sur le writer ».

La fédération DigitalOcean publiée est un **PoC OAuth/WIF** distinct : proxy App Platform, OAuth App confidentielle, politiques RBAC, jetons courts et Droplets créés avec un tag `oidc-sub:`. Ce n’est ni une identité native greffable au writer existant, ni une activation de failover.

## État attesté au 16 octobre 2026

| Contrôle | État | Conséquence |
|---|---|---|
| API Secrets Manager avec le connecteur en cours | `403` | aucune création ou lecture de coffre |
| UI Secrets Manager dans la session navigateur | indisponible/redirigée | aucune création par interface |
| Tag `oidc-sub:` sur le writer existant | absent | le writer existant ne peut pas consommer le PoC WIF tel que documenté |
| Proxy App Platform WIF | absent | aucun échange de jeton court |
| OAuth App WIF | absente | aucun client OAuth ni consentement |
| Coffre DO Lemtel | absent | aucune clé de signer stockée chez DO |
| Signature, enrôlement, publisher, HA | désactivés | fail-closed |

## Architecture cible, sans valeur secrète

```text
writer DO avec identité WIF courte
  → proxy WIF DO avec RBAC strict
    → Secrets Manager DO : signer de plateforme
      → réponse de signature limitée au flux d’enrôlement
        → config chiffrée/signée vers les nœuds
```

La configuration de la publication exige en plus : la clé publique épinglée hors bande root-only sur les nœuds, le chemin API HTTPS exact, le slot approuvé en base, le statut L7 JSON frais et le désarmement du chemin HMAC historique. Aucun de ces éléments n’est remplacé par un coffre.

## Préconditions de provisionnement ultérieur

1. L’équipe DO doit autoriser l’API `security/secrets` au connecteur choisi ; une erreur `403` bloque avant toute écriture.
2. Le coût et le cycle de vie d’App Platform doivent être explicitement validés par le propriétaire avant provisionnement.
3. Le proxy WIF doit recevoir une OAuth App confidentielle dédiée, ses variables chiffrées dans App Platform et des scopes minimaux.
4. Les rôles doivent restreindre le writer à un jeton court de lecture **d’un seul** secret de signature, sans action Droplet, DNS, Cloudflare, PostgreSQL ou Hostinger.
5. La migration vers un writer avec identité WIF doit être conçue avec snapshot, rollback, unicité du writer et validation de réplication ; elle est séparée et non autorisée par ce document.
6. Le signer doit accepter uniquement le transcript canonique de remise d’enrôlement, avec limites de taille/délai, audit redacted et refus par défaut.
7. Une revue indépendante doit confirmer qu’aucun token long-lived ne traverse un fichier, une variable, un argument CLI, un log, un gist ou le portail.

## Ordre de mise en œuvre ultérieur

1. Attester l’autorisation Secrets Manager par lecture de conteneurs sans révéler de valeurs.
2. Créer le coffre vide, puis créer la clé de signature dans le coffre sans la rendre au portail, à une console, à Git, à un fichier ou à un argument.
3. Déployer et autoriser le proxy WIF avec des rôles minimaux ; vérifier que les chemins hors allowlist sont refusés.
4. Construire un nouveau writer éphémère muni de l’identité WIF documentée, sans toucher au writer actuel.
5. Exécuter un drill de migration/failback DB distinct avant tout changement de rôle.
6. Installer le pin public hors bande sur DO et Hostinger, puis accomplir l’enrôlement signé publication-only.
7. Attester les publishers node-status et trafic redacted, sans démarrer le runtime Hostinger.
8. Achever séparément les gates HA : L7 strict, serializer Durable Object, fencing fournisseur, drill destructif, promotion, runtime, routage Cloudflare et retry clients.

## Interdictions permanentes

- Aucun token API long-lived sur le writer ou le standby.
- Aucun secret ou JWK privé dans le dépôt, un manifest, une archive, un gist, une commande, une variable d’environnement durable, le navigateur, le portail ou les logs.
- Aucun déploiement ou migration directe depuis Git.
- Aucun `FAILOVER_MODE=active`, publisher, timer, service, promotion, runtime Hostinger, Load Balancer, pool, DNS, routage ou failback automatique sans les preuves et drills requis.
- Aucun changement Planipret, Avastatistic, PBX/legacy Lemtel, FusionPBX ou téléphonie.

## Sources externes vérifiées

- [DigitalOcean Secrets Manager — doctl](https://docs.digitalocean.com/reference/doctl/reference/secrets/)
- [Création de conteneur Secrets Manager](https://docs.digitalocean.com/reference/doctl/reference/secrets/create/)
- [Lecture de conteneur Secrets Manager](https://docs.digitalocean.com/reference/doctl/reference/secrets/get/)
- [Déploiement du PoC WIF DigitalOcean](https://www.digitalocean.com/community/tutorials/oauth-workload-identity-federation-digitalocean-droplets-part2)
- [Usage du PoC WIF DigitalOcean](https://www.digitalocean.com/community/tutorials/oauth-workload-identity-federation-digitalocean-droplets-part3)
