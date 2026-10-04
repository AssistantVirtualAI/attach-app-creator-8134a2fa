# Lemtel — Phase 27B : modèle de menace

## Menaces évitées

| Menace | Contre-mesure |
|---|---|
| Lecture inter-extension | Méthodes personnelles résolues par `getMeContext()`; aucune extension fournie par l'appelant; filtre local défensif |
| Notifications Realtime élargies à l'organisation | Canal par extension, filtre serveur `extension=eq.<ext>`, vérification locale de chaque ligne |
| Réponse tardive d'une session précédente | Garde d'extension courante; réponse ignorée si l'extension a changé |
| Cache audio multi-session | Cache et URL audio vidés au changement d'extension et au démontage |
| Session sans extension | Aucune lecture, aucun canal, liste vide |

## Exclusions

Aucun changement PBX/FusionPBX, console administrative, portail, RLS, fonction, migration, Mobile, Electron ou Planiprêt.

## Risques restants

- Le filtrage client ne remplace pas les règles serveur, qui restent l'autorité.
- Les méthodes générales restent disponibles pour la console administrative.
- Aucun essai physique Desktop dans cette phase.
