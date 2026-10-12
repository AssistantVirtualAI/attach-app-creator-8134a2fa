# Lemtel — parité d’artefact DO / Hostinger

## Règle

Chaque version Lemtel est produite une fois depuis `lemtel/integration`. Le même artefact immuable et son SHA-256 doivent être déposés sur le writer courant et sur le standby, puis leur correspondance doit être vérifiée avant de déclarer le standby apte.

## État actuel

Le workflow GitHub construit déjà un artefact unique et le dépose sur le receiver Hostinger sans appliquer de runtime lorsque DO est le writer promu. Cette livraison reste une préparation : elle ne met pas automatiquement à jour le runtime public DO et ne démarre pas Hostinger.

## Cible

Le contrôleur de release futur doit :

1. attendre la CI et le digest immuable ;
2. appliquer la version approuvée au writer actif ;
3. vérifier HTTPS/Auth/REST/Storage et le digest du writer ;
4. déposer exactement ce digest au standby, sans lui donner le droit d’écrire ;
5. vérifier le digest, la configuration runtime et l’état recovery du standby ;
6. publier un état redacted utilisable par la page Exploitation.

Toute divergence de digest bloque la préparation du standby et la bascule automatique. Un artefact reçu ne signifie pas qu’un runtime a été démarré.

## Limites

La parité de version ne remplace pas la réplication de données. PostgreSQL et Storage doivent être synchronisés par leurs mécanismes dédiés et validés séparément.
