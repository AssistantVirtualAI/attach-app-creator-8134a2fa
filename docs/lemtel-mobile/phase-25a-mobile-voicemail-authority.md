# Lemtel — Phase 25A : autorité du portail sur le message d’accueil (Mobile)

Base : `681346146`.

## Frontière

Politique validée par le portail (`telephonyPolicy.voicemailPolicy`, `enabled|disabled`) → `MobileApp` (normalisation restrictive) → `MoreScreen` / `CallsScreen` / onglet direct → `VoicemailScreen`. Seule la **configuration du message d’accueil** est concernée.

## Règles

- Repli restrictif : toute valeur absente, inconnue, `null` ou en chargement devient `disabled`.
- `enabled` : comportement inchangé (`get_settings`, éditeur, aperçu, `create_greeting` / `activate_greeting` / `save_settings`).
- `disabled` : aucun appel `user-voicemail-greeting`, aucun contrôle, carte passive `data-testid="voicemail-greeting-disabled"`. `saveGreeting` refuse avant toute mutation ou `edgeCall`. Passage `enabled → disabled` : l’état local de l’éditeur est effacé.
- Consultation, lecture audio, transcription/résumé, realtime et notifications des messages de la propre extension (`own_extension_only`) sont conservés dans les deux états.

## Hors changement

Aucune modification PBX/FusionPBX/Supabase/portail/Desktop/natif, aucune migration, aucune publication, aucune donnée réelle.
