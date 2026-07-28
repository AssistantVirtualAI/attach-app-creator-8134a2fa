Plan de correction ciblé pour Planiprêt Mobile :

1. Header mobile
   - Remettre le logo Planiprêt visible dans le header.
   - Afficher les deux logos AVA + Planiprêt côte à côte.
   - Garder Settings + Bell + Avatar.
   - Réajouter les boutons Langue FR/EN et Thème directement dans le header, sans créer de doublon.
   - Appliquer la même correction dans l’app mobile standalone et dans la version principale.

2. Connexion Microsoft depuis Settings
   - Corriger `Ms365Callback` pour arrêter la boucle `history.replaceState` visible dans ton screenshot.
   - Ajouter une protection anti double-exchange du code OAuth.
   - Remplacer les redirections répétées par une seule navigation contrôlée vers `/mplanipret/home` ou `/mplanipret/more`.
   - Garder le fallback si le deep link Microsoft ne revient pas proprement.

3. Recordings qui se re-upload à chaque clic
   - Ne plus traiter le chargement audio comme un nouvel upload à chaque ouverture.
   - Lire et afficher l’état réel déjà sauvegardé : audio, transcript, IA, CRM.
   - Utiliser `pipeline_state`, `maestro_synced`, `recording_url`, transcript et résumé IA pour mémoriser le statut.
   - Afficher un statut clair par appel : En attente, Uploadé, Transcrit, Analysé, Synchronisé CRM, Erreur.

4. Sync CRM automatique
   - Déclencher automatiquement la synchronisation Maestro quand un enregistrement/transcription/résumé IA est prêt.
   - Garder le bouton Sync CRM seulement comme retry manuel si une erreur arrive.
   - Mettre à jour l’UI en temps réel après `maestro-sync-call`.

5. AVA chatbot actions réelles
   - Corriger l’action SMS pour qu’AVA ne dise plus “envoyé” si rien n’a été envoyé.
   - Sur confirmation, AVA ouvrira la page Texto avec numéro + message et déclenchera l’envoi réel.
   - Pour les appels, AVA ouvrira le dialer, préremplira le numéro, puis déclenchera l’appel si `autoDial` est demandé.
   - Garder l’accès AVA aux outils téléphone, SMS, Microsoft et Maestro.

6. Validation
   - Vérifier par code les deux projets (`apps/planipret-mobile` et `src`) pour éviter de revenir à un ancien build.
   - Vérifier que le dialpad reste seulement sur Home + Calls.
   - Vérifier que Microsoft callback ne peut plus déclencher le crash `replaceState()`.
   - Vérifier que recordings + CRM sync affichent un statut persistant.