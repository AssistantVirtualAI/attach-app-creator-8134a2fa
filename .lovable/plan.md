## Objectif

Refonte visuelle de la page AVA (chat) pour l'aligner sur le reste de l'app mobile Planiprêt, mettre en évidence le logo AVA dans le footer, et transformer le mode vocal en une orbe "AVA parle" style ChatGPT.

## 1. Footer (PlanipretMobile.tsx) — logo AVA en évidence

Fichiers : `src/pages/planipret/PlanipretMobile.tsx` + `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx`

- Hauteur footer 34px → 48px.
- Logo AVA au **centre** : disque 40×40 avec halo violet pulsé (var(--pp-agent)), léger anneau conique animé, drop-shadow marquée.
- Wordmark "AVA" plus grand (18px, poids 900) accolé au logo, en gradient (agent → brand-accent).
- Micro-textes "Powered by" et "Developed by Planiprêt Solutions" en 8px, opacité réduite, disposés en dessous sur une deuxième ligne pour ne pas voler la vedette au logo.

## 2. Chat AVA — refonte visuelle synchronisée avec les autres pages

Fichiers : `src/pages/planipret/mobile/MAvaChat.tsx` + apps/mobile jumeau.

- **Header** : passer du bandeau sombre custom au style "card-header" utilisé sur MHome/MPipeline (fond `--pp-bg-surface`, border-bottom `--pp-bg-border`, radius top). Titre en Urbanist, sous-titre "Assistant Planiprêt" en petit texte muted.
- **Switch Chat / Vocal** : remplacer les deux boutons plats par un segmented control arrondi, pill glossy, avec indicateur animé (translate). Icônes Mic/MessageSquare, actifs en gradient brand→agent.
- **Bulles** :
  - Assistant : fond `--pp-bg-elevated`, border subtile, radius 20/20/20/6, ombre douce, avatar AVA 32px avec halo agent.
  - Utilisateur : gradient `brand-accent → agent` (harmonisé avec le reste de l'app plutôt que brand→success), texte `#fff`, radius 20/20/6/20.
  - Suggestions : chips en verre (`backdrop-blur`, border agent 30%, hover translate).
- **Composer** : conteneur pill flottant (max-w-3xl, shadow-lg, border agent/20, backdrop-blur), boutons Mic et Send en cercles gradient, animation d'onde pendant l'enregistrement.
- **Empty state** : ajouter l'orbe AVA (petite version) + 3 suggestions cliquables ("Résumé de la journée", "Prochains rendez-vous", "Rappeler un client").

## 3. Mode vocal — orbe AVA style ChatGPT

Fichier : `src/components/planipret/mobile/AvaVoiceAgent.tsx` (+ jumeau).

Créer un nouveau composant `AvaOrb.tsx` (`src/components/planipret/mobile/`) :

- Cercle central 260px, gradient conique animé (violet agent → cyan brand-accent → success).
- 3 anneaux SVG flous en rotation lente contrarotative.
- Réactivité audio :
  - **Idle** : respiration lente (scale 1 ↔ 1.04, 4s).
  - **Listening** : l'orbe pulse selon `micLevels` (déjà calculés via analyser) — scale et intensité de halo proportionnels au niveau moyen.
  - **Speaking** : ondes concentriques émises (3 anneaux `animate-ping` décalés), teinte plus chaude (brand-accent dominant).
  - **Processing / tool_running** : rotation accélérée + shimmer.
- Implémenté en pur CSS + `<canvas>` optionnel pour le voice-blob (fallback : `radial-gradient` + `@keyframes`).

Intégration dans AvaVoiceAgent :

- Remplace le visuel actuel (grande carte + barres micro) par l'orbe centrée verticalement.
- Sous l'orbe : label d'état (`STATE_LABEL[state]`) en typo Urbanist 18px.
- Transcript déplacé en bas, semi-transparent, max 3 lignes visibles avec fade.
- Bouton "Retour au chat" en haut à gauche, cohérent avec le style pill du chat.

## 4. Détails techniques

- Aucun changement de logique (sessions, invocations edge, ElevenLabs) — uniquement UI.
- Tokens : utiliser exclusivement `--pp-*` déjà définis dans `design-tokens`.
- Nouveaux keyframes ajoutés localement via `<style>` inline dans `AvaOrb` pour rester scopés.
- Miroir strict entre `src/` et `apps/planipret-mobile/src/` (règle mplanipret-isolation).
- Build + typecheck après modification.

## Fichiers touchés

- `src/pages/planipret/PlanipretMobile.tsx`
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx`
- `src/pages/planipret/mobile/MAvaChat.tsx`
- `apps/planipret-mobile/src/pages/planipret/mobile/MAvaChat.tsx`
- `src/components/planipret/mobile/AvaVoiceAgent.tsx`
- `apps/planipret-mobile/src/components/planipret/mobile/AvaVoiceAgent.tsx`
- **nouveau** `src/components/planipret/mobile/AvaOrb.tsx` (+ jumeau)
