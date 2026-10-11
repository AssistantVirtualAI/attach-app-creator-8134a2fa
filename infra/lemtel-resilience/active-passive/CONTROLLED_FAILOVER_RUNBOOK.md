# Lemtel — runbook de failover contrôlé

> **Statut : préparation uniquement.** Ce document ne constitue ni une autorisation de promotion ni une procédure de bascule automatique. Hostinger reste le writer unique tant qu’une approbation explicite de fenêtre de maintenance n’a pas été donnée.

## Objectif et limites

L’architecture est active–passive, avec PostgreSQL en streaming physique asynchrone et Storage répliqué dans le sens Hostinger → DigitalOcean. Une panne du primaire peut donc impliquer une perte de données limitée à ce qui n’a pas encore atteint le standby. Aucun RPO/RTO chiffré ne doit être promis avant un drill contrôlé et mesuré.

Le présent runbook s’applique seulement au backend Lemtel. Il n’autorise aucun changement Planiprêt, FusionPBX/SIP/WSS/TURN, DNS public, listener public PostgreSQL ou Storage, ni redirection client.

## Préconditions obligatoires avant une fenêtre de bascule

1. Une alerte de santé persistante a été confirmée par un opérateur humain, sans se fonder sur un seul signal réseau.
2. Le statut primaire, le dernier lag PostgreSQL connu et l’âge du dernier sync Storage ont été enregistrés dans le journal d’incident.
3. Le prévol root-only du standby indique `standby_in_recovery=true`, `wal_receiver_status=streaming` au dernier état connu, et aucun port PostgreSQL hôte/public.
4. L’équipe a explicitement confirmé la décision de basculer, l’impact attendu et le propriétaire de la fenêtre de maintenance.
5. Le plan de **fencing** du primaire est prêt : `lemtel-ha-primary-fence.sh` rend `supabase-db` non-redémarrable puis l’arrête, enregistre son état root-only et vérifie l’absence de listener PostgreSQL. Il exige ses deux jetons explicites et doit être exécuté avant toute promotion. L’absence de réponse réseau ne suffit pas à prouver qu’il ne peut plus écrire.
6. L’autorité DNS et la procédure de routage sont disponibles et une approbation spécifique de changement DNS est obtenue. À ce stade, aucun accès API DNS n’est configuré pour Lemtel.

## Séquence contrôlée — non exécutée aujourd’hui

1. **Déclarer l’incident** et geler tout déploiement ou modification manuelle côté Hostinger et DO.
2. **Fencer Hostinger** avec `lemtel-ha-primary-fence.sh`, puis enregistrer la preuve de ce fencing. Ne pas supposer qu’un timeout réseau constitue un fencing. Si et seulement si la bascule est abandonnée avant toute promotion et tout DNS cutover, restaurer Hostinger avec `lemtel-ha-primary-fence-abort-before-promotion.sh`; après une promotion, ne jamais redémarrer le primaire comme writer.
3. **Capturer l’état DO** à l’aide de `lemtel-ha-standby-failover-preflight.sh`. Ce script est en lecture seule et n’exécute jamais `pg_promote`.
4. **Obtenir une confirmation explicite** pour une promotion ponctuelle. La promotion sera une action séparée, versionnée et observée ; elle n’est pas automatisée par ce package.
5. **Valider le writer promu** : intégrité, lecture/écriture contrôlée, absence de reprise de Hostinger comme writer, et protection contre un second writer.
6. **Routage DNS contrôlé** seulement après les contrôles précédents. Le changement et son TTL effectif doivent être consignés.
7. **Reprise de service limitée** : aucun runtime Storage/public supplémentaire ni composant de téléphonie ne démarre sans validation de sa propre procédure.

## Failback

Le retour vers Hostinger est une nouvelle opération contrôlée, jamais un simple redémarrage. Il exige la collecte des modifications produites pendant la période DO, la reconstruction ou resynchronisation de l’ancien primaire comme standby, la validation de la réplication, puis une nouvelle fenêtre approuvée pour revenir au rôle primaire.

## Evidence à conserver

| Élément | À enregistrer |
|---|---|
| Santé primaire | Derniers états Health, Auth/HTTPS, réplication et Storage |
| Fencing | Méthode, horodatage, opérateur, preuve que Hostinger ne peut plus écrire |
| Standby | État recovery/WAL receiver avant promotion, absence de port hôte/public |
| Données | Lag PostgreSQL mesuré, âge Storage, éventuel écart observé |
| Routage | TTL, changement DNS, validation d’accessibilité après bascule |
| Reprise | Décision de failback et résultats de resynchronisation |
