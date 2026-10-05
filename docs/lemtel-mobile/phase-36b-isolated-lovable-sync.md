# Lemtel — phase 36B : synchronisation Lovable isolée

## Constat vérifié

Le projet Lovable `attach-app-creator` est déjà connecté au dépôt GitHub Lemtel/Planiprêt. Sa branche Git active est actuellement **`Planipret`**. Avec le fonctionnement officiel de Lovable, les modifications réalisées dans l’éditeur et les commits poussés sur la branche active sont synchronisés dans les deux sens.

> Aucune branche n’a été changée par cette phase. Une modification Lovable réalisée maintenant atteindrait donc `Planipret`, ce qui est incompatible avec l’isolement demandé pour Lemtel.

## Flux Lemtel prévu

La synchronisation Lovable reste utile, mais uniquement dans une branche Lemtel dédiée :

```text
Lovable ↔ lemtel/lovable-sync → CI GitHub → pull request → lemtel/integration
                                                     ↓
                                      build immuable unique après merge approuvé
                                                     ↓
                                Hostinger primaire → DigitalOcean même digest
```

- `lemtel/lovable-sync` doit être créée **à partir de `lemtel/integration`**, jamais à partir de `Planipret`;
- Lovable et GitHub restent sur **la même** branche `lemtel/lovable-sync`; la synchronisation est bidirectionnelle dans cette seule branche isolée;
- un changement Lovable ne peut pas atteindre un VPS directement;
- GitHub CI et une PR vers `lemtel/integration` restent obligatoires;
- la livraison automatisée éventuelle ne peut se faire qu’après fusion approuvée, avec un build unique et le même digest pour les deux hôtes.

## Ce qui reste interdit

Le contrat conserve à `false` : changement de branche Lovable, workflow de déploiement, secrets Actions, accès aux cibles, déploiement Hostinger/DO, failover automatique et cutover des clients. Cette phase ne change pas la branche active Lovable, n’active aucune synchronisation nouvelle et ne touche pas Planiprêt.

## Prochaine action externe requise

Après une confirmation séparée, la procédure devra :

1. créer `lemtel/lovable-sync` depuis `lemtel/integration` dans GitHub;
2. choisir cette branche dans **Lovable → Paramètres du projet → Git → GitHub**;
3. vérifier le statut « même commit »;
4. ajouter un workflow GitHub qui crée ou actualise une PR Lemtel, sans déployer.

La bascule de branche est une action de configuration à impact réel : elle est volontairement hors de cette phase et ne doit pas être effectuée sans validation explicite du propriétaire.

## Vérification

```sh
node --test scripts/lemtel-lovable-delivery-contract.test.mjs
```

Ce test est hors ligne; il ne contacte ni Lovable, ni GitHub, ni Hostinger, ni DigitalOcean.
