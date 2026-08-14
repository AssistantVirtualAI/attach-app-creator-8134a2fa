# Correctifs mobile ↔ Maestro : haut-parleur, doublons d'appels, boîte vocale, enregistrements/transcriptions/SMS

Quatre problèmes distincts. Ce qui suit indique ce qui est déjà confirmé par lecture du code/des données, et ce qui reste à diagnostiquer avant correction.

## 1. Haut-parleur en appel (son faible / pas clair)

Confirmé par lecture du code : deux modules natifs pilotent la sortie audio en parallèle et se contredisent.

- `audioRouter.setRoute()` (mobile) appelle **à la fois** `PpSipKeepAlive.setAudioRoute` et `PpPjsip.setSpeaker`.
- Côté natif, `PpSipKeepAlive.applyAudioRoute()` et `PpPjsipEngine.setSpeaker()` font chacun leur propre `overrideOutputAudioPort`, et la session est configurée en `mode: .voiceChat` — mode optimisé pour l'écouteur, volume bas et timbre étouffé sur le haut-parleur.
- De plus `startCallAudio()` ré-applique la route à 1,2 s et 2,5 s, ce qui peut écraser un passage en haut-parleur fait par l'utilisateur juste après le décrochage.

Correctifs :
- Un seul propriétaire de la route : `PpSipKeepAlive`. `PpPjsip.setSpeaker` délègue au même code au lieu d'appliquer son propre override.
- En haut-parleur : bascule de la session en `mode: .videoChat` (tuning haut-parleur, gain plus élevé) avec `.defaultToSpeaker`, retour en `.voiceChat` sur écouteur/Bluetooth.
- Les ré-assertions différées ne réappliquent plus la route de départ si l'utilisateur a changé de sortie entre-temps (comparaison à la route courante, pas à la route initiale).
- Journalisation `NSLog` de la route effective (`currentRoute.outputs`) après chaque changement pour valider sur appareil.

## 2. Le même appel apparaît 4 fois dans le widget Maestro

Non confirmé à ce stade — deux chemins de publication coexistent et il faut mesurer avant de corriger :
- le mobile publie via `maestroCallPosting.ts` avec `provider_call_id = callId` local ;
- le serveur publie via `maestro-cdr` avec `provider_call_id = ns_call_id`.
Ces deux identifiants sont différents, donc Maestro ne peut pas dédupliquer. La déduplication mobile est en mémoire seulement (perdue au redémarrage de l'app).

Étapes :
1. Lire les appels côté Maestro pour le 514-448-0973 et comparer `provider_call_id`, `created_at` et le nombre d'enregistrements réels.
2. Selon le résultat : soit unifier `provider_call_id` sur le `ns_call_id` des deux côtés, soit ne laisser publier qu'un seul émetteur (le serveur), le mobile se limitant aux mises à jour.
3. Rendre la déduplication persistante (clé stockée par appel) au lieu d'un cache mémoire.

## 3. « Personnaliser ma boîte vocale » — génération audio en échec

`GreetingStudio` appelle `pp-greeting-generate`. Aucun log n'a été trouvé pour cette fonction, ce qui indique soit qu'elle n'est jamais atteinte, soit qu'elle échoue avant exécution. La fonction renvoie systématiquement HTTP 200 avec `{ success: false, error }`, donc l'UI n'affiche aucun détail.

Étapes :
1. Vérifier le déploiement de `pp-greeting-generate` / `pp-greeting-voices`, la présence de `ELEVENLABS_API_KEY` et l'existence du bucket `voicemail-greetings`.
2. Reproduire l'appel authentifié et lire l'erreur exacte (`elevenlabs_not_configured`, `wrong_org`, `storage_failed`, `tts_failed`…).
3. Corriger la cause identifiée et remonter le message d'erreur réel dans `GreetingStudio` (aujourd'hui masqué), avec état de chargement et bouton « Réessayer ».

## 4. Enregistrements, transcriptions et SMS absents de Maestro

Confirmé en base : sur les appels récents de `planipret_phone_calls`, `recording_url` est **null partout**. Sans fichier audio, `maestro-recording-upload` n'a rien à envoyer et la transcription réelle ne peut pas être produite.

Étapes :
1. Vérifier la récupération des enregistrements NetSapiens (`pp-ns-recordings` / `ns-get-recording`) : les appels récents ont-ils un enregistrement côté PBX, et pourquoi `recording_url` n'est jamais renseigné.
2. Rejouer `maestro-sync-call` sur un appel de test et lire les logs de chaque étape (CDR → enregistrement → transcription → résumé) pour localiser l'étape en échec.
3. Vérifier `maestro-sync-message` pour les SMS : quel endpoint est appelé, et si les messages sortants/entrants sont bien poussés.
4. Corriger le maillon défaillant, puis rejouer les appels du 14 août pour remplir Maestro.

## Validation (les 9 tests)

Après correctifs, exécution d'une passe complète sur un vrai appareil : appel sortant client, appel entrant client, appel interne courtier, haut-parleur, Bluetooth, boîte vocale personnalisée, enregistrement, transcription, SMS — avec vérification dans Maestro à chaque étape et compte rendu par test.

## Détails techniques

Fichiers concernés : `apps/planipret-mobile/src/lib/planipret/audio/audioRouter.ts`, `ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift`, `ios/App/App/Plugins/PpPjsip/PpPjsipEngine.swift`, `src/lib/planipret/maestroCallPosting.ts`, fonctions `maestro-cdr`, `maestro-sync-call`, `maestro-sync-message`, `pp-greeting-generate`, `pp-ns-recordings`.

Les changements natifs iOS nécessitent un nouveau build (git pull + `npx cap sync`) pour être testables sur appareil.
