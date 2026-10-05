# Phase 38B — Préparation inactive de livraison GitHub Lemtel

## But

Cette phase formalise le futur pipeline **GitHub → Hostinger primaire → artefact identique en secours DigitalOcean**, sans créer de secret GitHub, sans environnement GitHub, sans build de release, sans écriture VPS et sans déploiement.

> La préparation d’un pipeline ne change ni Lovable, ni les applications installées, ni le runtime Hostinger/DO.

## Contrat fail-closed

- Contrat : `infra/lemtel-delivery/github-release-readiness.json`
- Validateur : `scripts/lemtel-github-release-readiness.mjs`
- Tests : `scripts/lemtel-github-release-readiness.test.mjs`
- CI : `lemtel-github-release-readiness.yml`

Le validateur retourne `78` et un statut bloqué. Toute tentative de rendre le projet Lovable actuel éligible, de sélectionner `Planipret`, de configurer un environnement, d’autoriser un build, de synchroniser le secours ou d’écrire vers un VPS invalide le contrat.

## Modèle cible, à activer uniquement après décision explicite

```text
Projet Lovable Lemtel distinct (ultérieur) ↔ branche Lemtel isolée
                                                 ↓ pull request + CI
                                      lemtel/integration approuvée
                                                 ↓ build unique
                         SHA Git + SHA-256 artefact + SBOM CycloneDX + provenance SLSA
                                                 ↓
                  validation privée/puis publique Hostinger primaire
                                                 ↓ même artefact, jamais reconstruit
                    cache/validation standby DigitalOcean (pas de runtime implicite)
```

| Élément | Règle verrouillée | Activation future requise |
| --- | --- | --- |
| Source | `lemtel/integration` seulement; `Planipret` rejeté | PR CI validée depuis une branche Lemtel dédiée. |
| Lovable | Le projet actuel n’est pas éligible pour Lemtel | Créer un projet Lovable Lemtel séparé ou déplacer explicitement le projet actuel; la seconde option contredit la conservation de Planipret. |
| Artefact | Un build unique, hash Git et SHA-256; SBOM CycloneDX; provenance SLSA | Choisir les outils de build et valider les artefacts sans code source map public. |
| GitHub Environments | Noms réservés : `lemtel-hostinger-primary`, `lemtel-digitalocean-standby` | Créer les environnements protégés, les reviewers et les secrets réels; seuls les **noms** des secrets apparaissent dans le contrat. |
| Primaire | Santé obligatoire avant toute étape standby | Identité SSH restreinte, snapshot/backup frais, healthchecks et autorisation d’écriture. |
| Standby | Même artefact; jamais de reconstruction sur DO | Autorisation d’une synchronisation de cache, validation du hash, et respect du cold-standby privé. |

## Secrets prévus — noms uniquement

Le contrat réserve les noms suivants et ne contient aucune valeur :

- `LEMTEL_HOSTINGER_DEPLOY_KEY`
- `LEMTEL_HOSTINGER_KNOWN_HOSTS`
- `LEMTEL_DIGITALOCEAN_DEPLOY_KEY`
- `LEMTEL_DIGITALOCEAN_KNOWN_HOSTS`

Les secrets devront être injectés seulement dans des GitHub Environments protégés et après approbation distincte. Ils ne doivent jamais être placés dans le dépôt, Lovable, une issue, une PR, les journaux CI ou un appareil client.

## Blocage Lovable actuel

Le projet Lovable connecté aujourd’hui reste volontairement sur `Planipret`. Un changement fait dans ce projet peut uniquement continuer à suivre cette branche : il ne peut pas être livré vers Lemtel sans risque de contamination. Pour obtenir ultérieurement « Lovable → Lemtel automatique », le chemin recommandé est un **deuxième projet Lovable Lemtel** relié à une branche Lemtel dédiée et intégrée par PR.

## Hors portée

Cette phase ne déploie pas les fonctions Edge Lemtel, ne démarre pas le standby, n’ouvre aucun port, ne change pas DNS, ne crée pas d’environnement GitHub, ne configure pas de secret, ne migre pas de données et ne touche ni Planipret ni FusionPBX.
