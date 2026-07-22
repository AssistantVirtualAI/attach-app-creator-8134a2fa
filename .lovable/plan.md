# Section Lemtel dédiée sur la landing page

Créer une section visuelle premium type "case study" pour Lemtel, dans le même esprit que celle de Planiprêt, couvrant tout l'écosystème : portail web, app desktop (Electron), apps mobiles iOS/Android, extension Chrome, et toutes les fonctionnalités softphone/IA.

## 1. Nouveau composant `PlanipretShowcaseSection` → équivalent Lemtel

Créer `src/components/landing/LemtelShowcaseSection.tsx` — bilingue FR/EN via `useLanguage()`, palette Lemtel (violet/cyan, distincte du bleu Planiprêt pour éviter la répétition visuelle).

Structure :

- **Header** — badge "Étude de cas · Lemtel" avec logo, titre h2, sous-titre
- **Split hero** — visuel principal (softphone mobile en action) + texte d'intro sur la suite unifiée
- **Grille 4 plateformes** — cartes distinctes pour :
  - Portail Web (admin, PBX, users, extensions)
  - App Desktop (Electron, Windows/macOS/Linux, tray, shortcuts, notifications)
  - App Mobile iOS (Capacitor, PjSIP natif, CallKit)
  - App Mobile Android (Capacitor, foreground service, WSS/Verto)
  - Extension Chrome (click-to-call, popup)
- **Grille de features** (6-8 cartes) :
  - Softphone SIP HD (JsSIP + PjSIP + Verto)
  - TURN dynamique Metered
  - Enregistrements d'appels sécurisés
  - Messagerie SMS/MMS
  - Voicemail
  - Contacts & annuaire d'entreprise
  - Statistiques d'appels & rapports
  - Multi-tenant / whitelabel
- **Bandeau admin** — screenshot du portail admin Lemtel avec bullets (gestion PBX, DID, devices, users, RLS, audit sécurité)
- **Stats** — 4 chiffres (ex. plateformes, protocoles supportés, langues, uptime)
- **CTA** — bouton vers `#pricing` ou téléchargement

## 2. Assets visuels

Générer 3 images AI (fast quality, externalisées via `lovable-assets`) :

- `lemtel-mobile-hero.jpg` — softphone mobile en cours d'appel, look moderne
- `lemtel-desktop-app.jpg` — capture stylisée de l'app desktop (fenêtre avec liste d'appels + composer)
- `lemtel-admin-portal.jpg` — dashboard admin PBX

Réutiliser le logo Lemtel s'il existe déjà dans le projet (à vérifier dans `src/assets/`), sinon fallback texte "Lemtel".

## 3. Intégration dans `src/pages/Landing.tsx`

Insérer `<LemtelShowcaseSection />` juste après la section Planiprêt (`#planipret-case`) dans une nouvelle `<div id="lemtel-case">`, avant `<LandingDownloadSection />`.

## Détails techniques

- Framer Motion pour les animations d'entrée (`whileInView`, `staggerChildren`)
- Palette : dégradés violet `#6C5CE7` → cyan `#00D4AA` (distincte de Planiprêt)
- Icônes Lucide (`Phone`, `Monitor`, `Smartphone`, `Chrome`, `Voicemail`, `MessageSquare`, `BarChart3`, `ShieldCheck`, `Globe2`, `Server`)
- Images en `loading="lazy"`, dimensions explicites
- Aucune modification du reste de la landing ou d'autres pages

## Hors scope

- Pas de nouvelle route dédiée (`/lemtel`) — c'est une section dans la landing
- Pas de traductions dans `src/locales/` — copy inline dans le composant (comme Planiprêt)
- Pas de changement backend
