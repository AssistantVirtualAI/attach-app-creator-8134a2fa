Je vais corriger le flux Microsoft 365 qui cause `AADSTS700025` et rendre la configuration vérifiable de bout en bout.

1. **Corriger l’échange OAuth Microsoft**
   - Adapter `ms365-oauth-exchange` et les refresh tokens pour ne pas envoyer `client_secret` quand l’app Microsoft est configurée comme client public.
   - Garder le mode confidentiel si un secret valide est réellement requis/configuré.
   - Retourner un message clair si le type d’app Microsoft et la config ne concordent pas.

2. **Uniformiser les permissions Microsoft partout**
   - Aligner les scopes du login, du refresh, Teams, Outlook/Mail et Calendrier.
   - Inclure les permissions utilisées par les endpoints existants : Mail, Calendar, Teams chat/channel, People/Users, Contacts, OneDrive attachments si nécessaire.

3. **Verrouiller les redirect URI utilisées**
   - Valider que l’app utilise toujours les callbacks existants :
     - Web : `/auth/microsoft/callback`
     - Mobile native : `planipret://auth/microsoft/callback`
   - Afficher dans le diagnostic la liste exacte à mettre dans Microsoft Entra, sans exposer de secret.

4. **Améliorer les diagnostics Microsoft**
   - Ajouter un test complet : config OAuth, token `/me`, Mail, Calendar, Teams list, Teams send readiness.
   - Montrer les erreurs Microsoft réelles (`AADSTS...`, permissions manquantes, redirect mismatch) au lieu d’un simple “Edge Function error”.

5. **Vérifier les endpoints après correction**
   - Tester les fonctions Microsoft principales : status, oauth exchange/refresh, actions, teams-list, teams-messages.
   - Déployer les edge functions modifiées puis confirmer via logs/outils que l’erreur `AADSTS700025` est réglée.