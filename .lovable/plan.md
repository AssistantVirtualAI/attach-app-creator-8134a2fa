## Nouvelle section Landing : "Planiprêt — Étude de cas"

Ajouter une section dédiée sur `src/pages/Landing.tsx` mettant en valeur tout le travail réalisé pour Planiprêt (portail admin + app mobile courtier + AVA voice/chat + intégrations Maestro/M365/Teams/NS-API).

### Structure de la nouvelle section

Nouveau composant `src/components/landing/PlanipretShowcaseSection.tsx` inséré entre `AppsShowcaseSection` et `LandingDownloadSection`.

Contenu :
1. **Header** — logo Planiprêt + badge "Étude de cas / Case study" bilingue (FR/EN via `useTranslation`).
2. **Hero visuel** — image AI générée : mockup iPhone montrant l'app mobile courtier (dashboard + AVA chat), style glass-morphism cohérent avec le reste du site.
3. **Grille de fonctionnalités mobiles** (6 cartes avec icônes lucide + micro-illustrations AI) :
   - AVA Voice + Chat (ElevenLabs, 48 tools)
   - Softphone SIP intégré (NS-API)
   - Emails Outlook / Teams / Calendrier M365
   - Sync Maestro CRM (OAuth per-broker)
   - Pipeline & Contacts
   - Analytics & Coaching IA
4. **Bandeau "Portail Admin"** — image AI du dashboard admin (courtiers, intégrations, audit outils AVA, Maestro status) + bullets : gestion courtiers, provisioning DID, audit sécurité, bilingue FR/EN.
5. **Stats bar** — 4 chiffres : "48 outils AVA", "3 plateformes (iOS/Android/Web)", "100% bilingue", "SSO Microsoft + Maestro".
6. **CTA** — bouton vers `#pricing`.

### Assets AI à générer (imagegen `fast`)

- `src/assets/planipret-mobile-hero.jpg` — mockup iPhone dark, app courtier avec AVA chat visible, palette bleu Planiprêt (#1A4A8A / #2E9BDC).
- `src/assets/planipret-admin-dashboard.jpg` — mockup laptop dashboard admin bilingue.
- `src/assets/planipret-ava-voice.jpg` — visuel abstrait onde vocale + logo AVA.

Le logo Planiprêt existe déjà : `src/assets/planipret-logo.png.asset.json`.

### i18n

Ajouter clés `planipretShowcase.*` dans `src/locales/index.ts` (FR + EN) : badge, titre, sous-titre, 6 features (titre + description), admin bullets, stats labels, CTA.

### Intégration

- `src/pages/Landing.tsx` : import + `<div id="planipret-case"><PlanipretShowcaseSection /></div>` après `AppsShowcaseSection`.
- Animation `framer-motion` cohérente avec les autres sections (fade + slide, `whileInView`).
- Respect strict des tokens de design existants (pas de couleurs hardcodées hors palette Planiprêt pour le branding de la section).

### Détails techniques

- Composant purement présentationnel, aucune logique métier.
- Utilise `motion` déjà importé ailleurs, icônes `lucide-react` déjà en dépendance.
- Images externalisées via `lovable-assets` après génération.
- Aucun changement backend, aucun edge function.

### Hors scope

- Pas de modification des autres sections landing.
- Pas de changement au portail admin ni à l'app mobile.
- Pas de nouvelle route.
