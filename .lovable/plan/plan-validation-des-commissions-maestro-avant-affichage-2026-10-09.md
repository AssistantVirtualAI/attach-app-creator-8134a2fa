# Plan — validation des commissions Maestro avant affichage

## Résultat attendu
Deux flux restent strictement séparés :

```text
Maestro déboursées  → calcul déterministe → contrôle Claude → publication portail/app
Maestro en attente  → calcul déterministe → contrôle Claude → publication portail/app
```

Aucun montant incomplet, mélangé ou non rapproché ne sera présenté comme valide. Une erreur conservera la dernière version validée avec un état clair, jamais un faux 0 $.

## Référence Sandra confirmée
Le PDF Maestro joint, généré le 9 octobre 2026 à 14:12, indique pour les commissions en attente :
- Base : **179 887,26 $**
- Prêts : **48 869 798,42 $**

La capture confirme aussi les catégories Base, Bonus, Bonus 2, Performance, Outrepasser et Tiers. Ces chiffres serviront de cas de rapprochement, sans être figés dans l’application.

## Mise en œuvre
1. **Verrouiller les deux sources**
   - Déboursées : endpoint historique `deposits`, avec ses quatre catégories payées et toutes les pages.
   - En attente : endpoint `pending-commissions`, avec ses lignes et ses totaux officiels par catégorie.
   - Ajouter une identité de source, période, courtier et horodatage à chaque résultat pour empêcher tout croisement.

2. **Rapprochement fiable par le code**
   - Calculer en cents, sans arrondis intermédiaires.
   - Vérifier pagination complète, catégories attendues, doublons, dates, courtier, dossiers, prêts, commissions et sous-totaux.
   - Déboursées : conserver la logique actuelle des contrats uniques pour les unités et de chaque financement positif pour le volume.
   - En attente : comparer la somme des catégories officielles au total officiel, tout en gardant séparée la somme des dossiers ventilés.
   - Produire un rapport structuré `MATCH`, `WARNING` ou `BLOCKED` avec les écarts exacts.

3. **Contrôle Claude à la sortie de chaque flux**
   - Étendre le validateur Claude existant pour recevoir le type de source, les règles applicables, les agrégats, les contrôles déterministes et un échantillon borné des lignes sans secrets.
   - Claude expliquera les incohérences et classera les anomalies; il ne modifiera, n’inventera et ne recalculera jamais un montant.
   - Le code restera l’autorité arithmétique. Un résultat déterministe invalide ou une anomalie critique Claude bloquera la nouvelle version avant affichage.

4. **Publication atomique des résultats validés**
   - Enregistrer séparément la dernière version validée des déboursées et celle des commissions en attente.
   - Ne remplacer une version affichée que lorsque le flux complet est validé.
   - En cas d’échec Maestro ou Claude, conserver la dernière version validée et afficher sa date ainsi que l’état du contrôle.

5. **Portail et application**
   - Alimenter les vues administrateur et courtier uniquement avec le résultat validé correspondant à leur portée serveur.
   - Afficher un badge de rapprochement et permettre aux administrateurs de consulter les écarts; les courtiers voient leurs montants validés seulement.
   - Garder les deux arbres web identiques. Ne modifier aucun code natif iOS/Android.

6. **Vérification avant publication coordonnée**
   - Ajouter des tests interdisant le mélange des endpoints, les totaux partiels, les erreurs transformées en 0 $, les changements de courtier et les publications non validées.
   - Tester le PDF Sandra : Base 179 887,26 $ et prêts 48 869 798,42 $.
   - Rapprocher également les déboursées Sandra; l’écart actuel de 501,86 $ doit être expliqué ou bloqué.
   - Vérifier les vues admin et courtier du portail et de l’application, puis publier ensemble seulement quand tous les contrôles passent.

## Détails techniques
- Réutiliser le client Claude serveur existant et ne jamais envoyer de jeton Maestro, secret, courriel ou nom de client.
- Limiter Claude à un JSON strict et validé; journaliser seulement les identifiants techniques et écarts non sensibles.
- Ne pas laisser Claude filtrer directement les données : ses décisions sont appliquées par des règles serveur explicites et auditables.
- Aucun déploiement partiel : fonctions, portail et application web seront livrés dans une seule publication coordonnée après validation complète.
