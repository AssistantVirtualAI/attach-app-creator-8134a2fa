
# Plan — Sync appels brokers + build iPhone Planiprêt

## Partie 1 — Synchronisation centralisée transcription + analyse IA

### Objectif
Chaque appel (broker mobile ou admin) est **transcrit + analysé une seule fois** côté serveur, puis diffusé en temps réel à tous les clients (mobile broker + portail admin). Zéro double consommation de tokens Claude / STT.

### Verrou anti-double-traitement
Utiliser les colonnes déjà présentes sur `planipret_phone_calls` :
- `analysis_in_progress` (bool), `analysis_locked_at`, `analysis_locked_by`
- `analyzed_at`, `transcript`, `raw_transcript`, `ai_summary`, `ai_coaching`, `ai_analysis_json`

Règle : toute demande d'analyse passe par `pp-coach-call` qui exécute une **CAS lock** SQL :
```
UPDATE planipret_phone_calls
SET analysis_in_progress = true,
    analysis_locked_at = now(),
    analysis_locked_by = <caller>
WHERE id = :id
  AND analyzed_at IS NULL
  AND (analysis_in_progress = false OR analysis_locked_at < now() - interval '5 min')
RETURNING id;
```
Si aucune ligne retournée → un autre process s'en occupe → renvoyer `{ locked: true }` sans appeler Claude/STT.

### Auto-traitement côté admin (source unique)
Nouveau trigger + edge function :
1. Trigger DB `AFTER INSERT OR UPDATE OF recording_url ON planipret_phone_calls` → appelle (via `pg_net`) l'edge function `pp-auto-process-call` avec `call_id`.
2. `pp-auto-process-call` (nouvelle) :
   - pose le lock (voir ci-dessus)
   - si pas de `raw_transcript` → appelle `pp-ns-recordings` / STT et stocke dans `raw_transcript` + `transcript`
   - appelle Claude via logique de `pp-coach-call` pour produire `ai_summary`, `ai_coaching`, `ai_analysis_json`, `coaching_score`, `lead_score`
   - `analyzed_at = now()`, `analysis_in_progress = false`
   - broadcast `analysis_complete` sur channel `call-analysis` (déjà consommé par `useCallAnalysis`)
3. Le bouton "Analyser" admin et l'appel mobile deviennent des **no-op si `analyzed_at` déjà présent** — ils se contentent de recharger la ligne.

### Diffusion aux brokers (chacun ses appels)
- Le broker mobile utilise déjà `useCallAnalysis` avec `postgres_changes` sur `planipret_phone_calls filter id=eq.<id>`. On garde ça — RLS `planipret_phone_calls` scope déjà par `broker_id`/`organization_id`, donc chaque broker ne voit que ses propres appels.
- Vérifier / ajouter la policy REALTIME (`supabase_realtime` publication) pour `planipret_phone_calls` si absente.
- Sur la liste (`MCalls.tsx` / `RecordingsList.tsx`) : ajouter subscription realtime sur `broker_id=eq.<uid>` pour rafraîchir badges "transcrit / analysé" en direct.

### UI
- `PARecordings.tsx` (admin) : afficher **toujours** `raw_transcript` (déjà fait tour précédent) + badge "Analysé automatiquement le …".
- `MCalls.tsx` (mobile) : afficher `raw_transcript` + `ai_summary` en lecture seule (pas de bouton "Analyser" côté broker — juste "Voir analyse").
- Toast "Analyse en cours…" quand `analysis_in_progress = true`.

### Backfill
Edge function `pp-admin-backfill-calls` (existe) : ajouter un mode qui itère les appels `analyzed_at IS NULL AND recording_url IS NOT NULL` et enfile `pp-auto-process-call` (batché, 5/min).

---

## Partie 2 — App iPhone `apps/planipret-mobile` alignée + push GitHub

### Constat
Le code utilisé pour l'app native vit dans `apps/planipret-mobile/src/pages/planipret/mobile/**`. La logique canonique vit dans `src/pages/planipret/mobile/**` (portail admin). Un script `apps/planipret-mobile/scripts/audit-native.mjs` vérifie la parité fichier-par-fichier.

Fichiers actuellement présents (identiques attendus) :
```
MAvaChat, MAvaNotifications, MCalls, MContacts, MExtensionSync,
MHome, MMessages, MMore, MPipeline, MSearch, MStats, MVoicemail
```

### Étapes
1. **Re-synchroniser la parité** : copier depuis `src/pages/planipret/mobile/**`, `src/components/planipret/mobile/**`, `src/hooks/*` (liste dans `audit-native.mjs`) vers `apps/planipret-mobile/**` et pour toutes les modifs de Partie 1 (ex. `MCalls.tsx`, `useCallAnalysis.ts`).
2. **Faire tourner l'audit** : `cd apps/planipret-mobile && npm run audit:native` — doit passer avant tout build. Corriger les mismatches détectés.
3. **Vérifier `capacitor.config.ts`** : `appId: com.planipret.mobile`, `webDir: dist`, pas de `server.url` de dev pour build TestFlight.
4. **Build web + sync** :
   ```
   cd apps/planipret-mobile
   npm install
   npm run build
   npx cap sync ios
   ```
5. **Xcode readiness** : vérifier `ios/App/App/Info.plist` (permissions micro, réseau, background audio/VoIP), `Podfile.lock` à jour (`pod install`).
6. **Push GitHub** : l'utilisateur fait le push via le bouton GitHub Lovable (Git est géré par la plateforme — je ne peux pas faire `git push`). Une fois poussé, sur son Mac :
   ```
   git pull
   cd apps/planipret-mobile
   npm install && npm run build
   npx cap sync ios
   cd ios/App && pod install
   npx cap open ios
   ```
   Puis dans Xcode : signer avec son Team, choisir son iPhone, Run.

### Points de vigilance TestFlight
- Bundle ID `com.planipret.mobile` doit exister dans Apple Developer (App ID + capabilities Push / VoIP / Background Modes).
- Certificats APNs Planiprêt (secrets `PLANIPRET_APNS_*`) — déjà documentés dans `docs/native-setup.md`.
- Pas d'URL `server.url` dev active dans `capacitor.config.ts` au moment de l'archive.

---

## Détails techniques (résumé)

| Zone | Fichier | Action |
|---|---|---|
| DB | migration | Trigger `AFTER INSERT/UPDATE recording_url` → pg_net → `pp-auto-process-call` |
| Edge | `supabase/functions/pp-auto-process-call/index.ts` | Nouvelle — lock atomique + STT + Claude + broadcast |
| Edge | `pp-coach-call/index.ts` | Refactor pour partager la logique de lock (idempotent) |
| Edge | `pp-admin-backfill-calls` | Mode `mode=auto_process` qui enfile les appels non traités |
| UI admin | `src/pages/planipret/admin/PARecordings.tsx` | Retirer bouton "Analyser" manuel superflu, garder "Ré-analyser (force)" pour super_admin |
| UI mobile | `src/pages/planipret/mobile/MCalls.tsx` + copie `apps/planipret-mobile/…/MCalls.tsx` | Lecture seule transcript + analyse, realtime |
| Hook | `src/hooks/useCallAnalysis.ts` + copie mobile | `analyze()` devient no-op si `analyzed_at`, gère état `queued` |
| Realtime | Supabase | S'assurer que `planipret_phone_calls` est dans la publication realtime |
| Native | `apps/planipret-mobile/*` | Parité + `audit:native` + `cap sync ios` |

## Livrables
1. Traitement unique server-side + diffusion realtime (mobile + admin).
2. Portail admin = seule source d'analyse ; brokers voient leurs propres transcripts/analyses en push.
3. `apps/planipret-mobile` prêt à builder sur iPhone via Xcode après `git pull`.
