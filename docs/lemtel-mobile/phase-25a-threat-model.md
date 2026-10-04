# Lemtel — Phase 25A : modèle de menace

## Risques couverts

- Contournement via effet React : l’effet `get_settings` sort si la politique n’est pas `enabled`.
- Valeur de politique inconnue : normalisée en `disabled` dans `MobileApp` et par défaut dans `VoicemailScreen`.
- État résiduel après révocation : texte, voix, aperçu et statut effacés au passage vers `disabled`.
- Appel direct de `saveGreeting` : refus en première ligne, avant toute mutation ou `edgeCall`.
- Fuite d’identifiants : seule l’étiquette `enabled|disabled` traverse les écrans ; aucun manifeste propagé.
- Contournement de portée : test racine figé sur huit chemins, aucun chemin Planiprêt.

## Hors phase

Activation PBX, gestion de PIN, génération/stockage côté serveur, règles de rétention, politiques de transcription, Desktop, test sur appareil physique.
