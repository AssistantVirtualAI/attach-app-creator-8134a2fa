# Planiprêt — Shared Design Tokens

**Single source of truth** for Planiprêt colors, typography, spacing,
component styles and animations. Used by:

- Web app: `src/index.css` (via `@import "../shared/planipret-design-tokens/tokens.css"`)
- Mobile app: `apps/planipret-mobile/src/styles.css`
  (via `@import "../../../shared/planipret-design-tokens/tokens.css"`)

## Files

| File          | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `tokens.css`  | All CSS custom properties + `.planipret-scope` (dark, web),   |
|               | `.planipret-mobile-scope` (light navy trust, mobile), and     |
|               | `.pp-*` component utility classes. **Runtime source.**        |
| `tokens.ts`   | Typed constants (`planipretDarkColors`,                       |
|               | `planipretLightColors`, `planipretTypography`,                |
|               | `planipretSpacing`, `planipretRadii`, `planipretShadows`)     |
|               | for use in TS/JS (inline styles, canvas, brand configs).      |

## Rules

1. **Never hard-code hex colors** in Planiprêt components — reference
   the CSS custom properties (`var(--pp-brand-accent)`) or the TS
   constants (`planipretDarkColors.brandAccent`).
2. **Never edit** `src/index.css` or `apps/planipret-mobile/src/styles.css`
   inside the Planiprêt section — edit `tokens.css` here instead.
3. Web tokens map to `.planipret-scope` (dark). Mobile tokens map to
   `.planipret-mobile-scope` (light navy trust). Both share the SAME
   token names, only the values differ — components stay theme-agnostic.
4. When adding a new token: add it to BOTH scopes in `tokens.css` AND
   to `tokens.ts` so TS consumers stay in sync.

## TS import paths

- Web: `import { planipretDarkColors } from "@/lib/planipret/design-tokens"`
- Mobile: `import { planipretLightColors } from "@/lib/design-tokens"`

Both re-export from this shared module.
