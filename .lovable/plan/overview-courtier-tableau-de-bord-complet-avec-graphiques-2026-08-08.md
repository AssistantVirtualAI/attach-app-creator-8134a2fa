# Overview courtier — tableau de bord complet avec graphiques

Transformer `/planipret/broker/overview` en véritable tableau de bord : KPI, graphiques et tableaux couvrant appels, textos, enregistrements, Maestro, Microsoft 365 (courriels, Teams, calendrier) et commissions.

## Sélecteur de période

Barre en haut : 7 / 30 / 90 jours (défaut 30). Toutes les cartes, graphiques et tableaux se recalculent selon la période choisie.

## Bandeau KPI (8 cartes)

Appels (total), Manqués, Taux de réponse, Durée moyenne, Textos envoyés/reçus, Enregistrements, Messages vocaux non lus, Commissions de la période. Chaque carte affiche la variation vs période précédente (flèche verte/rouge).

## Graphiques

- Appels par jour — aire empilée entrants / sortants / manqués.
- Répartition des appels — donut (entrants, sortants, manqués).
- Textos par jour — barres envoyés vs reçus.
- Durée moyenne d'appel — courbe par jour.
- Heures de pointe — barres par heure (0-23h), pour repérer les plages actives.
- Enregistrements & analyses IA — barres empilées par semaine (avec enregistrement / avec transcription / analysés).
- Commissions — barres par mois (volume et commission) sur la période, réutilise le calcul existant du tableau de bord commissions.
- Microsoft 365 — donut ou barres : courriels reçus/envoyés, réunions Teams, événements calendrier à venir.

Tous les graphiques utilisent Recharts, les couleurs des tokens Planiprêt, sont responsives, avec infobulles bilingues et état vide propre quand il n'y a pas de données.

## Tableaux

- Derniers appels (10) — heure, sens, correspondant, durée, statut, badge résumé IA.
- Derniers textos (5) — correspondant, extrait, heure.
- Prochains rendez-vous calendrier (5) — titre, heure, participants.
- Meilleurs contacts de la période (5) — nom/numéro, nombre d'appels, durée cumulée.

Chaque bloc a un lien « Voir tout » vers la page dédiée (Appels, Textos, Microsoft 365, Commissions).

## Bandeau d'état des connexions

Petite rangée de pastilles : Maestro (connecté / à reconnecter + dernière synchro), Microsoft 365 (connecté ou bouton connecter), Téléphonie (poste et DID du courtier). Chaque pastille mène vers Réglages ou la page concernée.

## Détails techniques

- Fichier principal : `src/pages/planipret/broker/PBOverview.tsx`, découpé en petits composants sous `src/components/planipret/broker/overview/` (`OvKpiRow`, `OvCallsChart`, `OvMessagesChart`, `OvHoursChart`, `OvRecordingsChart`, `OvCommissionsChart`, `OvM365Card`, `OvRecentTables`, `OvConnectionsStrip`).
- Données : un seul hook `useBrokerOverview(userId, days)` qui fait les requêtes en parallèle et agrège côté client :
  - `planipret_phone_calls` (direction, status, duration_seconds, has_recording, has_transcript, analyzed_at, ai_summary, created_at/started_at) filtré sur `user_id` = id de profil courtier ;
  - `planipret_phone_messages` (direction, created_at, body, numéros) ;
  - `planipret_voicemails` (non lus) ;
  - commissions via la logique existante `fetchCommissionRows` / `commissionStats.ts` scoped au courtier ;
  - Microsoft 365 via `supabase.functions.invoke("ms365-stats", { days, insights: true })` (même appel que `PBMicrosoft`), en échec silencieux si non connecté ;
  - état Maestro depuis le profil / la config d'intégration déjà lue dans les réglages.
- Chargement progressif : les KPI et les graphiques d'appels s'affichent dès que la requête téléphonie répond ; M365 et commissions arrivent ensuite avec leur propre squelette, pour ne jamais bloquer la page.
- Aucune modification du filtrage de sécurité : toutes les requêtes passent par le même identifiant courtier fourni par le layout, pas d'identifiant provenant de l'URL.
- Bilingue FR/EN via `useMplanipretLang`, styles via `pp-card` et les tokens existants (aucune couleur codée en dur).

## Hors portée

- Aucun changement à l'app mobile ni au portail admin.
- Pas de nouvelle table ni de nouvelle fonction Edge : uniquement des lectures existantes.
