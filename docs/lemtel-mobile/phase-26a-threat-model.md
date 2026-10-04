# Lemtel — Phase 26A : modèle de menace

| Risque | Mitigation |
| --- | --- |
| Bypass administrateur | Aucun `dataScope`/`permissions.admin` dans le filtre CDR, l’historique ou les notifications CDR. |
| Fuite par Realtime | Filtre `extension=eq.<ext>` uniquement ; clé de canal dérivée de l’extension. |
| Ligne CDR mal filtrée | Vérification défensive `row.extension === ext` avant insertion/mise à jour ; filtre local sur l’extension dans l’Historique. |
| Absence d’extension | Aucun canal, transport `idle`, message neutre. |
| Repli organisationnel | Plus aucun `organization_id=eq` pour `pbx_call_records`. |
| Paramètre client d’extension | `mobileApi.calls()` n’envoie que `days` et `limit` ; serveur `mobile-calls` impose l’extension. |
| Secret / identifiants | Aucun ajout ; test racine sur les lignes ajoutées. |
| Réintroduction Verto | Interdit ; vérifié par le test racine. |
| Double propriétaire SIP Android | JsSIP/WebView reste seul propriétaire ; aucun code SIP modifié. |
| Régression Planiprêt | Aucun chemin protégé ; garde permanente. |

Hors phase : canaux SMS / messagerie vocale / enregistrements, fonctions serveur, RLS, test sur appareil physique.
