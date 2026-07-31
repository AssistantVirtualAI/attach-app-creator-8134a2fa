# Changelog — Lemtel Softphone

## [2.5.0] — 2026-07-31

### Améliorations visuelles majeures
- **Thème clair haute visibilité** : L'application passe au thème `light` par défaut pour une meilleure lisibilité. Les utilisateurs peuvent toujours changer de thème dans les paramètres.
- **TitleBar** : Logo Lemtel affiché à côté du titre "Lemtel Softphone". Bannière "SIP enregistré" supprimée (n'apparaît plus qu'en cas d'erreur). Caption "Ready to dial" retirée.
- **Pied de page** : Logo AVA ajouté dans un pied de page compact.
- **Page Chats** : Redessinée en cartes thématisées — couleurs via tokens du thème au lieu du panneau sombre hardcodé. Timestamps relatifs, indicateurs de statut en ligne, sidebar améliorée.
- **Audit couleurs** : ~50 composants migrés vers les tokens CSS du thème (`c.*`). Textes noirs hardcodés sur fond doré corrigés dans ProfileMenu, MessagesView, QueuesView.
- **Skeletons** : Shimmer animé remplace tous les "Loading…" textuels dans ~16 vues.
- **Toast d'appel entrant** : Animation slide-in + barre de progression + pause au survol.
- **Clavier** : Touches glass avec halo cyan au survol.
- **LeftRail** : Onglet actif plus marqué, badge doré pulsé.

### Corrections
- `ProfileMenu.tsx` : Correction de l'erreur TypeScript `SyncBadge` (clé `idle` retirée du `Record`).
- `CallsView.tsx` : `organizationId` null-coalescé (`orgId ?? ''`).
- `RecordingsView.tsx` : Cast `rec as any` pour les appels API de lecture audio.
- `useRealtimeRefresh.ts` : Directive `@ts-expect-error` → `@ts-ignore`.
- `electron.d.ts` : `saveCredentials` accepte `null` (déconnexion propre).
- `vite-env.d.ts` : Créé — `import.meta.env.DEV` résolu correctement.

### Enregistrement des appels
- `jssipProvider.ts` : Le champ `callUuid` est extrait du header SIP `X-Call-UUID` lors du `confirmed`.
- `useSoftphone.ts` : `toggleRecording` est maintenant async — envoie le DTMF `*2` ET appelle `fusionpbx-proxy` avec `start-record`/`stop-record` pour déclencher `uuid_record` directement sur FreeSWITCH.

## [2.4.3] — 2026-07-28
- Version précédente.
