# Phase 42B — Contrat bootstrap SIP, TURN et push Lemtel

Cette phase définit les trois futurs émetteurs Lemtel (`lemtel-softphone-bootstrap`, `lemtel-turn-credentials`, `lemtel-mobile-register-push`) sans les implémenter ni les déployer. Tous restent bloqués.

## Garanties

- Auth + membership Lemtel actif sont obligatoires pour chaque route future.
- Organisation, utilisateur, extension et installation sont imposés par le serveur; ils ne viennent pas du client.
- Aucun secret SIP, secret TURN, credential PBX admin, clé de service Supabase, APNs ou FCM ne peut être inclus dans le contrat, une réponse, Git ou le client.
- Les relay credentials TURN devront être courts, liés au compte et demandés à l’appel, jamais stockés comme mot de passe statique.
- La phase ne modifie pas FusionPBX et ne permet aucun changement d’origine client ou flag de build.

## Informations de recette requises

Kenny ou Phil doivent fournir une extension de test attribuée, le WSS/SIP de test, la politique TURN (hôte, ports, authentification et durée), puis la matrice de tests d’appels. L’activation push iOS/Android exige en plus le plan PushKit/CallKit/FCM et des appareils physiques.
