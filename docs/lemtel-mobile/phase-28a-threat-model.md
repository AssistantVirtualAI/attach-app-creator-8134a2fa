# Lemtel — Phase 28A : modèle de menace

## Menace

Un membre ou un administrateur d'une organisation reçoit sur son téléphone une notification concernant une autre extension.

## Mitigation

- Filtre Realtime exact `extension=eq.<ext>` sur les deux seuls canaux (CDR, boîtes vocales).
- Vérification défensive de l'extension de chaque charge avant notification.
- Aucun canal sans extension; aucun repli organisation.
- Suppression des abonnements SMS et enregistrements, non filtrables par extension.

## Données protégées

Numéro et nom de l'appelant, existence d'une boîte vocale, contenu des SMS, existence d'un enregistrement.

## Limitation assumée

Pas de notification locale SMS ni d'enregistrement tant que la source ne fournit pas un lien vérifiable à l'extension.

## Aucune garantie mensongère

Le filtrage client ne remplace pas les autorisations serveur. Ces autorisations et les essais sur appareil restent à valider séparément.
