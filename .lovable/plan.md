# Pourquoi la page Courtiers n'affiche qu'un seul courtier

## Ce que disent les données (vérifié)

Le fichier Excel importé (`Dashboard_Courtier_Copie_Complete.xlsx`) ne contient les transactions **que d'un seul courtier** :

- 901 lignes importées, réparties sur 5 feuilles `registre-depots 2022 → 2026`.
- Dans chacune de ces feuilles, et aussi dans la feuille `Broker raw data` (901 lignes), les colonnes `agent_name`, `target_name` et `cabinet` ont **une seule valeur** : `Jean-Eric Gagnon` / cabinet `237873`.
- Les feuilles de synthèse du classeur le confirment : `Broker Monthly` et `Club Excellence Results` ne listent qu'une ligne courtier, `Jean-Eric Gagnon`.
- La base contient exactement ces 901 lignes, avec 1 seul `agent_name`, 1 seul `cabinet`, 1 seul `broker_user_id`. Zéro ligne perdue à l'import.

Donc la page ne « rate » pas des courtiers : la source d'import n'en contient qu'un. Les feuilles agrégées (Broker Dashboard, Monthly Trend, etc.) sont des vues Excel calculées sur ce même courtier, pas des données d'autres courtiers.

La deuxième ligne visible dans l'onglet Courtiers n'a pas encore été identifiée (elle ne peut pas venir du registre, qui n'a qu'un nom). Première étape du plan : l'identifier avant tout changement.

## Plan

1. **Identifier la 2e ligne affichée** dans l'onglet Courtiers (capture de l'objet renvoyé par le moteur de stats) : ligne « Total / Autres », nom vide normalisé, ou entrée provenant d'une autre source. Corriger si c'est une ligne fantôme.

2. **Rendre l'absence de données explicite** : afficher dans l'onglet Courtiers un bandeau indiquant le nombre de courtiers réellement présents dans le registre importé, les cabinets détectés et le fichier/date d'import — pour qu'on voie immédiatement que le classeur ne couvre qu'un courtier.

3. **Préparer l'import multi-courtiers** (le code est déjà prévu pour, mais jamais exercé) :
   - accepter un classeur contenant plusieurs `agent_name` / `cabinet` sans écraser l'existant (mode fusion par courtier + année) ;
   - résolution automatique courtier : `cabinet` → `maestro_broker_id`, puis `target_name` normalisé, puis `agent_name` ;
   - lignes non résolues rangées en « orphelines » avec un écran de mappage manuel (cabinet/nom → profil courtier) et re-dispatch en un clic.

4. **Contrôle après import** : rapport listant par courtier le nombre de lignes, volume, commissions et années couvertes, avec comparaison au total du fichier pour garantir zéro écart.

## Ce qu'il me faut de votre côté

Pour voir plusieurs courtiers dans le portail, il faut un registre de dépôts contenant les lignes des autres courtiers (un classeur global, ou un fichier par courtier). Le classeur actuel est une copie du tableau de bord d'un seul courtier.

## Détails techniques

- Table `planipret_commission_register` : 901 lignes, `agent_name = 'Jean-Eric Gagnon'`, `cabinet = '237873'`, `maestro_broker_id` vide.
- `supabase/functions/pp-commission-stats/index.ts` construit `brokers` à partir des `agent_name` distincts du registre → une seule entrée possible aujourd'hui.
- `supabase/functions/pp-commission-import/index.ts` : ajouter le mode fusion par courtier + table de mappage `planipret_commission_mappings` pour les cabinets inconnus.
- UI : bandeau de couverture dans `RegisterCommissions.tsx` (onglet Courtiers) + écran de mappage dans `PACommissionsImport.tsx`.
