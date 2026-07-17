# QA Plan — Planiprêt Mobile : anti-zoom & safe-area headers

Objectif : garantir que sur iOS et Android, **aucune interaction ne provoque de zoom (in/out)** et que **chaque page respecte les safe-areas** (notch iOS, status bar Android) sans que le header ne passe sous la barre système.

---

## 1. Vérifications globales (fondations)

Avant de tester page par page, valider les fondations partagées :

### 1.1 Anti-zoom
- `index.html` → `<meta viewport>` doit contenir : `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content` ✅ (déjà présent).
- CSS global : `input, textarea, select { font-size: 16px !important; }` ✅ (déjà présent, empêche le zoom iOS au focus).
- `html/body` : `overflow: hidden`, `touch-action: manipulation`, `overscroll-behavior: none` ✅.
- Ajouter un **listener global** dans `src/index.tsx` qui bloque `gesturestart` (iOS pinch) et `dblclick` sur les zones non-texte, pour éliminer le zoom résiduel WebView.

### 1.2 Safe-area
- Le hook `useSafeAreaInsets()` existe déjà.
- Créer/valider un composant `<MobileScreen>` wrapper qui applique automatiquement :
  - `paddingTop: max(env(safe-area-inset-top), 12px)` sur le header
  - `paddingBottom: env(safe-area-inset-bottom)` sur la bottom-nav
  - `paddingLeft/Right: env(safe-area-inset-left/right)` (mode paysage)
- Chaque page doit être encapsulée dans ce wrapper (ou son header doit lire les insets directement).

---

## 2. Checklist par page

Pour **chaque page ci-dessous**, exécuter les 6 tests :

| # | Test | Critère de passage |
|---|------|--------------------|
| T1 | Ouvrir la page sur iPhone (notch) | Header entièrement visible sous l'encoche, jamais dessous |
| T2 | Ouvrir sur Android (status bar) | Header commence après la status bar, pas de recouvrement |
| T3 | Double-tap sur zone vide | Aucun zoom |
| T4 | Pinch-to-zoom | Aucun zoom |
| T5 | Focus sur chaque `<input>` | Pas de zoom iOS (font ≥ 16px) |
| T6 | Rotation portrait/paysage rapide | Header et bottom-nav restent dans les safe-areas |

### Pages à couvrir (`src/pages/planipret/mobile/`)

1. **MHome.tsx** — accueil KPI
2. **MCalls.tsx** — journal d'appels + dial pad (inputs numériques critiques)
3. **MMessages.tsx** — SMS/chat (champ de saisie critique)
4. **MVoicemail.tsx** — messagerie vocale (lecteur audio)
5. **MContacts.tsx** — liste + recherche (search input)
6. **MPipeline.tsx** — pipeline courtier (scroll horizontal cartes)
7. **MSearch.tsx** — barre de recherche globale
8. **MStats.tsx** — graphiques (tester pinch sur charts)
9. **MMore.tsx** — menu paramètres (liens vers sous-pages)
10. **MAvaChat.tsx** — chat AVA (textarea multi-lignes)
11. **MAvaNotifications.tsx** — liste notifs
12. **MKpiAudit.tsx** — audit KPI
13. **MExtensionSync.tsx**
14. **MDiagnostics.tsx** / **MSipDebug.tsx** / **MMs365Diagnostics.tsx** / **MStyleDiagnostics.tsx**
15. Sheets/modales : `MobileProfileSheet`, `VoiceSettingsSheet`, `MobileHeaderControls` (pastilles langue/thème)

---

## 3. Livrables

1. **Composant `MobileScreen`** wrapper unique appliquant safe-areas + anti-zoom listeners.
2. **Refactor headers** de chaque page pour utiliser le wrapper (0 header codé en dur avec `top: 0`).
3. **Page de QA in-app** `/mplanipret/qa/layout` listant les 15 pages avec :
   - Bouton "Ouvrir"
   - Overlay debug affichant les valeurs `env(safe-area-inset-*)` en temps réel
   - Checklist cochable (T1-T6) sauvegardée en `localStorage`
4. **Test Playwright** (`tests/mplanipret-layout.spec.ts`) simulant iPhone 15 Pro et Pixel 8 :
   - Vérifie qu'aucun `<input>` n'a `font-size < 16px`
   - Vérifie que `document.documentElement.scrollWidth === innerWidth` (pas de débordement horizontal)
   - Vérifie que le header a `padding-top >= safe-area-inset-top`

---

## 4. Détails techniques

**Anti-zoom listener** (à ajouter dans `src/index.tsx`) :
```ts
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch <= 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });
```

**MobileScreen wrapper** :
```tsx
export function MobileScreen({ header, children, bottomNav }) {
  const s = useSafeAreaInsets();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: Math.max(s.top, 12), paddingLeft: s.left, paddingRight: s.right }}>
        {header}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingLeft: s.left, paddingRight: s.right }}>
        {children}
      </div>
      {bottomNav && (
        <div style={{ paddingBottom: s.bottom, paddingLeft: s.left, paddingRight: s.right }}>
          {bottomNav}
        </div>
      )}
    </div>
  );
}
```

**Contrainte respectée** : aucune modification des routes `/mplanipret`, de `MplanipretGuard`, de `App.tsx` ou d'`OrganizationContext` (mémoire projet).
