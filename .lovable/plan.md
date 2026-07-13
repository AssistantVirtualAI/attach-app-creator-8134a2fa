# Plan — Parité mobile↔web + Build iOS rapide

## Partie 1 — Parité totale `apps/planipret-mobile` ↔ webapp

### État actuel (diff détecté)
Pages divergentes :
- `MCalls.tsx`, `MVoicemail.tsx`
- `MMs365Diagnostics.tsx` existe seulement côté mobile

Composants divergents :
- `AvaChatSheet.tsx`, `MobileAuthScreen.tsx`
- `call/CallRecordingPlayer.tsx`, `call/MaestroTab.tsx`
- `voicemail/GreetingStudio.tsx`

Config divergente :
- `capacitor.config.ts` mobile OK, mais `vite.config.ts` mobile a des shims (`framer-motion`, `livekit-client`) absents du web (normal — perf iOS WKWebView).
- Endpoints Supabase, edge functions AVA, MS365, téléphonie : mêmes URLs (client Supabase partagé), à re-vérifier.

### Actions parité
1. **Synchroniser les 7 fichiers divergents** : la webapp est source de vérité pour la logique métier ; recopier vers `apps/planipret-mobile/src/...` en conservant les shims mobile (framer-motion → motion-shim, livekit → stub).
2. **Copier `MMs365Diagnostics.tsx`** de mobile vers webapp (`src/pages/planipret/mobile/`) et l'exposer dans la route `More` de la webapp pour parité complète.
3. **Aligner AVA agent config** : vérifier que `AvaVoiceAgent.tsx` mobile appelle exactement les mêmes edge functions (`ava-agent-config`, `ava-tool-executor`, `ms365-actions`, `elevenlabs-manage-agent`) avec les mêmes tools (calendrier, mail, SMS, appel, discovery). Aucune divergence détectée pour ce fichier mais confirmer les variables (voix, prompt, `courtier_name`).
4. **Env** : garantir que `.env` mobile pointe sur la même `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` que la webapp.
5. **i18n / thèmes / branding** : réutiliser `shared/planipret-design-tokens` (déjà en place) et confirmer que le `LanguageContext` mobile expose le même dictionnaire fr/en.
6. **Ajouter un test de parité** `apps/planipret-mobile/scripts/audit-parity.mjs` qui liste les fichiers de `src/pages/planipret/mobile/` et `src/components/planipret/mobile/` et échoue si un fichier existe d'un côté sans équivalent, ou si les hashes divergent hors shims autorisés. Le brancher dans `npm run audit:native` (déjà appelé par `build:ios`).

### Résultat parité
Mobile = webapp sur : pages, composants, endpoints Supabase, edge functions, tools AVA, variables agent, i18n, branding, env. Seules différences autorisées : shims Vite (motion, livekit) et code natif Capacitor (permissions, push, splash).

---

## Partie 2 — Build iOS 18 min → ~2-4 min incrémental

### Diagnostic probable (à confirmer au premier run)
- `npm install` sans cache (2-4 min)
- `vite build` chunks lourds (~2-3 min sur bundle actuel)
- `cap sync ios` recopie tout `dist/` + réinstalle pods (3-6 min sans cache)
- `pod install` réseau (2-4 min si specs repo se met à jour)
- Xcode clean build (5-8 min DerivedData vide)
Somme ≈ 18 min qui matche le vécu.

### Actions accélération
1. **Cache npm** : `npm ci --prefer-offline --no-audit --no-fund` + persister `~/.npm` et `node_modules` entre runs (dev machine locale, pas CI). Gain : ~2 min.
2. **Vite build incrémental** :
   - Activer `build.reportCompressedSize: false` (retire un pass gzip par chunk).
   - Ajouter `--mode development` pour itérations rapides (skippe minify) via nouveau script `build:ios:dev`.
   - Gain : ~1-2 min.
3. **Capacitor sync ciblé** :
   - Nouveau script `sync:ios:fast` qui fait `cap copy ios` (pas `sync`) quand aucun plugin natif n'a changé. `copy` = juste recopie `dist/`, skip `pod install` + update. Gain : ~3-5 min.
4. **CocoaPods cache** :
   - `pod install --repo-update` seulement quand `Podfile.lock` change ; sinon `pod install` sans update.
   - Ajouter `COCOAPODS_DISABLE_STATS=1` et forcer le CDN `trunk` (déjà par défaut mais confirmer).
   - Persister `~/Library/Caches/CocoaPods` (par défaut, mais vérifier).
5. **Xcode DerivedData persistant + incrémental** :
   - Ne PAS faire de `Clean Build Folder` entre itérations.
   - Utiliser `xcodebuild -showBuildTimingSummary` pour identifier top targets.
   - Passer `COMPILER_INDEX_STORE_ENABLE=NO` et `SWIFT_COMPILATION_MODE=singlefile` pour Debug (déjà default pour Debug mais confirmer).
   - Gain : 3-6 min sur builds Debug incrémentaux.
6. **Nouveau script `scripts/ios-fast.sh`** dans `apps/planipret-mobile/scripts/` :
   ```
   npm run build -- --mode development
   npx cap copy ios          # pas sync
   xed ios/App/App.xcworkspace   # ouvre déjà workspace
   ```
   Ajout d'un flag `--full` qui bascule sur l'ancien `build:ios` (avec `cap sync` + `pod install`) quand un plugin natif change.
7. **Live-reload optionnel (dev only)** : documenter mais ne pas activer par défaut, puisque tu as choisi "build incrémental + cache". On garde `capacitor.config.ts` production ; un fichier `capacitor.config.dev.ts` séparé pourra pointer sur le preview Lovable si besoin plus tard.

### Estimation post-optim
- Premier build (cache vide) : ~10-12 min
- Build incrémental JS seul (`ios-fast.sh`) : **~90 s à 3 min**
- Build incrémental Xcode Run sur device : **~30-90 s**

---

## Fichiers touchés

**Parité (recopie + création)** :
- `apps/planipret-mobile/src/pages/planipret/mobile/MCalls.tsx` (aligner sur web)
- `apps/planipret-mobile/src/pages/planipret/mobile/MVoicemail.tsx` (aligner sur web)
- `apps/planipret-mobile/src/components/planipret/mobile/AvaChatSheet.tsx`
- `apps/planipret-mobile/src/components/planipret/mobile/MobileAuthScreen.tsx`
- `apps/planipret-mobile/src/components/planipret/mobile/call/CallRecordingPlayer.tsx`
- `apps/planipret-mobile/src/components/planipret/mobile/call/MaestroTab.tsx`
- `apps/planipret-mobile/src/components/planipret/mobile/voicemail/GreetingStudio.tsx`
- `src/pages/planipret/mobile/MMs365Diagnostics.tsx` (créé depuis mobile)
- `src/pages/planipret/mobile/MMore.tsx` (route ajoutée)

**Outillage** :
- `apps/planipret-mobile/scripts/audit-parity.mjs` (nouveau)
- `apps/planipret-mobile/scripts/ios-fast.sh` (nouveau)
- `apps/planipret-mobile/package.json` (scripts `build:ios:dev`, `sync:ios:fast`, `ios:fast`)
- `apps/planipret-mobile/vite.config.ts` (`reportCompressedSize: false`)

Aucune modification aux edge functions, DB, ou webapp landing/admin.

---

Confirme et je passe en mode build.
