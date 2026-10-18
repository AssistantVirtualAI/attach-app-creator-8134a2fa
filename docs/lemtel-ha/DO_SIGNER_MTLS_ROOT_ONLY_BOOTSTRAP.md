# Lemtel — bootstrap local root-only mTLS du relais DO

> **Statut : source-only, non autorisé au déploiement.** Ce document décrit un bootstrap local strictement limité aux deux sources de credentials déjà attendues par le relais mTLS. Il ne constitue ni une activation du relais, ni une admission de la cible DO, ni une autorisation Cloudflare.

## Frontière et prérequis

`lemtel-ha-do-writer-signer-mtls-relay-root-only-bootstrap.sh` est réservé à l’hôte Lemtel portant exactement le rôle `digitalocean_writer` et à root. Il refuse les arguments et ne poursuit la génération qu’après présentation du token d’exécution exact défini dans le source. Le token n’est jamais affiché.

Le script crée uniquement les répertoires locaux fixes nécessaires aux credentials, au certificat CA public requis par Cloudflare Access et à l’attestation. Tout répertoire, fichier existant ou lien symbolique inattendu est refusé. Les deux sorties consommées ultérieurement par l’unité existante restent les seules entrées finales du répertoire de credentials :

| Sortie | Mode requis | Contenu autorisé |
|---|---:|---|
| Répertoire de credentials | `0700` | Les deux sources leaf ci-dessous, et rien d’autre |
| `client-cert.pem.cred` | `0600` | Credential systemd chiffré du certificat client leaf |
| `client-key.pem.cred` | `0600` | Credential systemd chiffré de la clé privée client leaf |
| `/etc/lemtel-platform-signer/cloudflare-access-root-ca.pem` | `0644`, `root:root`, fichier régulier | Le seul certificat CA **public** à conserver pour l’import Access revu séparément |

Les sources `.cred` sont créées localement avec `systemd-creds` sous les noms de credentials déjà chargés par le template systemd. Le bootstrap ne déchiffre pas une source existante et refuse de l’écraser.

## Matériel créé et nettoyage

Après le token explicite, le script produit dans un répertoire temporaire root-only :

1. une CA racine éphémère EC ;
2. une clé client EC **P-256** et un certificat client signé avec le CN fixe `lemtel-do-signer-mtls-relay` ;
3. les deux credentials chiffrés leaf destinés au relais.

La clé privée de CA est supprimée dès la signature du leaf, avant l’écriture des sorties, et n’est jamais persistée. Seul son certificat public est conservé au chemin déterministe ci-dessus, après contrôle `root:root`, fichier régulier et mode `0644`. La CSR, la configuration d’extensions, les clés/certificats leaf en clair et tous les autres fichiers temporaires sont supprimés avant le statut de succès. Un échec déclenche le rollback des liens de sortie créés par cette invocation, **y compris le nouveau certificat CA public**, puis le nettoyage du temporaire. La suppression logique ne doit pas être présentée comme une preuve d’effacement physique sur un support de stockage donné.

La destruction délibérée de cette clé signifie que le leaf produit est un artefact de bootstrap éphémère : il ne peut être ni tourné ni révoqué par le script sous ce même émetteur. Il est donc interdit comme credential d’un relais actif. Une CA importée hors bande dans Cloudflare Access, même si elle est associée au hostname dédié, ne contourne pas ce blocker. Le cycle de vie durable exige un émetteur approuvé séparément, un rapprochement d’empreinte DER et des drills de rotation/révocation, selon `MTLS_CLIENT_CERTIFICATE_LIFECYCLE.md`.

## Attestation publique et diagnostic

L’attestation locale publique est écrite séparément avec le mode `0644`. Elle contient seulement :

- le format d’attestation ;
- les empreintes SHA-256 DER du certificat CA public et du certificat leaf ;
- le chemin fixe, le mode `0644` et l’ownership root du certificat CA public, ainsi que l’assertion de sa persistance ;
- le CN leaf fixe ;
- des assertions indiquant que la clé privée CA n’est ni incluse ni persistée, que les clés leaf ne sont pas incluses et que les sources root-only ont été écrites.

Elle ne contient aucun PEM, clé privée, token, identifiant d’infrastructure, adresse ou secret. Le mode diagnostic est aussi root-only et token-gated. Il lit seulement cette attestation publique et les métadonnées des deux sources ainsi que du certificat CA : il retourne les deux empreintes et des états booléens, **sans lire ni afficher le PEM** du certificat CA et sans afficher ou lire le contenu d’un credential.

Ce diagnostic ne prouve pas qu’une politique Access accepte le certificat, que le service est installé, ni que la source chiffrée peut être chargée à l’exécution. Il ne remplace pas les gates indépendants de chiffrement-at-rest, rotation/révocation, isolation du socket et revue de sécurité.

## Non-actions garanties

Le bootstrap et le diagnostic n’ouvrent aucun réseau et n’appellent aucun fournisseur, DigitalOcean API, Cloudflare ou DNS. Ils n’uploadent jamais la CA. Ils ne rechargent, n’activent, ne démarrent ni n’arrêtent un service ou timer; ils ne créent ni configuration de relais, socket, route, runtime, promotion, fencing, failover, failback ou téléphonie.

Ils restent limités à Lemtel. Planipret, AVAstatistic, PBX, données legacy, FusionPBX et les données métier sont hors périmètre.

## Validation hors infrastructure

Les tests Node associés copient le script dans un `tempdir`, substituent uniquement ses chemins fixes de test et simulent l’identité root, `openssl`, `systemd-creds` et un échec contrôlé de lien. Ils ne produisent donc aucune vraie clé ni certificat. Ils contrôlent l’absence de persistance de clé CA privée, le cycle de vie du seul certificat CA public (`root:root`, `0644`, fichier régulier) et son rollback après un échec tardif, les permissions, les liens symboliques, le nettoyage, l’absence de contenu sensible au stdout/stderr, le diagnostic sans lecture PEM et l’absence de surface de réseau ou d’activation.
