# Lemtel — Phase 27A : confidentialité Mobile des enregistrements

Base : `179f313c6`. Règle du manifeste : `telephonyPolicy.recordingsPrivacyScope = own_extension_only`.

## Objectif

L’écran Enregistrements Mobile n’affiche, ne demande, n’écoute en direct, ne télécharge et n’analyse que les enregistrements de l’extension connectée, y compris pour un administrateur. Les vues d’organisation et filtres par extension restent dans le portail Lemtel.

## Portée (Mobile uniquement)

- `mobileApi.recordings(opts?: { rangeDays })` : requête `/mobile-recordings?days=<7|30>`, jamais `extension=`. Le serveur `mobile-recordings` impose déjà l’extension connectée et reste l’autorité.
- `RecordingsScreen` : prop `isAdmin`, sélecteur d’extensions, lecture `pbx_extensions_directory` et repli `fallbackDomainUuid` retirés. Sans extension : aucun appel, aucun canal, liste vide.
- Realtime : canal `recordings-ext-<extension>` filtré `extension=eq.<extension>` (INSERT/UPDATE) ; plus de filtre organisationnel. Nettoyage du canal et des écouteurs `focus` / `ava:callEnded` au démontage.
- Indication FR/EN « enregistrements de votre extension connectée ».
- `CallsScreen` : seul l’appel au composant change (prop `isAdmin` retirée).

## Conservé

Recherche locale, période 7/30 jours, lecture audio, cache, téléchargement manuel et panneau IA, uniquement pour les lignes reçues du serveur.

## Inchangé

Aucune modification serveur, fonction, migration, RLS, PBX/FusionPBX, portail, Desktop, natif ni Planiprêt. JsSIP inchangé.
