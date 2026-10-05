# Lemtel — phase 33B : dispositions des fonctions bloquées

## Résultat de la revue

La baseline 33A identifie dix fonctions candidates bloquées par des signaux de frontière. Une revue statique structurée répartit ces candidates ainsi :

| Disposition provisoire | Nombre | Sens |
|---|---:|---|
| `manual_boundary_trace_required` | 4 | La capacité mêle des parcours ou dépendances qu’il faut cartographier avant d’envisager une frontière Lemtel-only. |
| `reimplement_new_lemtel_service` | 4 | La capacité peut faire l’objet d’une conception neuve Lemtel, avec des contrats et contrôles propres. |
| `exclude_pending_replacement` | 2 | La capacité reste exclue jusqu’à ce qu’un remplacement Lemtel autonome soit approuvé. |

Le registre versionné se compare à la baseline courante : une fonction bloquée manquante, ajoutée, dupliquée ou marquée avec une disposition inconnue rend le registre invalide.

```sh
node scripts/lemtel-blocked-function-dispositions.mjs
```

## Limites strictes

Ce contrôle retourne toujours le code `78` et `authorization: false`. Il n’autorise jamais :

- l’implémentation, le déploiement ou l’activation d’une fonction ;
- un import de données, de comptes, de secrets, de paquets ou d’objets Storage ;
- l’utilisation des clés du nouveau projet par les clients ;
- un changement PBX, une bascule DNS, une action DigitalOcean ou un cutover utilisateur.

## Suite de travail

Les quatre capacités réimplémentables demandent d’abord un contrat Lemtel-only : responsable, rôles, séparation d’organisation, règles de conservation, journalisation, validation synthétique et rollback. Les quatre frontières à tracer demandent une cartographie d’appels/effets avant toute conception. Les deux exclusions restent désactivées dans le nouveau backend jusqu’à une décision d’architecture distincte.
