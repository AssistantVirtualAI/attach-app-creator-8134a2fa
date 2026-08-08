# Enregistrements courtier — parité avec le portail admin

Objectif : la page `/planipret/broker/recordings` affiche exactement la même fiche détaillée que la page admin : lecture audio, statut de synchro Maestro, transcription (corrigée IA + brute), résumé IA, thèmes, actions, et coaching IA.

## Ce qui change

1. **Nouveau composant partagé** `src/components/planipret/recordings/RecordingDetailDrawer.tsx`
   Extraction complète du panneau latéral existant de la page admin :
   - En-tête appel (courtier, poste, direction, numéros, date, durée, NS callid)
   - Pastille de statut : Synchronisé (Maestro) / Analysé / Transcrit / En attente + horodatage `analyzed_at` + source
   - Audio streamé via `ns-get-recording` (chargement, erreurs détaillées, téléchargement, cas boîte vocale)
   - Transcription : version corrigée par l'IA, segments par intervenant, version brute NetSapiens, relance `pp-admin-transcribe` avec états « en attente / erreur / indisponible »
   - Coaching IA : bouton d'analyse `pp-coach-call`, états file d'attente / en cours (compteur) / erreur / terminé, score, points forts, à améliorer, prochaines étapes
   - Résumé IA, thèmes, actions à faire
   - Rafraîchissement temps réel de la ligne d'appel (postgres_changes)
   - Textes FR/EN via `useMplanipretLang`
   - Prop `showBroker` pour masquer la colonne « Courtier » côté courtier

2. **`src/pages/planipret/admin/PARecordings.tsx`** — remplace son panneau inline par le composant partagé (aucun changement visuel/fonctionnel).

3. **`src/pages/planipret/broker/PBRecordings.tsx`** — ouvre le même composant au clic sur une ligne, et enrichit le tableau avec les colonnes admin : Transcription (Disponible / En attente), Résumé & thèmes (extrait + puces de thèmes + nombre d'actions), et une pastille Maestro.

## Détails techniques

- Le composant reçoit `{ call, onClose, onUpdated, showBroker }` et gère son propre état (audio, transcription, coaching).
- Les Edge Functions appelées (`ns-get-recording`, `pp-admin-transcribe`, `pp-coach-call`) sont déjà déployées ; aucune modification backend.
- L'accès reste filtré côté courtier par `brokerSelect(...)` sur `planipret_profiles.id` — pas de changement de RLS ni de requêtes.
- Aucune modification du schéma de base.

## Vérification

- Ouvrir un enregistrement côté admin : comportement identique à aujourd'hui.
- Ouvrir un enregistrement côté courtier : audio jouable, transcription, résumé, coaching et statut Maestro visibles.
