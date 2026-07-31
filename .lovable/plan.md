# AVA Softphone Desktop — Dark-theme text fix + visual upgrade

## What I verified first

I audited `apps/ava-softphone-desktop/src` before writing this plan. Two things differ from the brief:

1. **The hardcoded-color problem is much smaller than described.** There are ~20 matches total, and most are legitimate (status dots, gradient stops). The genuinely broken cases on the midnight theme are:
   - `ProfileMenu.tsx` — the password/reset modal block (lines ~904-931): `#0f172a` titles, `#64748b` / `#475569` body text, `#f1f5f9` panel background, `#15803d` success text. This is the one真 invisible-text bug.
   - `SyncStatusView.tsx` — `#b91c1c` and `#047857` badge text, too dark on midnight.
   - `ActiveCallDock.tsx` — light-mode shadow `rgba(15,23,42,0.20)`.
   - `SoftphonePane.tsx:1254` — a `#ffffff` literal used as icon color.
   The remaining `#64748b` / `#334155` / `#b91c1c` values are dot fills and gradient stops in `CallControlGrid`, `QueuesView`, `CallCenterStatusBar`, `HomeDashboard` — they are backgrounds, not text, and stay.
   The other 20+ files listed in the brief contain **no** hardcoded dark text; nothing to fix there.

2. **Most of the requested design system already exists.** `src/lib/theme.tsx` already emits every `--ava-*` variable (bg-gradient, glass, glass-border, accent-gradient, shadow) and `src/styles/futuristic.css` + `animations.css` already provide glass surfaces, aurora mesh, themed scrollbars, focus-visible rings, skeleton shimmer, and reduced-motion guards. `PageHeader.tsx` already has the gradient hairline, gradient icon tile, and action slot. So this is a **refinement pass on existing tokens**, not a rebuild.

## Scope

### Phase 1 — Dark-theme text fixes (correctness)
Replace only the genuinely broken values, using tokens:
- `#0f172a` / `#000` text → `c.textIce`
- `#475569` / `#64748b` **text** → `c.textDim`
- `#f1f5f9` / `#f8fafc` panel bg → `rgba(255,255,255,0.06)`
- `#15803d` → `c.success`, `#b91c1c` → `c.danger`, `#92400e` → `c.warning`
- `rgba(15,23,42,0.20)` shadow → `var(--ava-shadow)`
- `#ffffff` icon color → `c.textIce`
Gold buttons keep `#0b1530` text on purpose.

### Phase 2 — Global polish (CSS only, no component churn)
In `src/styles/futuristic.css` / `animations.css`:
- Slow 8s aurora shimmer on the app background (opacity 0.03–0.06, disabled under `prefers-reduced-motion`).
- Unify scrollbars to the 6px accent-tinted thumb described in the brief.
- Add `pulse-badge`, `slide-in-right`, card-hover-lift, button `:active` scale(0.96), and input focus glow as reusable utility classes.
- `::placeholder` and `:focus-visible` rules aligned with the brief.

### Phase 3 — Component visual pass
Applied as styling-only edits, one component at a time, reusing the utility classes from Phase 2:
- `TitleBar` — 2px aurora top bar, 38px height, tightened brand row.
- `LeftRail` — 44x44 nav tiles, active gradient + 3px left accent, gold unread badge with pulse.
- `SoftphonePane` / `DialerKeypad` / `CallControlGrid` — glass container, mono display field, 56px keypad tiles with press scale, 64px gradient call/hangup circles, in-call control states.
- `HomeDashboard` — greeting card, 4 stat glass cards with gradient top border, recent-calls rows with avatar initials.
- `CallsView` / `RecordingsView` / `VoicemailView` — shared row hover/selected states and the three status-badge variants.
- `IncomingCallToast` — green-ringed avatar pulse, slide-in-right, gradient answer/decline.
- `ActiveCallDock` — floating glass dock, mono green timer.
- `SettingsPage` — sectioned glass cards, tokenized inputs/toggles, gold uppercase section labels.
- `ConsoleLayout` — page fade/translate transition, unified modal/overlay styling.

Skeleton rows replace remaining "Loading…" strings where a list already has a loading state.

## Constraints respected
No changes to business logic, API/Supabase calls, routing, state, `data-testid` attributes, or ARIA. Every new color goes through `var(--ava-*)` or `c.*`, so all four themes (daylight/light/dark/midnight) stay correct — I will spot-check daylight as well as midnight, since a midnight-only fix can break the light themes.

## Technical notes
- Files touched: `src/components/**`, `src/components/console/**`, `src/styles/futuristic.css`, `src/styles/animations.css`. `src/lib/theme.tsx` only if a token is genuinely missing.
- The desktop app is not what the Lovable preview renders, so verification is via typecheck plus the existing Vitest suite under `src/components/__tests__` and `src/components/console/__tests__`.
- Phases land in order so the correctness fix is not blocked behind the cosmetic pass.
