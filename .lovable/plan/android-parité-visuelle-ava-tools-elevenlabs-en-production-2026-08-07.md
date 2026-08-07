# Android : parité visuelle AVA + tools ElevenLabs en production

## 1. Retirer l'image du robot AVA sur Android

Constat après lecture du code : aucun rendu conditionnel `android` n'existe dans l'écran AVA. Le même code affiche partout :

- `PlanipretMobile.tsx` — `AvaBadge` (logo rond dans le header de l'app)
- `MAvaChat.tsx` — logo dans l'en-tête de conversation (l. 372), avatar des messages (l. 434), état vide (l. 526)
- `AvaVoiceAgent.tsx` (l. 571) et `AvaChatSheet.tsx` (l. 97)

Deux causes possibles, à trancher en première étape :

1. **Android exécute un bundle OTA plus ancien** que iOS — dans ce cas la correction est un re-déploiement OTA, pas une modification de code.
2. La vignette existe bien dans les deux, mais elle est **plus visible sur Android** (dimensions/densité), et il faut la supprimer partout pour aligner sur le rendu iOS attendu.

Étapes :

1. Comparer la version OTA active sur Android vs iOS (`mobile_app_config`) pour confirmer si c'est un décalage de bundle.
2. Si c'est bien du code : supprimer le bloc image en haut de l'écran AVA (`MAvaChat.tsx` en-tête + état vide) et le remplacer par le titre texte seul, en gardant l'avatar des messages inchangé.
3. Miroir de la même modification dans `src/pages/planipret/mobile/MAvaChat.tsx` (copie web du même écran).
4. Publier une mise à jour OTA pour qu'Android reçoive le rendu identique.

## 2. Brancher AVA (chatbot + voicebot ElevenLabs) sur les endpoints de production

État actuel : les ~55 tools sont définis dans `supabase/functions/_shared/ava-tools.ts` et exécutés par `ava-tool-executor`, qui pointe déjà sur `client.planipret.com/telecom/api/v1` avec la clé machine.

Travaux :

1. **Audit tool par tool** — pour chaque tool Maestro (`search_client`, `get_client_profile`, `get_client_history`, `create_task`, `create_appointment`, `create_client`, `update_client`, `push_call_summary`, `push_client_note`, `push_communication_log`, `get_call_history`, `get_recording`, `get_voicemails`), vérifier que la route appelée correspond aux routes prod validées (`/users/{id}/...`), et corriger celles qui utilisent encore une collection globale.
2. **Endpoints absents côté Maestro** (`/recordings`, `/voicemails`, `GET /messages`) : router ces tools vers les sources internes (NetSapiens / base) au lieu d'échouer, et renvoyer un message clair.
3. **Résolution du broker** : s'assurer que chaque appel résout le `maestro_broker_id` depuis la session OAuth (même logique que `maestro-actions`) pour que le chatbot et le voicebot voient les bonnes données par courtier.
4. **Sync de l'agent ElevenLabs** : re-pousser la liste complète des tools/webhooks vers l'agent (`elevenlabs-manage-agent` / `pp-admin-ava-elevenlabs`) pour que le voicebot expose exactement les mêmes tools que le chatbot, avec l'URL webhook de production.
5. **Test de bout en bout** : exécuter chaque tool via `ava-tool-executor` et via l'agent ElevenLabs, puis livrer un tableau OK / KO avec la cause pour chaque tool.

## Détails techniques

- Fichiers touchés : `apps/planipret-mobile/src/pages/planipret/mobile/MAvaChat.tsx`, `src/pages/planipret/mobile/MAvaChat.tsx`, `supabase/functions/_shared/ava-tools.ts`, `supabase/functions/ava-tool-executor/index.ts`, fonctions de sync ElevenLabs.
- Aucune migration de base prévue.
- Re-déploiement des fonctions edge concernées + publication OTA à la fin.
