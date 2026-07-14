# Plan — Intégration ElevenLabs (Overview + Enregistrements)

## Objectif
1. Afficher les statistiques de l'agent vocal AVA (ElevenLabs) dans l'Overview Planiprêt, avec vue globale + détail par agent.
2. Afficher les enregistrements audio des conversations ElevenLabs dans la page Enregistrements, aux côtés des enregistrements PBX existants.

Les deux utilisent la clé `ELEVENLABS_API_KEY` déjà configurée et les endpoints `/v1/convai/*` déjà exploités par les fonctions edge existantes (`elevenlabs-all-agents-analytics`, `elevenlabs-all-agents-conversations`, `elevenlabs-convai-conversations`).

---

## 1. Overview — Section "Agent vocal AVA"

**Fichier concerné :** `src/pages/planipret/admin/PADashboard.tsx` (ou l'Overview courante — à confirmer par lecture) + nouveau composant.

**Nouveau composant :** `src/components/planipret/admin/ava/AvaElevenLabsOverviewCard.tsx`

Contenu affiché :
- **KPIs globaux** (7 derniers jours, sélecteur 24h/7j/30j) :
  - Nombre total d'appels/conversations
  - Durée totale et durée moyenne
  - Taux de succès (completed vs failed)
  - Nombre d'agents actifs
- **Tableau par agent** (une ligne par agent ElevenLabs) :
  - Nom de l'agent, courtier assigné (join sur `planipret_profiles.elevenlabs_agent_id`)
  - Nb d'appels, durée totale, durée moyenne, dernier appel
  - Bouton "Voir les conversations" → ouvre un drawer avec la liste
- **Liste des appels récents** (top 20) : date, agent, durée, statut, bouton lecture audio.

**Backend :** réutilise les edge functions déjà présentes :
- `elevenlabs-all-agents-analytics` pour les agrégats
- `elevenlabs-all-agents-conversations` pour la liste
- Pas de nouvelle fonction sauf si un endpoint manque après vérification.

---

## 2. Page Enregistrements — Onglet "Appels AVA (IA)"

**Fichier concerné :** `src/pages/my/Recordings.tsx` (page actuelle des recordings PBX).

**Changement :** transformer en interface à onglets :
- Onglet **PBX** (contenu actuel inchangé)
- Onglet **AVA (Agent IA)** — nouveau

**Nouveau composant :** `src/components/recordings/AvaRecordingsList.tsx`

Fonctionnalités :
- Liste paginée des conversations ElevenLabs (via `elevenlabs-convai-conversations` action `list`)
- Colonnes : date, agent, durée, statut, transcript disponible
- Player audio inline utilisant l'endpoint audio ElevenLabs `/v1/convai/conversations/{id}/audio` (action `audio` de la fonction existante, qui retourne l'audio signé)
- Bouton "Voir transcript" ouvre un modal avec la transcription
- Filtres : agent, date, statut

**Backend :** aucune nouvelle fonction requise — `elevenlabs-convai-conversations` supporte déjà `list`, `details`, `audio`.

---

## Détails techniques

- Toutes les requêtes ElevenLabs passent par des edge functions (jamais d'appel direct depuis le browser) — la clé API reste server-side.
- Les composants utilisent `supabase.functions.invoke(...)` + `useQuery` avec `refetchInterval: 60_000` pour rafraîchir.
- Le player audio charge l'URL signée à la demande (pas au montage) pour éviter de générer N URLs.
- Le mapping agent ↔ courtier utilise `planipret_profiles.elevenlabs_agent_id` (déjà présent d'après le contexte AVA existant).
- i18n FR par défaut, cohérent avec le reste du portail Planiprêt.

## Fichiers touchés (résumé)
- **créés** : `AvaElevenLabsOverviewCard.tsx`, `AvaRecordingsList.tsx`
- **modifiés** : la page Overview (à confirmer par lecture), `src/pages/my/Recordings.tsx`
- **aucune migration DB**, **aucune nouvelle edge function** (sauf découverte contraire durant l'implémentation)
