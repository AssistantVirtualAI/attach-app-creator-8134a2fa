# Deuxième appel + conférence 3 voies, et écran d'appel minimisable

## Ce qu'on ajoute

1. **Bouton « + Appel »** pendant un appel actif : ouvre un sélecteur (clavier + recherche de contacts, réutilise l'écran de transfert existant). Dès que le 2e numéro est composé, le 1er appel passe automatiquement en attente.
2. **Bouton « Fusionner »** qui apparaît quand deux appels existent : fusionne les deux en conférence à trois. Un bouton « Permuter » permet aussi de basculer d'un appel à l'autre sans fusionner.
3. **Minimiser l'appel** : une flèche en haut de l'écran d'appel le réduit en pastille flottante (nom + durée + raccrocher). L'utilisateur navigue librement dans l'app ; un tap sur la pastille rouvre l'écran plein. L'appel n'est jamais interrompu.

## Comment ça marche techniquement

### Multi-appel (SIP / WebRTC)
- `ppSipProvider` ne gère aujourd'hui qu'**une** session (`this.session`). On passe à une petite table de sessions : `primary` / `secondary`, chacune avec son état, plus un `activeLine`.
- Nouvelles API du provider : `callSecond(number)`, `swapLines()`, `hangupLine(id)`, `mergeLines()`.
- `callSecond()` met la ligne active en attente (re-INVITE `sendonly`) puis lance le 2e INVITE.
- **Fusion** : côté NetSapiens, la conférence se fait au PBX. `mergeLines()` déclenche un transfert attendu vers un pont de conférence via l'edge function `pp-ns-calls` (nouvelle action `conference`), puis les deux legs se retrouvent dans le même pont et le mobile y reste en 3e participant. Repli si le PBX refuse : on garde les deux appels séparés et on affiche une erreur claire au lieu de couper.
- `useMplanipretSoftphone` expose `snap.lines[]`, `callSecond`, `swap`, `merge`, `conference: boolean`.

### Limite iOS native à confirmer
Sur iOS, les appels passent par le moteur natif **PJSIP + CallKit** (`PpPjsip.swift`), qui n'expose actuellement que `makeCall / answerCall / hangupCall / setMute / setSpeaker / sendDTMF` — donc **ni hold, ni 2e ligne**. Il faut ajouter côté Swift : `holdCall`, `unholdCall`, `makeSecondCall`, `swapCalls`, `mergeCalls` (conférence PJSUA) et déclarer les 2 appels à CallKit. C'est un lot natif séparé qui nécessite un rebuild Xcode.

### Écran minimisable
- Nouvel état partagé `callUiStore` (module simple avec `subscribe`) : `{ minimized: boolean }`, indépendant du routeur pour survivre à toute navigation.
- `PpActiveCallScreen` est déjà monté au niveau du layout (`PlanipretMobile.tsx`, `PlanipretAdminLayout.tsx`) : il reste monté, on masque juste visuellement (`display:none`, pas de démontage → le flux audio et la session SIP sont intacts).
- Nouveau composant `PpCallPill` : pastille flottante fixe (safe-area, au-dessus de la nav), affichée uniquement si un appel est actif et minimisé. Tap = restaurer.
- Bouton « chevron bas » ajouté dans l'en-tête de l'écran d'appel.

## Fichiers touchés
- `apps/planipret-mobile/src/lib/planipret/sip/ppSipProvider.ts` — multi-session, hold auto, swap, merge
- `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` — expose les nouvelles actions et l'état des lignes
- `apps/planipret-mobile/src/components/planipret/PpActiveCallScreen.tsx` — boutons « + Appel », « Permuter », « Fusionner », « Minimiser », bandeau 2e ligne
- `apps/planipret-mobile/src/components/planipret/PpCallPill.tsx` *(nouveau)*
- `apps/planipret-mobile/src/lib/planipret/callUiStore.ts` *(nouveau)*
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx` + `pages/planipret/admin/PlanipretAdminLayout.tsx` — monter la pastille
- `supabase/functions/pp-ns-calls/index.ts` — action `conference` (pont NetSapiens)
- Lot natif iOS (si validé) : `ios/App/App/Plugins/PpPjsip/PpPjsip.swift` + `.m` + moteur PJSIP

## Ordre de livraison
1. Store UI + minimiser/pastille (aucun risque sur l'audio) — livrable immédiat.
2. Multi-lignes JS/WebRTC + boutons « + Appel » / « Permuter ».
3. Fusion conférence via `pp-ns-calls`.
4. Parité iOS native PJSIP/CallKit (rebuild Xcode requis).
