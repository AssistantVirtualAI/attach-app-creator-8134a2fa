# Déploiement de gouvernance des tenants Lemtel

> Ce paquet met à jour exclusivement le portail Lemtel et l’Edge Function Lemtel sur le writer DigitalOcean déjà promu. Il ne déploie aucune composante de téléphonie et ne modifie ni Cloudflare/DNS, ni Hostinger, ni le fencing, ni la promotion ou la bascule automatique.

## Contenu vérifié

| Élément | Rôle |
|---|---|
| Artefact portail CI | Interface d’affectation d’un compte Lemtel existant, réactivation et mise à jour `member`/`admin`. |
| `0012_lemtel_membership_governance.sql` | Étend uniquement l’ensemble des actions d’audit Lemtel. Aucun compte Auth, mot de passe, e-mail ou enregistrement métier n’est créé. |
| `lemtel-onboarding-admin` | Applique les contrôles de rôle côté serveur et déclenche la révision d’autorité de compte existante. |

## Préconditions

1. Backup/snapshot chiffré récent du writer vérifié.
2. DigitalOcean est le writer PostgreSQL unique et les conteneurs Caddy/Edge/PostgreSQL sont sains.
3. La route Lemtel existante est exactement détectée ; le déployeur échoue sans modification si elle est ambiguë.
4. Le déclencheur `lemtel_membership_authority_revision_after_change` est présent.

## Garanties et rollback

- Chaque fichier est vérifié par SHA-256 avant utilisation ; seuls les fichiers explicitement listés sont acceptés.
- Les fichiers portail/Edge précédents sont sauvegardés et restaurés automatiquement en cas d’échec après leur remplacement.
- La migration est un DDL atomique et ne touche aucune donnée métier. Si elle échoue, le déploiement s’arrête avant le remplacement des fichiers.
- Aucun écran n’exécute de mutation avant que l’administrateur Lemtel autorisé ne l’initie explicitement ; le déploiement seul ne crée, n’assigne ni ne modifie un utilisateur.

## Résultat attendu

`tenant_governance_deploy_status=complete`, `membership_audit_schema=applied`, `account_authority_revision_trigger=verified`, et tous les indicateurs de sécurité restent `false` (DNS, Hostinger, promotion, failover, fencing, téléphonie).
