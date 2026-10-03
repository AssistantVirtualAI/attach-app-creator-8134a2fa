# Lemtel — Phase 22C : modèle de menaces

| Menace | Mitigation |
| --- | --- |
| Manifeste invalide ou expiré | Validation stricte par clés exactes et énumérations ; tout résultat non `allowed` donne `manifest = null`, la carte disparaît. |
| Cache transitoire et divergence temporaire | Cache utilisé seulement s'il est non expiré (`cacheUsableAfterTransient`), remplacé au manifeste suivant, effacé par `finalizeBlock()`. La divergence est bornée par l'expiration du manifeste. |
| Fuite de références, jetons, URLs | Seuls quatre libellés énumérés sont transmis ; rendu par table de chaînes fixes. Aucune révision, `credentialRevisionRef`, identité, appareil, jeton, URL WSS ou domaine SIP n'atteint `SettingsPage`. Aucun journal. |
| Utiliser la carte pour écrire PBX/FusionPBX | Carte non interactive ; aucun `onClick`, `openPortal`, `sipProvider`, mutation locale ou réseau. Prouvé par tests (clic de tous les descendants). |
| Verto / double pile SIP | Aucun fichier SIP, `useSoftphone` ou `jssipProvider` modifié ; le test de phase interdit toute nouvelle occurrence de Verto, PJSIP, `fetch(`, `functions.invoke`, URL SIP/WSS. |
| Fuite entre organisations | Le manifeste vient de la fonction authentifiée liée à l'organisation et l'extension de la session ; le Desktop n'ajoute aucune lecture. |
| Régression des contrôles existants | Contrôles Auto Answer, Announce Call Recording, Call Forwarding, Voicemail, audio, notifications, Launch on Startup, Sync Status et diagnostics inchangés ; test de rendu dédié. |
