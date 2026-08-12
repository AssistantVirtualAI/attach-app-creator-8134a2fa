# Commissions Maestro — provenance + analyse IA (Claude)

Objectif : quand l'endpoint Maestro des commissions sera branché, l'IA lit les données **telles que renvoyées par Maestro**, les analyse, et le portail broker affiche la provenance exacte de chaque montant — sans aucun recalcul.

## Principes

1. **Aucun recalcul.** Le montant affiché est exactement la valeur du champ Maestro sélectionné. Pas de somme dérivée, pas de conversion, pas d'estimation.
2. **Sélection déterministe.** Pour chaque ligne, le champ de revenu est choisi selon les critères Maestro (type de dossier + statut/étape). La règle appliquée est enregistrée sur la ligne.
3. **Traçabilité.** Chaque ligne porte : critères utilisés, nom exact du champ source, valeur brute, identifiant du dossier Maestro.
4. **IA en lecture seule.** Claude analyse et valide, il ne modifie jamais un montant.

## Ce qui sera construit

### 1. Extraction avec provenance (`pp-maestro-commissions`)
Chaque ligne renvoyée par la fonction gagne un bloc `provenance` :
- `maestro_record_id`
- `criteria` : les critères Maestro évalués (type de dossier, étape/statut)
- `revenue_field` : le nom exact du champ Maestro retenu
- `revenue_raw` : la valeur brute non transformée
- `rule_matched` : oui/non — si aucune règle ne correspond, la ligne est marquée `unmapped` et exclue des totaux plutôt que devinée.

Un résumé d'audit accompagne la réponse : nombre de lignes mappées, non mappées, champs utilisés et leur fréquence.

### 2. Validation IA (`pp-commissions-validate`)
Nouvelle fonction Edge qui envoie à Claude le jeu de données Maestro brut + les lignes extraites, et lui demande de :
- confirmer que chaque montant correspond bien à la valeur brute du champ déclaré (aucun recalcul détecté),
- signaler les lignes non mappées, les doublons, les champs manquants ou incohérents,
- résumer ce qu'il observe en langage clair (FR/EN selon la langue du portail).

Sortie structurée : statut global (`ok` / `warnings` / `blocked`), liste d'anomalies avec l'identifiant de dossier concerné, et un résumé.

### 3. Analyse IA des données (existant, étendu)
Les insights Claude déjà présents sur la page Commissions consomment désormais les données validées et mentionnent explicitement la source des montants dans leur narration.

### 4. Affichage dans le portail broker
Page Commissions :
- Un onglet **Provenance** : tableau ligne par ligne avec dossier, critères Maestro, champ source, valeur brute, statut (mappé / non mappé).
- Une bannière de validation IA en haut : statut, nombre d'anomalies, bouton pour dérouler le détail.
- Les lignes non mappées apparaissent clairement séparées, jamais fondues dans les totaux.

## Détails techniques

- Table de correspondance centralisée dans `supabase/functions/_shared/maestro-commission-map.ts`, éditable sans toucher au reste.
- La fonction de validation utilise Claude via la passerelle IA (streaming, réponse structurée).
- Le cache d'insights 24 h reste en place; la validation, elle, se rejoue à chaque synchronisation Maestro.
- Aucun changement de schéma côté base : la provenance voyage dans le champ `extra` déjà existant des lignes de commission.

## À confirmer avant l'implémentation

Les couples exacts (type de dossier / étape) → champ de revenu Maestro, dès que le endpoint est disponible. En attendant, la table de correspondance sera vide et toute ligne sera marquée `unmapped` plutôt que devinée.
