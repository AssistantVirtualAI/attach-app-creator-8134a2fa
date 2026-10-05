# Lemtel — phase 36A : contrat de livraison Lovable → GitHub → Hostinger/DO

## Décision de flux

**GitHub est l’unique source de vérité.** Les changements réalisés dans Lovable doivent être synchronisés vers une pull request GitHub; ils ne doivent jamais être copiés directement depuis Lovable vers un VPS. Après revue et CI, une future livraison construira **une seule fois** un artefact identifié par le SHA Git et le digest de conteneur.

L’ordre de promotion visé est immuable :

1. Hostinger primaire reçoit l’artefact et doit réussir sa santé applicative;
2. DigitalOcean secours reçoit **le même digest**, sans reconstruction indépendante, puis valide sa santé;
3. le secours reste sans trafic normal tant que le mécanisme de réplication et de bascule n’est pas testé.

Ce modèle évite deux dépôts ou deux builds divergents. Il ne s’agit pas d’une synchronisation bidirectionnelle : Lovable alimente GitHub, GitHub orchestre les livraisons, et les serveurs ne réécrivent jamais le dépôt.

## Ce qui est préparé par cette phase

Le contrat versionné sous `infra/lemtel-delivery/contract.json` et son validateur imposent notamment :

- aucune livraison directe de Lovable vers Hostinger ou DigitalOcean;
- un build unique avec identité immuable et contrôle de digest au secours;
- Hostinger avant DigitalOcean;
- snapshot frais, CI, identité de déploiement limitée et santé avant promotion;
- workflow de livraison, secrets, accès aux cibles, failover et cutover client tous à `false` à ce stade.

## Ce qui n’est pas encore actif

Aucun workflow GitHub ne se connecte encore à Hostinger ou DigitalOcean. Les prérequis restant avant activation sont :

- créer une identité de déploiement **non-root**, limitée, différente sur chaque VPS;
- ajouter les secrets exclusivement dans les environnements GitHub Actions, jamais dans le dépôt ou Lovable;
- configurer et vérifier le même runtime sur le secours, les sauvegardes chiffrées hors serveur, la restauration et la supervision externe;
- créer une passerelle de routage externe avec contrôles de santé, puis tester failover et failback;
- déployer et tester les contrats backend Lemtel, créer des comptes neufs et obtenir les nouvelles valeurs de build;
- faire les tests physiques Desktop/iOS/Android puis une approbation distincte du cutover client.

Ainsi, une mise à jour Lovable pourra plus tard être propagée automatiquement et de manière traçable, sans que la mise à jour d’un client, la publication DNS ou la bascule DigitalOcean soient déclenchées par erreur.

## Vérification

```sh
node --test scripts/lemtel-lovable-delivery-contract.test.mjs
```

Le test reste hors ligne : il ne lit aucun secret et ne contacte ni Lovable, ni GitHub, ni Hostinger, ni DigitalOcean.
