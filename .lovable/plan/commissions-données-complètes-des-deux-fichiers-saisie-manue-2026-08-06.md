# Commissions — données complètes des deux fichiers + saisie manuelle admin

## Ce qui manque aujourd'hui (vérifié dans la base)

Les deux tableaux de bord sont chargés (Ryan La Haye : 66 lignes, Jean-Eric Gagnon : 53 lignes), mais certaines colonnes des fichiers n'ont pas été reprises :

- **Commission par type — Jean-Eric** : la colonne « PY Commission » (base 87 884 $, bonus 9 486 $, bonus2 362 $, perform 16 491 $) est à 0 dans la base.
- **Club Excellence** : Ryan est stocké en texte (« $295 903 260 »), Jean-Eric en chiffres. Les deux doivent être numériques pour être comparables et graphables.
- **Comparaison équipe (Ryan)** : volume/deals/commission d'équipe stockés en texte, donc non exploitables en graphique.
- **Étiquettes incohérentes** : les termes sont « 5 yr / Open/Var (0) » chez Jean-Eric et « 5 / 0 » chez Ryan, dans `term_mix` et dans la matrice. Le filtre « Terme » ne peut donc pas s'appliquer aux deux courtiers en même temps.
- **KPI manquant chez Jean-Eric** : « Commission moyenne / dossier » (présent chez Ryan) — sera calculé (commission / dossiers).
- Les colonnes réellement absentes des fichiers (ex. commission par prêteur chez Jean-Eric, PY par prêteur chez Ryan) resteront vides — elles pourront être remplies via la saisie manuelle.

## Corrections de données

- Compléter les commissions PY par type pour Jean-Eric.
- Convertir Club Excellence et Comparaison équipe en valeurs numériques (volume, dossiers, commission, part %), en gardant le libellé « Meilleur mois » en texte.
- Normaliser les termes en un référentiel unique : `0`, `1`, `2`, `3`, `4`, `5`, `Other`, avec affichage « 0 an (ouvert/variable) », « 5 ans », etc.
- Ajouter le KPI commission moyenne/dossier pour Jean-Eric.
- Après correction, un contrôle de bouclage : mix produit, mix terme, matrice et trimestres doivent tous totaliser le volume KPI de chaque courtier.

## Saisie manuelle (Marc et Gilles)

Marc Alexandre Maglieri et Gilles Bouillon ont déjà le rôle admin Planiprêt, donc la règle d'accès existante « admin = accès complet » leur donne déjà l'écriture. Ce qui manque, c'est l'interface.

Sur `/planipret/admin/commissions`, en mode admin uniquement :

- Bouton **Ajouter une donnée** : formulaire avec courtier (liste ou nouveau nom), année fiscale, section (KPI, prêteur, trimestre, type de commission, mix produit, mix terme, matrice, Club Excellence, équipe), dimension, sous-dimension, puis **toutes les valeurs** : volume CY/PY, dossiers CY/PY, commission CY/PY, plus les champs annexes (%, YoY, rang, note).
- Chaque ligne des tableaux devient éditable : icône crayon → même formulaire pré-rempli ; icône corbeille → suppression avec confirmation.
- Saisie rapide en ligne dans les tableaux (double-clic sur une cellule chiffrée) pour corriger un montant sans ouvrir le formulaire.
- Chaque enregistrement marque la ligne comme « saisie manuelle » avec l'auteur et la date, affiché par un badge dans les tableaux, pour distinguer les données importées des données saisies.
- Les courtiers gardent une vue en lecture seule : aucun bouton d'édition dans le portail courtier.

## Détails techniques

- Migration : ajouter à `planipret_commission_stats` les colonnes `entry_source` (`import` / `manual`), `updated_by`, `updated_at` (trigger) ; politique d'écriture admin explicite (insert/update/delete) déjà couverte par `pcs_admin_all`, à confirmer pour les trois commandes ; garder la lecture courtier limitée à ses lignes.
- Corrections de données via l'outil d'insertion (mises à jour ciblées, pas de réimport complet).
- `src/lib/planipret/commissionStats.ts` : normalisation des termes (`normalizeTerm`), parsing numérique des champs `extra` texte, helpers `upsertCommissionRow` / `deleteCommissionRow`.
- Nouveau `src/components/planipret/commissions/CommissionEntryDialog.tsx` (formulaire complet, validation zod, bilingue FR/EN) et `CommissionRowActions.tsx`.
- `CommissionDashboard.tsx` : prop `editable` activée uniquement pour `scope="admin"`, rafraîchissement optimiste après enregistrement.
