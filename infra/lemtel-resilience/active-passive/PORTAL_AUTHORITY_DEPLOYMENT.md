# Lemtel — déploiement transactionnel du portail autoritaire

> **Statut : package source seulement.** Le script ne s’exécute que sur le writer DigitalOcean après une approbation de fenêtre d’écriture ciblée et l’attestation d’une sauvegarde fraîche.

## Objet

`lemtel-ha-do-writer-portal-authority-deploy.sh` applique la migration Lemtel `0008_lemtel_organization_domains.sql`, met à jour l’Edge Function `lemtel-onboarding-admin`, puis remplace le bundle statique déjà routé sous `/lemtel-portal/`.

Le script vérifie le rôle writer, les digests de chaque fichier, les conteneurs et le montage de fichiers avant toute écriture. Il sauvegarde et annule automatiquement les fichiers du portail et de la fonction si une étape ultérieure échoue. La migration additive est exécutée dans sa propre transaction SQL; en cas d’échec SQL, aucun fichier runtime n’est remplacé.

## Interdictions

Le package ne change pas DNS, Cloudflare, le standby, un rôle PostgreSQL, une promotion, une bascule, un fournisseur de téléphonie, SIP/WSS/TURN, ni des secrets.

## Contenu attendu du bundle sur le writer

- `manifest.sha256`
- `portal.tar` (racine contenant `lemtel-portal.html` et `assets/`)
- `0008_lemtel_organization_domains.sql`
- `lemtel-onboarding-admin.index.ts`
- `lemtel-ha-do-writer-portal-authority-deploy.sh`

## Validation après déploiement

1. La route `/lemtel-portal/` charge le bundle et n’utilise que `VITE_LEMTEL_*`.
2. Une session administrateur de plateforme peut lister/créer une organisation et ajouter un domaine `unverified`; aucune action DNS n’est déclenchée.
3. Un administrateur d’organisation ne voit que sa propre organisation; un utilisateur non-admin est refusé.
4. Mobile et Desktop exécutent `lemtel-session-bootstrap` après connexion et refusent l’accès si l’adhésion est suspendue ou absente.
5. Communications reste `Non provisionné` jusqu’à l’activation téléphonie contrôlée.
