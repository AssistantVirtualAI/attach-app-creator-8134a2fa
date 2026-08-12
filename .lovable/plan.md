# Commissions Planiprêt — provenance Zoho vérifiable + validation IA (Claude)

## Objectif
Quand l'endpoint Maestro/Zoho des commissions sera branché, chaque montant affiché dans le portail courtier doit être **traçable** : on voit la ligne source, le layout Zoho, le stage, et le nom exact du champ de commission utilisé. Aucun recalcul : le montant est repris tel quel depuis le champ Zoho défini (ex. `Case amount`).

## Règles appliquées
1. **Zéro recalcul.** Le montant revenue provient d'un seul champ Zoho par (layout, stage). On ne dérive, n'additionne ni ne convertit rien au niveau de la ligne.
2. **Provenance obligatoire.** Chaque ligne conserve : `zoho_layout`, `zoho_stage`, `revenue_field` (nom exact du champ), `revenue_raw` (valeur brute), `record_id`, `record_url`.
3. **Ligne non conforme = non dispatchée.** Si le layout/stage ne correspond à aucune règle, ou si le champ attendu est absent/vide, la ligne est marquée `rejected` avec un motif et n'entre pas dans les agrégats.
4. **Claude valide avant dispatch**, il ne produit aucun chiffre.

## Ce qui sera fait

### 1. Table de mapping (layout + stage → champ)
Fichier de config partagé `supabase/functions/_shared/zoho-commission-map.ts` :
- Liste des règles `{ layout, stage, revenueField, volumeField?, dateField }`.
- Résolution stricte (correspondance exacte, insensible à la casse), sinon rejet.
- Valeurs par défaut préremplies avec `Case amount` ; ajustables quand tu confirmeras les layouts/stages exacts.

### 2. Extraction avec traçabilité (`pp-maestro-commissions`)
- Remplacement de la sélection « premier champ trouvé » (`pick`) par la résolution stricte via le mapping.
- Nouvelle sortie `lines[]` : une entrée par dossier avec montant, champ source, layout, stage, date, prêteur, statut `accepted|rejected` + motif.
- Les agrégats existants (KPI, prêteurs, trimestres, mix) sont calculés **uniquement** à partir des lignes `accepted`, en sommant les valeurs brutes non modifiées.
- Bloc `audit` : nombre de lignes reçues / acceptées / rejetées, champs distincts utilisés, layouts et stages rencontrés.

### 3. Validation Claude avant dispatch (`pp-commissions-validate`)
Nouvelle edge function utilisant `claudeText()` de `_shared/anthropic.ts` (jamais de fetch brut) :
- Entrée : l'échantillon des lignes normalisées + le mapping + l'audit (aucune donnée client sensible superflue).
- Sortie JSON stricte : `verdict` (`pass` / `warn` / `block`), anomalies détectées (champ inattendu pour un layout/stage, stage inconnu, montant nul sur dossier financé, doublons de `record_id`, écart entre somme des lignes et total agrégé), et recommandation.
- Le verdict est renvoyé au frontend ; `block` empêche l'affichage des KPI et montre le détail des lignes fautives.

### 4. Affichage de la provenance (portail courtier)
Dans `src/pages/planipret/broker/PBCommissions.tsx` et `src/components/planipret/commissions/` :
- Nouvel onglet **« Provenance »** : tableau des lignes avec colonnes Dossier, Date, Layout Zoho, Stage, Champ utilisé, Montant brut, Montant retenu, Statut.
- Filtres : acceptées / rejetées, par layout, par stage, par champ.
- Bandeau de validation IA en haut (verdict, anomalies, horodatage) avec bouton de revalidation.
- Chaque KPI/graphique affiche une info-bulle « source : champ X, N dossiers » et un lien vers la vue Provenance filtrée.
- Export CSV des lignes de provenance pour vérification manuelle.

## Détails techniques
- Fichiers : `supabase/functions/_shared/zoho-commission-map.ts` (nouveau), `supabase/functions/pp-maestro-commissions/index.ts` (refonte de la normalisation + `lines`/`audit`), `supabase/functions/pp-commissions-validate/index.ts` (nouveau), `src/lib/planipret/commissionStats.ts` (types `CommissionLine`, `CommissionAudit`, appel de validation), `src/components/planipret/commissions/CommissionProvenance.tsx` (nouveau), `CommissionDashboard.tsx` (onglet + bandeau).
- Aucun changement de schéma de base de données ; la source « Données internes » reste inchangée.
- Accès inchangé : le courtier voit ses propres dossiers, l'admin la vue globale.

## À confirmer de ton côté
La liste exacte des couples layout + stage et, pour chacun, le nom exact du champ Zoho de commission. Sans ça, je code le mapping avec `Case amount` par défaut et tout layout/stage inconnu part en `rejected` (visible, jamais silencieux).
