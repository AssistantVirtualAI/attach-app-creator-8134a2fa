# Phase 40A — Garde de cutover Desktop / iOS / Android Lemtel

## État actuel, sans ambiguïté

Les applications installées **restent sur leur backend historique**. Cette phase ne modifie ni leur origine Supabase, ni leur clé publique, ni leurs paramètres SIP/WSS/TURN, ni leurs builds. Elle interdit aussi toute utilisation de `Planipret` ou du projet Lovable actuel comme source de livraison Lemtel.

> Un backend Hostinger sain, un backup Restic ou un cold standby DO ne suffisent pas à basculer une application client.

## Contrat offline

- Contrat : `infra/lemtel-client-cutover/client-cutover-gate.json`
- Validateur : `scripts/lemtel-client-cutover-gate.mjs`
- Tests : `scripts/lemtel-client-cutover-gate.test.mjs`
- CI : `lemtel-client-cutover-gate.yml`

Tous les champs d’autorisation restent à `false`. Le validateur retourne le code `78` et refuse une valeur positive, une clé manquante ou une clé inconnue. Il n’a pas de capacité réseau, de secret, de build, de signature, de publication, d’écriture de configuration ou de déploiement.

## Conditions de bascule, dans l’ordre

| Étape | Preuves minimales | Pourquoi elle bloque le cutover aujourd’hui |
| --- | --- | --- |
| Backend | HTTPS/Auth, Storage, Realtime et Functions Lemtel validés; sauvegarde/restauration fraîche; schéma Lemtel-only | Les nouvelles fonctions Edge et la migration annuaire sont sources-only et non déployées. |
| Identité | Comptes Auth de test Lemtel, organisations et RBAC validés | Les applications actuelles n’utilisent pas encore la nouvelle identité Lemtel. |
| Configuration build | Origine HTTPS et clé publique dans le système de build privé, sans secret dans Git/Lovable/app | Aucun build client Lemtel n’est autorisé. |
| Téléphonie | Environnement de test SIP/WSS/TURN, extensions et scénarios validés avec Kenny/Phil | Ringotel-like incoming behavior exige PushKit/CallKit/FCM/lifecycle et tests physiques séparés. |
| Appareils | Desktop, iPhone et Android physiques : connexion, appel entrant/sortant, média/NAT, enregistrements/autorité serveur, déconnexion/reconnexion | Les tests unitaires et CI ne remplacent pas ces tests. |
| Retour arrière | Builds historiques et procédure de rollback prêts | Un changement d’origine Auth peut forcer une nouvelle session; le rollback doit être prouvé. |
| Livraison | Projet Lovable Lemtel séparé, GitHub environments protégés, artefact immuable, rollout par étapes | Le projet Lovable actuel reste volontairement sur Planipret. |

## Séquence future, seulement après autorisation séparée

1. Appliquer et valider les migrations/fonctions Lemtel sur un environnement de test, avec sauvegarde et restauration confirmées.
2. Installer les valeurs de build privées dans les environnements de CI protégés, pas dans les sources ni l’UI Lovable.
3. Construire des versions de test Desktop, iOS et Android depuis l’artefact Lemtel approuvé.
4. Faire la recette physique et téléphonie avec comptes/extensions de test.
5. Vérifier les flux d’autorité d’enregistrements, WSS et contacts sans aucune dépendance Planiprêt.
6. Préparer les builds rollback, puis demander une autorisation de rollout échelonné distincte.
7. Soumettre aux stores ou diffuser aux utilisateurs uniquement après réussite de l’étape précédente et autorisation explicite.

## Hors portée

Cette phase ne soumet aucune application à Apple/Google, ne signe pas de build, ne change pas de secret, ne crée pas de projet Lovable, ne configure pas GitHub Actions, ne lance aucun conteneur, ne modifie pas DNS/FusionPBX et n’active pas le failover DigitalOcean.
