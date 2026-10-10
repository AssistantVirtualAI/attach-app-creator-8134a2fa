# Vérification des commissions — écart Etienne Gilbert (167,77 $) et audit des répartitions

## Objectif
Trouver la cause exacte de l'écart de 167,77 $ sur les commissions en attente d'Etienne Gilbert, puis revérifier que les montants déboursés et en attente de tous les courtiers sont exacts et que la répartition personnel / équipe est correcte partout.

## Étapes

1. **Diagnostiquer l'écart d'Etienne (en attente)**
   - Relire ses lignes en attente directement depuis Maestro et comparer au cent avec ce que le serveur calcule.
   - Vérifier les trois causes possibles déjà identifiées dans le code :
     - la déduplication par `commission_id` qui pourrait écarter une ligne légitime portant le même identifiant ;
     - la limite de pagination (25 pages × 8 passages) qui pourrait tronquer sa liste ;
     - une ligne sans `primary_broker_id` comptée comme « personnel » au lieu d'équipe.
   - Ne corriger qu'après avoir identifié la cause exacte du 167,77 $ — jamais forcer le chiffre.

2. **Audit de la répartition pour tous les courtiers**
   - Pour chaque courtier connecté : comparer le total serveur au total officiel Maestro, séparément pour déboursées et en attente.
   - Vérifier que personnel + équipe = total, et que chaque membre d'équipe est rattaché au bon courtier (via `primary_broker_id`, jamais par déduction).
   - Vérifier qu'aucune ligne n'est comptée deux fois ni sautée (pagination bornée, déduplication).

3. **Correction côté serveur uniquement**
   - Tout correctif se fait dans les fonctions serveur (rapports de commissions) — portail et app mobile lisent la même source, donc les deux sont corrigés en même temps.
   - Un échec de lecture ne devient jamais 0 $.

4. **Rapport final**
   - Tableau par courtier : déboursées, en attente, écart avant/après, répartition personnel/équipe.
   - Confirmation explicite pour Etienne Gilbert et Sandra Allard.

## Détails techniques
- Code concerné : `supabase/functions/planipret-commission-reports/index.ts` (récupération paginée des lignes en attente, déduplication par `commission_id`, répartition `split()` par `primary_broker_id`) et `supabase/functions/_shared/commission-reports.ts`.
- Etienne Gilbert : `maestro_broker_id` 203097.
- La table `planipret_commission_reconciliation` ne couvre que les déboursées ; l'écart signalé est sur les en attente, qui n'ont pas de réconciliation enregistrée — l'audit se fera en lecture directe.
- Aucune modification iOS/Android, aucun déploiement partiel, aucun secret exposé.
