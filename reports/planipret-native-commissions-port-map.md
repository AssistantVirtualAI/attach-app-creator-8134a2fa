# Planiprêt — carte de port natif des Commissions

Ce document décrit le transfert prévu vers la source native Planiprêt. Rien n'est copié ni déployé. Le bundle mobile partagé iOS/Android vit dans `apps/planipret-mobile/src`. Le contrôle `src/test/commissionParity.test.ts` garde ces fichiers identiques octet par octet à ceux du portail.

## Contrats serveur

- **`planipret-commission-reports`** : rapports officiels Maestro, séparés en deux sources.
  - Les **déboursées** viennent des dépôts historiques (`summary`, `deposits`, `paid_analytics`).
  - Les **en attente** viennent de l'endpoint pending.
  - Portée : un courtier ne voit que lui-même (ou son équipe). Les lectures admin ou globales exigent un jeton entreprise Maestro officiel.
  - Les totaux sont officiels. Dossiers et volume : seulement les lignes Base, contrat unique.
- **`pp-commission-stats`** : registre analytique.
  - Il regroupe par `brokerId(row)` : `user:<broker_user_id>`, puis `maestro:<id>`, sinon `unlinked:<clé>`.
  - Chaque courtier retourné contient `brokerKey` et `linked`.
  - Le drill-down se fait **seulement** par `detailBrokerKey`, validé par `resolveDetailBrokerKey`. Une clé non rattachée ou un nom affiché donne `detail = null`.

## Carte

| Surface Lovable | Surface native Planiprêt cible | Endpoint/contrat | Adaptation nécessaire |
|---|---|---|---|
| `src/pages/planipret/mobile/MCommissions.tsx` (copie identique dans l'app) | Onglet Commissions du bundle mobile | `planipret-commission-reports` (paid + pending), registre via `RegisterCommissions` → `pp-commission-stats` | Aucune pour le bundle partagé. Le natif charge la même web view. Les panneaux paid et pending gardent des filtres indépendants. |
| `src/components/planipret/mobile/MCommissionCharts.tsx` | Écran « Graphiques par courtier » (mobile) | `planipret-commission-reports` (année courante + même fenêtre N-1), via `ppEdgeInvoke` | Aucune. Utilise le cache `commissionsCache`. Ne lit jamais d'autres courtiers. |
| `src/pages/planipret/admin/PACommissions.tsx` | Portail web seulement (pas d'écran natif) | `planipret-commission-reports` via `CommissionSections` | Pas de port natif. Le mobile l'atteint par `MCommissions` (mêmes sections). |
| `src/pages/planipret/admin/PACommissionsMonthly.tsx` | Portail web seulement | `pp-commission-stats` | Pas de port natif. Pour un équivalent mobile, réutiliser `RegisterCommissions` (onglet mensuel) au lieu d'une nouvelle vue. |
| `supabase/functions/planipret-commission-reports` | Serveur (partagé) | Voir ci-dessus | Aucun changement natif. Non redéployé dans ce lot. |
| `supabase/functions/pp-commission-stats` | Serveur (partagé) | `detailBrokerKey`, `brokerKey`, `linked` | **Doit être déployé avant** que le bundle contenant les composants ci-dessous parte en production. Sinon `brokerKey` est absent et les clics de drill-down sont ignorés. |
| `BrokerLeaderboard.tsx` | Registre → onglet Courtiers (mobile et portail) | `pp-commission-stats.brokers` | Identique. La clé React et le clic utilisent `brokerKey`. Une ligne non rattachée n'est pas cliquable. |
| `BrokerTopSellers.tsx` | Registre → Top vendeurs | `pp-commission-stats.brokerYearly` | Identique. Le podium et les barres transmettent `brokerKey`. |
| `BrokerYearMatrix.tsx` | Registre → Matrice annuelle | `pp-commission-stats.brokerYearly` | Identique. Badge « non rattaché » selon `linked === false`. |
| `ClubExcellencePanel.tsx` | Registre → Club Excellence | `pp-commission-stats.club` | Identique. Clic admin seulement, par `brokerKey`. |
| `RegisterCommissions.tsx` | Section « Analyse détaillée » des déboursées (mobile) et page registre (portail) | `pp-commission-stats` (`detailBrokerKey`) + Realtime `pp-commissions-live-*` | Identique. Une souscription par montage, retirée au démontage. |

## Résumé des sources

- **Utilisent encore `planipret-commission-reports`** : `MCommissions` (cartes paid et pending), `MCommissionCharts`, `PACommissions`, `PABrokerCommissions`, `CommissionHomeCard`, `PaidDepositsCard`, `PendingCommissionsCard`.
- **Exigent `pp-commission-stats`** : `RegisterCommissions` et ses enfants (`BrokerLeaderboard`, `BrokerTopSellers`, `BrokerYearMatrix`, `ClubExcellencePanel`, `BrokerDrilldown`), et `PACommissionsMonthly`.

## Même visuel iOS/Android sans casser les vues actuelles

1. Garder les fichiers listés dans `commissionParity.test.ts` identiques entre `src/` et `apps/planipret-mobile/src/`. Copier, ne pas réécrire.
2. Déployer `pp-commission-stats` (champ `brokerKey`) **avant** de publier le bundle. Les anciens bundles continuent de fonctionner, car le serveur accepte encore `detailAgent`, traité comme une clé.
3. Aucun changement natif (Swift/Kotlin, CallKit, FCM, SIP) n'est requis. Tout est dans le bundle web partagé.
4. Valider avec `npx vitest run` (racine et app), `tsc --noEmit` et `PP_SKIP_AUTOSYNC=1 npm run build` dans `apps/planipret-mobile`.

## Limitations

- Les vues cabinet en production restent non testées tant qu'un jeton entreprise Maestro officiel n'est pas disponible.
- Rien n'a été vérifié sur un appareil physique.
