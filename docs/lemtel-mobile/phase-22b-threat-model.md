# Lemtel — Phase 22B : modèle de menaces

| Menace | Mitigation |
| --- | --- |
| Manifeste malformé ou expiré | `evaluateManifest` valide les clés exactes et les énumérations ; tout résultat autre que `allowed` donne `manifest = null` et la carte disparaît. Un label inconnu n'est jamais affiché (table de libellés fixe). |
| Affichage de données sensibles | Seuls quatre libellés énumérés sont transmis aux écrans ; aucune référence opaque, révision, identifiant, URL WSS, jeton, domaine SIP, mot de passe ou donnée d'appel. Aucune valeur brute du manifeste n'est rendue : uniquement des chaînes fixes. Aucun journal du manifeste. |
| Divergence cache / portail après panne réseau | Le cache n'est utilisé que si `cacheUsableAfterTransient` (non expiré) ; il est remplacé au prochain manifeste valide et effacé par `finalizeBlock()`. La carte peut refléter l'état du dernier manifeste valide jusqu'à son expiration, ce qui est assumé et documenté. |
| Usage de la carte pour modifier PBX/FusionPBX | Carte strictement non interactive : aucun bouton/switch/champ, aucun appel `mobileApi.setDnd`/`setForwarding`, aucune fonction serveur ni écriture PBX. Vérifié par tests. |
| Régression Verto / double propriétaire SIP Android | Aucun fichier SIP, natif ou Android touché ; le test de phase vérifie l'absence de nouvelle occurrence de Verto, PJSIP, `fetch(`, `functions.invoke`, URL SIP. |
| Fuite inter-organisation | Le manifeste est produit par la fonction authentifiée liée à l'organisation et à l'extension de la session ; le Mobile n'ajoute aucune lecture et n'affiche que la politique de son propre manifeste. |
