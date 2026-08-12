# Alignement du portail sur la spécification v3 (2026-08-05)

## Point important d'abord

Le fichier envoyé (`Dashboard_Courtier_Prompt-3.csv`) est encore **la spécification de calcul**, pas le classeur de données. Vérification faite : la table du registre contient **0 ligne**. Tant que le vrai classeur (`Broker raw data` / `registre-depots 2022→2026`) n'est pas déposé, les tableaux du portail resteront vides même si toute la logique est correcte.

## Ce qui est déjà conforme à la v3

Le moteur de calcul du portail applique déjà, tel quel :

- **Volume** : lignes `base`, `loan_amt > 0`, dans la fenêtre exacte ; clé unique `numéro + institution + type + montant du prêt`, première ligne dans l'ordre source retenue, somme des montants.
- **Dossiers** : lignes `base` dans la fenêtre, un contrat compté une seule fois, attribué au prêteur/type/terme/courtier de sa première ligne base de la période.
- **Commissions** : somme de tous les montants de la période, tous types confondus (base, bonus, bonus2, perform, ajustements), sans dédoublonnage.
- **BPS / dossier moyen / commission par dossier**, règle YoY (`—` / `New` / pourcentage).
- **Unicité recalculée à chaque fenêtre** — jamais une somme de résultats mensuels.
- Ventilations prêteurs, produits, termes, matrice type × terme, commissions par type, trimestres, Club Excellence (saison août–juillet), réconciliations volume/dossiers.
- Schéma de la table registre couvrant l'intégralité des champs A:S de la spécification.

## Écarts à combler (v3)

1. **Club Excellence** : la v3 demande **quatre blocs mensuels de saison** ; le portail n'expose que la saison courante et la précédente → ajouter les saisons N-2 et N-3 avec leurs comparatifs.
2. **Contrôles MATCH / MISMATCH** : ajouter la vérification croisée « Volume et Dossiers par courtier » vs « par prêteur » (aujourd'hui seule la réconciliation globale existe) et l'afficher dans le bandeau de réconciliation.
3. **Notes de calcul** : afficher dans la vue « Stats par période » les notes exigées (clé de volume, clé de dossier, traitement des tranches de prêt, réinitialisation dans chaque période).
4. **Réconciliation trimestres → cumul annuel** : n'appliquer le contrôle qu'aux trimestres complets inclus dans la fenêtre sélectionnée.
5. **Scan d'anomalies** : signaler dans le rapport d'import les lignes à date invalide, montant non numérique ou type de commission inconnu.

## Ingestion du classeur réel

Quand le classeur sera déposé dans **Portail admin → Commissions → Import registre** :

- lecture de chaque onglet `registre-depots AAAA` (ou de l'onglet `Broker raw data`), mappage explicite des colonnes A:S, conservation de l'ordre source d'origine ;
- rattachement des courtiers en cascade (alias → Maestro ID → nom normalisé → courriel), prénom / nom / Maestro ID stockés sur chaque ligne ;
- rapport de revalidation : totaux volume / dossiers / commissions par année et par courtier, lignes non rattachées à corriger en un clic ;
- dispatch automatique vers chaque portail courtier, filtres année / semaine / mois / trimestre / cumul annuel.

## Détails techniques

- `supabase/functions/_shared/commission-engine.ts` : ajout des fenêtres de saison N-2/N-3 et d'un utilitaire de contrôle croisé.
- `supabase/functions/pp-commission-stats/index.ts` : exposition des blocs de saison supplémentaires, du contrôle MATCH/MISMATCH et de la réconciliation trimestrielle bornée.
- `supabase/functions/pp-commission-import/index.ts` : scan d'anomalies (dates, montants, types) dans le rapport de validation.
- `src/components/planipret/commissions/RegisterCommissions.tsx` + `CommissionValidationPanel.tsx` : affichage des notes de calcul, des badges MATCH/MISMATCH et des saisons supplémentaires.

Aucune modification du moteur de calcul lui-même : la logique v3 est déjà celle en production.
