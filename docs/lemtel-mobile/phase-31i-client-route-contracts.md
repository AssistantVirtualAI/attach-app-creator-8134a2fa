# Lemtel — phase 31I : revue des appels calculés et contrats de route client

**État : tests hors réseau, aucun changement de destination ni mise en service.** La politique d’admission reste `denied` / `offline_only`; Hostinger demeure le primaire visé et DigitalOcean le secours prévu, non opérationnel.

## Conclusion de la revue 31H

Sept fichiers clients signalés ont été examinés individuellement : `mobileSupabase.ts`, `AIAuditScreen.tsx`, `AIAuditPanel.tsx`, `CallsView.tsx`, `useLemtelDesktopClientConfig.ts`, `avaApi.ts` et `config.ts`. Dans ces fichiers, les chemins `/functions/v1/<fonction>` et `/rest/v1/<table>` sont des **contrats Edge/PostgREST réellement utilisés**, ou des helpers qui les construisent à partir de l’origine backend centrale. Les noms calculés examinés proviennent de constantes ou d’un choix borné entre fonctions. Aucun routage Planiprêt ou basculement arbitraire d’origine n’a été constaté **dans ce périmètre**; cela ne clôt pas les dépendances SQL, Auth, Storage, fonctions transitives, ou les autres appelants des helpers. Remplacer ces chemins à l’aveugle casserait le client sans établir une pile Lemtel autonome.

## Régression ajoutée

Des tests à `fetch` entièrement simulé vérifient que :

- Desktop construit `softphone-credentials` sous l’unique origine configurée, transmet la clé publique et le jeton de session, et rejette une erreur HTTP; `avaApi` résout `/fn/` vers Edge et `/db/` vers PostgREST **sur cette même origine**.
- Mobile conserve cette origine pour `restGet`, `restPost` et `edgeCall`, avec la même clé publique; un appel Edge sans session ne réutilise pas de Bearer précédent.
- Les suites existantes de `backendOrigin` continuent à refuser une origine HTTP, non nue ou une nouvelle origine sans clé publishable distincte. Le mode historique par défaut reste inchangé; aucune valeur de production Hostinger ou DigitalOcean n’est introduite dans les builds.

**Validation locale :** typage Desktop et mobile réussis; suites complètes Desktop **173/173**, mobile **242 réussis, 3 ignorés**. Les appels réseau et identifiants de tests sont synthétiques. La CI de PR doit confirmer séparément ces résultats.

## Reste bloqué

Ces tests ne prouvent ni la disponibilité des routes sur Hostinger, ni la présence d’Auth/DB/Storage/Functions/Realtime Lemtel isolés, ni TLS fonctionnel, ni une bascule DO. Revoir les appelants des helpers génériques et la frontière SQL/Planiprêt, valider les fonctions sur une pile isolée, fournir un accès de diagnostic système pour HTTPS, puis obtenir une admission opérationnelle distincte avant tout déploiement ou changement de clients. Aucun DNS, Planiprêt, FusionPBX réel, migration ou VPS n’a été modifié par cette phase.
