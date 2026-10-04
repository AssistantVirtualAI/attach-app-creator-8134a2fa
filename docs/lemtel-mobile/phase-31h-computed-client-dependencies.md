# Lemtel — phase 31H : rendre visibles les appels client calculés

**Statut : audit hors ligne et PR empilée; aucun déploiement ni migration.** L’API Lemtel complète n’est pas attestée sur Hostinger et le secours DigitalOcean n’est pas actif. La politique d’admission reste `denied` / `offline_only`.

La fermeture 31C cataloguait les noms de fonctions littéraux, mais ne signalait pas les `.functions.invoke(nomCalculé)` ni les chemins `/functions/v1/${nom}`. L’audit signale maintenant, **par client**, le nombre d’invocations repérées, celles qu’il ne peut attribuer à un nom littéral, le nombre de chemins interpolés, et les seuls chemins de fichiers *relatifs au dépôt* à revoir. Un nom littéral concaténé à une expression ou prolongé par `${...}` n’est plus pris pour un nom fixe. Aucun argument, corps de fonction, secret, identifiant client ou chemin absolu ne figure dans les nouveaux findings. Leur classification reste `manual_review`; il n’y a toujours **ni allowlist de fonctions, ni export de base, ni replay SQL, ni permission de déploiement**.

### Observation statique locale

| Client | Invocations repérées | Invocations non attribuées | Chemins API interpolés | Fichiers à revoir |
| --- | ---: | ---: | ---: | --- |
| Mobile | 5 | 0 | 2 | `src/lib/mobileSupabase.ts`, `src/screens/AIAuditScreen.tsx` |
| Desktop | 66 | 4 | 3 | `src/components/console/AIAuditPanel.tsx`, `src/components/console/CallsView.tsx`, `src/hooks/useLemtelDesktopClientConfig.ts`, `src/lib/avaApi.ts`, `src/lib/config.ts` |

Ces comptes sont des **correspondances lexicales**, pas des appels réellement exécutés ni neuf fonctions distinctes. Des commentaires, chaînes de texte et chemins inactifs peuvent créer des faux positifs; d’autres syntaxes calculées, imports dynamiques, RPC et dépendances SQL restent hors couverture. Le prochain travail doit vérifier les fichiers signalés, attribuer chaque appel nécessaire à une fonction Lemtel propre ou l’exclure, puis construire une baseline Auth/DB/Storage/Functions/Realtime isolée **sans copier Planiprêt**. Aucun changement FusionPBX réel n’est autorisé par cet audit.

**Validation locale :** 25/25 tests des quatre scripts d’hébergement hors ligne; les tests synthétiques couvrent les arguments calculés, préfixes concaténés, URLs interpolées et la non-divulgation. La CI vérifie que les nouveaux chemins restent dans les sources Lemtel et que l’audit conserve son verdict de revue manuelle. Ce travail n’installe rien sur un VPS, ne résout pas le TLS défaillant du domaine et ne met pas en place de bascule automatique.
