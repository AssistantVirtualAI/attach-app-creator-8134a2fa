# Lemtel — Phase 25B : Desktop, message d’accueil géré uniquement par le portail

Base : `d7716ea1f`.

## Règles

- Le portail Lemtel est la seule autorité du message d’accueil de boîte vocale.
- `VoicemailGreetingCard` est une carte informative non interactive (`data-testid="desktop-voicemail-greeting-portal-only"`, `role="note"`) : aucun état, aucune requête, aucun média, aucun contrôle.
- La politique `enabled|disabled` reste exposée en lecture seule par la carte de réglages Desktop existante ; aucune seconde lecture de politique.
- Consultation, lecture audio, transcriptions, résumés, filtres, actions « handled », confidentialité et notifications des messages sont préservés (`VoicemailView` inchangé).

## Hors changement

Aucun PBX/FusionPBX/Supabase/portail/Android/iOS/Electron modifié ; aucune migration, publication, donnée réelle ni action d’appareil.

## Risques couverts

Contournement d’interface, appel Edge caché, génération audio locale, état persistant, fuite de données.

## Hors phase

Activation PBX, PIN, rétention, transcription, gestion portail, Mobile, test sur machine physique.
