Plan de correction ciblé — sans toucher à autre chose.

1. Settings → Performance
   - Garder le bouton Settings, mais rendre la page Performance réellement utile.
   - Remplacer les requêtes directes fragiles de `MStats.tsx` par la même logique robuste que Home: scope `profile.id` + `profile.user_id` + extension, fallback live NetSapiens, états loading/error/empty.
   - Afficher des données exploitables: appels, manqués, SMS, voicemails, meetings, leads chauds, taux de réponse, graphiques jour/semaine/mois.

2. Brief AVA quotidien / hebdo / mensuel
   - Corriger `pp-ava-brief` pour qu’il ne retourne jamais un brief vide: si IA ou tables manquantes échouent, générer un rapport structuré fallback avec les stats réelles disponibles.
   - Dans `MHome.tsx`, afficher clairement le rapport par période sélectionnée et forcer le refresh quand l’utilisateur change Day/Week/Month.
   - Ajouter dans AVA les actions correspondantes pour demander “rapport journalier”, “weekly report”, “monthly report” et retourner le même brief.

3. Maestro connecté mais recordings “not configured”
   - Unifier la configuration Maestro: les pages de statut utilisent `maestro_telecom`, mais `maestro-sync-call` / `maestro-recording-upload` lisent encore l’ancienne config `maestro`, ce qui cause `maestro_not_configured`.
   - Mettre à jour `_shared/maestro.ts` pour lire aussi `MAESTRO_TELECOM_BASE_URL`, `MAESTRO_MACHINE_API_KEY` et la config `maestro_telecom`.
   - Adapter `maestro-sync-call` et `maestro-recording-upload` aux endpoints Maestro Telecom déjà configurés, puis conserver la déduplication persistante par `call_id`.
   - Faire remonter dans `RecordingsList` un statut exact: En attente / Uploadé / Transmis à Maestro / En échec avec la vraie erreur.

4. SIP registration en arrière-plan
   - Corriger le cycle foreground/background dans `useMplanipretSoftphone.ts`: au background, le service natif doit prendre le relais; au foreground, JsSIP doit reprendre sans tuer la registration en cours.
   - Renforcer `nativePpSipService.ts` pour ne pas désactiver définitivement le garde SIP après un seul `UNIMPLEMENTED` transitoire, et exposer un statut natif clair.
   - Ajouter un heartbeat plus strict: si WebView suspendue ou réseau change, relancer proprement la registration mobile sans double registration destructrice.

5. Voicemail “personnaliser” freeze / scroll bloqué
   - Fixer `MVoicemail.tsx` et `GreetingStudio.tsx` pour que la personnalisation reste dans un conteneur scrollable mobile, sans bloquer le scroll parent.
   - Retirer les hauteurs internes qui piègent le scroll (`max-h-72 overflow-y-auto` non borné dans une page déjà scrollable) et rendre les boutons/voice cards accessibles sans nested interactive conflicts.
   - Ajouter des timeouts et états erreur sur le chargement des voix ElevenLabs pour éviter un freeze visuel.

6. Validation complète après correction
   - Vérifier dans le preview mobile: Settings → Performance, Home → brief Day/Week/Month, Recordings → sync Maestro, Calls/Voicemail → personnaliser et scroll.
   - Exécuter la suite E2E mobile existante ciblée Planiprêt et ajouter/mettre à jour les tests de non-régression pour ces 5 bugs.
   - Vérifier les logs edge functions pour confirmer que Maestro ne retourne plus `maestro_not_configured`.