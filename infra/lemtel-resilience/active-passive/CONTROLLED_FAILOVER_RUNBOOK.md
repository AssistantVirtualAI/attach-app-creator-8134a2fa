# Lemtel — runbook de failover contrôlé

> **Statut : drill contrôlé exécuté et validé le 11 octobre 2026.** DigitalOcean est le writer et runtime public temporaire. Hostinger est le former primary fencé et ne doit pas être redémarré comme writer.

## Résultat du drill

Le runbook a été exécuté dans l’ordre prévu avec le même identifiant d’incident :

1. Hostinger a été fencé : le conteneur PostgreSQL writer a été arrêté, son redémarrage automatique bloqué et l’absence de listener PostgreSQL confirmée.
2. DigitalOcean a été promu comme writer PostgreSQL unique ; son état confirme `pg_is_in_recovery=false`.
3. Le runtime Supabase configuré et le Storage indépendant ont été démarrés sur DigitalOcean. PostgreSQL est resté privé, sans port hôte ni listener public.
4. Le record DNS-only Cloudflare de `lemtel.assistantvirtualai.com` a été déplacé manuellement vers DigitalOcean, TTL 120 secondes.
5. HTTPS strict, Auth, Storage, REST et `lemtel-session-bootstrap` ont été validés sur la route canonique. Une vérification sans écriture métier a confirmé le mode PostgreSQL read-write promu.

## Garanties vérifiées

- Un seul writer PostgreSQL est actif : **DigitalOcean**.
- Hostinger est fencé ; son retour comme writer est interdit sans reconstruction/failback contrôlé.
- Le runtime public DO est actif, tandis que PostgreSQL ne possède aucun listener public.
- Le DNS est sur DO uniquement pour ce drill ; il ne s’agit pas d’un basculement automatique.
- Aucun FusionPBX, SIP, WSS, TURN, enregistrement d’appel ou configuration téléphonie n’a été modifié.
- Aucun test d’écriture métier n’a été réalisé pendant le drill.

## Failback requis avant tout redémarrage Hostinger

Le retour vers Hostinger est une **nouvelle** opération approuvée. Il doit suivre ce déroulé :

1. geler les changements applicatifs et déclarer une fenêtre de failback ;
2. reconstruire ou resynchroniser Hostinger comme standby à partir du writer DO ;
3. reprendre la réplication PostgreSQL et Storage dans le bon sens, puis prouver recovery, intégrité et lag ;
4. prévoler le runtime Hostinger sans le transformer en second writer ;
5. fencer DO, promouvoir Hostinger et basculer Cloudflare manuellement après validation ;
6. vérifier les services publics, puis consigner le résultat et les mesures RPO/RTO.

> Ne jamais relancer le conteneur PostgreSQL Hostinger, le timer Storage Hostinger ou le DNS vers Hostinger comme raccourci de failback. Cela pourrait créer deux writers et perdre les modifications reçues sur DigitalOcean.

## Travail restant avant test utilisateur complet

- Tests authentifiés email/mot de passe dans les trois clients : iOS TestFlight 1.1 (5), Android et Desktop v2.5.20.
- Parcours de mot de passe temporaire / personnalisé et de réinitialisation, sans révéler de secret.
- Contraste Dark/Daylight, bilinguisme, Home, Contacts, Chats, navigation et préférences/notifications visuelles.
- Paramètres téléphonie et tests d’appel **seulement** après réception et approbation des détails Kenny/Phil : extension, SIP/WSS, TURN, scénarios, sécurité et procédure de test.
