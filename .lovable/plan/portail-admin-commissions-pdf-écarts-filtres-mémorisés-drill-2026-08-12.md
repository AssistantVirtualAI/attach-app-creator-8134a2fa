# Portail Admin — Commissions : PDF, écarts, filtres mémorisés, drill-down

Portée : uniquement le portail Admin (`/planipret/admin` → page Commissions). Le portail broker n'est pas modifié.

## 1. Bouton « Rapport PDF »

Un bouton dans la barre de filtres génère un PDF récapitulatif de la période sélectionnée :

- En-tête : période, fenêtre de dates (début → fin), filtre courtier appliqué, date de génération.
- Bloc KPI : volume, dossiers, commissions, dossier moyen, BPS, commission/dossier, avec variations N-1.
- Tableau du classement des courtiers (nom, prénom, Maestro ID, volume, dossiers, commission, BPS, YoY).
- Tableau prêteurs et mix produits/termes.
- Contrôles de réconciliation (MATCH / MISMATCH) et notes de calcul.
- Résumé des insights IA s'ils sont déjà chargés (aucun appel IA déclenché par le PDF).

Généré côté client avec `jspdf` (déjà installé), nom de fichier `commissions-<annee>-<periode>[-<courtier>].pdf`.

## 2. Tableau d'écarts (valeur source vs montant affiché)

Nouvel onglet « Écarts » côté admin listant chaque ligne dont la valeur brute source ne correspond pas au montant affiché :

| Colonne | Contenu |
| --- | --- |
| Dossier / contrat | numéro de contrat |
| Courtier | nom résolu |
| Source | Maestro ou Registre |
| Champ exact | ex. `Case amount`, `amount`, `loan_amt` |
| Valeur brute | valeur telle que lue dans la source, sans transformation |
| Montant affiché | valeur utilisée dans les KPI |
| Écart | différence chiffrée |
| Statut | OK / ÉCART / NON MAPPÉ |

Deux origines de comparaison :
- Source Maestro : provenance déjà retournée par `pp-maestro-commissions` (champ retenu, valeur brute, règle appliquée, `unmapped`).
- Source Registre : comparaison de la valeur brute importée avec le montant retenu par le moteur de calcul.

Un compteur d'écarts s'affiche dans l'en-tête ; les lignes non mappées sont mises en évidence.

## 3. Mémorisation des filtres

Les filtres admin (courtier, année, granularité, index de période, onglet actif) sont enregistrés dans le navigateur (`localStorage`, clé dédiée admin) et restaurés à la réouverture de la page. Un bouton « Réinitialiser » remet les valeurs par défaut (année courante, cumul annuel, tous les courtiers).

## 4. Drill-down par courtier

Un clic sur une ligne du classement ouvre un panneau latéral détaillé pour ce courtier, sur la période sélectionnée :

- Résumé KPI du courtier.
- Commissions par type (financement, renouvellement, bonus, etc.) avec volume, dossiers et montant.
- Liste des dossiers : date, contrat, institution, type de prêt, montant du prêt, commission, type.
- Colonne provenance par ligne : source, champ exact utilisé, valeur brute, statut de correspondance.
- Filtre rapide par type de commission et export CSV du détail.

## Détails techniques

- `supabase/functions/pp-commission-stats/index.ts` : ajout d'un bloc `discrepancies` (comparaison valeur brute / montant retenu) et d'un mode `detail` retournant les lignes d'un courtier avec provenance, borné à la fenêtre déjà résolue par `resolveWindow`. Aucun changement de logique de calcul des KPI.
- Nouveaux composants : `CommissionDiscrepancies.tsx`, `BrokerDrilldown.tsx`, `commissionsPdf.ts` (utilitaire jsPDF), `useAdminCommissionFilters.ts` (persistance).
- `RegisterCommissions.tsx` : nouvel onglet « Écarts », bouton PDF, branchement du drill-down sur `BrokerLeaderboard.onSelect` (aujourd'hui il ne fait que filtrer l'agent — il ouvrira le panneau, le filtre restant accessible séparément), et lecture/écriture des filtres persistés lorsque `scope === "admin"`.
- Aucune modification du portail broker : toutes les nouveautés sont conditionnées à `isAdminView`.
