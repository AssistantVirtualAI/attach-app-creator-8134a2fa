# Lemtel — Phase 27A : modèle de menace

| Menace | Mitigation |
|---|---|
| Visualisation inter-extension | L’API Mobile ne peut plus transmettre `extension=` ; le serveur impose l’extension connectée. |
| Sélection administrative | Prop `isAdmin`, sélecteur et liste des extensions du domaine retirés de l’écran. |
| Rechargement Realtime large | Canal unique `recordings-ext-<ext>` filtré `extension=eq.<ext>` ; aucun canal sans extension ; aucun filtre organisationnel. |
| Exposition de métadonnées audio | Lecture, téléchargement et IA seulement pour les lignes renvoyées par le serveur pour l’extension ; plus de repli de domaine. |
| Fuite après démontage | Canal retiré et écouteurs nettoyés. |
| Régression Planiprêt | Aucun chemin Planiprêt ; garde permanente avant/après. |

La vérification client est défensive et ne remplace pas les contrôles serveur existants.
