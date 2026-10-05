# Lemtel — phase 37B : garde de livraison automatique vers deux VPS

## Objectif confirmé

L’objectif de livraison est : une modification **Lemtel validée** produit une fois un artefact immuable, puis ce même artefact est livré au primaire Hostinger et au secours DigitalOcean. Les deux destinations doivent valider leur santé avant que la livraison soit considérée réussie.

Cette phase ne change aucun portail ni application existante. Elle ne recrée rien. Elle ajoute le garde GitHub nécessaire pour que l’automatisation ne puisse pas être activée ou partiellement déployée avant que les deux VPS soient réellement prêts.

## Flux cible

```text
Modification Lemtel intégrée
        ↓
CI et tests
        ↓
Build unique + digest immuable
        ↓
Hostinger primaire : livraison + healthcheck
        ↓
DigitalOcean secours : même digest + healthcheck
        ↓
Preuve de deux destinations identiques
```

L’unité initiale préparée est le paquet des deux fonctions Edge Lemtel. Le portail et les binaires Desktop/iOS/Android nécessiteront leurs propres unités de build et de livraison : un VPS ne met pas à jour automatiquement une application déjà installée depuis l’App Store ou Google Play.

## Ce que la garde vérifie maintenant

Le workflow `Lemtel delivery — two VPS gate` s’exécute sur les changements Lemtel intégrés. Il affirme que la livraison reste bloquée tant que :

- les identités de déploiement restreintes ne sont pas créées pour les deux VPS;
- la pile Lemtel équivalente et ses healthchecks ne sont pas vérifiés sur DigitalOcean;
- les sauvegardes chiffrées hors serveur et la restauration testée ne sont pas prouvées;
- le digest unique ne peut pas être vérifié sur les deux cibles;
- les secrets GitHub Environments ne sont pas configurés et l’activation explicite n’est pas donnée;
- le failover et le failback externes ne sont pas testés.

Le workflow ne contient ni SSH, ni clé, ni secret, ni copie, ni commande Docker sur un VPS. Il est une barrière vérifiée, pas encore le déployeur.

## État de l’automatisation

| Élément | État |
|---|---|
| Contrat d’artefact unique | Préparé |
| Garde GitHub automatique | Active, mais bloque volontairement |
| Déploiement Hostinger | Non autorisé dans ce workflow |
| Déploiement DigitalOcean | Non autorisé dans ce workflow |
| Sauvegarde automatisée/restore DigitalOcean | Non confirmé |
| Failover automatique | Non implémenté |
| Cutover des clients | Non autorisé |

## Prochaine activation réelle

Après la préparation équivalente du VPS DigitalOcean et l’approbation explicite, une phase séparée pourra ajouter des identités SSH limitées par environnement GitHub, créer le paquet exact une seule fois, effectuer les deux livraisons avec digest identique, puis refuser tout déploiement si une sonde échoue.

## Vérification

```sh
node --test scripts/lemtel-two-vps-delivery-gate.test.mjs
```

Le validateur est hors ligne. Il ne contacte pas Hostinger, DigitalOcean, GitHub, Lovable ou les applications.
