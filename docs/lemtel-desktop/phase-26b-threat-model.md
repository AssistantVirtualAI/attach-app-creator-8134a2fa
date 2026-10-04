# Lemtel — Phase 26B : modèle de menace

| Menace | Mitigation |
|---|---|
| Bypass administratif | Aucune exception admin dans `RecentsList`; filtre `isOwnRow` appliqué à tous. |
| Paramètre extension falsifié | Les méthodes personnelles n’acceptent que `rangeDays`; extension issue de `getMeContext()`. |
| Fuite par canal organisationnel | Aucun filtre `organization_id`; canal unique `extension=eq.<ext>`. |
| CDR étranger retourné par erreur | Filtre local avant `setRows`; vérification de la ligne Realtime avant rafraîchissement. |
| Absence d’extension | Aucune lecture, aucun canal; liste vide côté API; message d’attente. |
| Nettoyage Realtime | Timer annulé et `removeChannel` au démontage. |
| Verto / double propriétaire SIP | Aucun code SIP touché; JsSIP reste seul. |
| Régression Planiprêt | Aucun chemin Planiprêt; garde permanente avant/après. |

Risque résiduel : l’autorisation serveur/RLS reste l’autorité finale (non modifiée ici).
