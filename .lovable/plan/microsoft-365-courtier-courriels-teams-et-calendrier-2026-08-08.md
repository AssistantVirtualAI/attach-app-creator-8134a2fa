# Microsoft 365 courtier : Courriels, Teams et Calendrier

Ajouter dans la page **Microsoft 365** du portail courtier les mêmes capacités que l'application mobile : lire ET envoyer des courriels, discuter dans Teams (conversations, équipes/canaux, création de groupes) et consulter/gérer le calendrier.

## Structure de la page

La page passe en 4 onglets, la vue actuelle devient l'onglet « Statistiques » :

```text
[ Statistiques ] [ Courriels ] [ Teams ] [ Calendrier ]
```

## Onglet Courriels

- Liste actuelle conservée (dossiers, recherche, pagination, détail).
- Bouton « Nouveau courriel » : destinataires (À / Cc), objet, corps, envoi.
- Dans le panneau de détail : Répondre, Répondre à tous, Transférer, Marquer lu/non lu, Archiver, Supprimer.
- Amélioration IA du texte (même bouton Sparkles que le mobile) dans la fenêtre de rédaction.

## Onglet Teams

- Colonne de gauche : conversations récentes, personnes fréquentes, équipes et canaux.
- Colonne de droite : fil de messages du chat/canal sélectionné avec envoi de message et réponse.
- Bouton « Nouveau groupe » : choisir plusieurs personnes, nommer le groupe, créer la conversation et discuter immédiatement.
- Indicateurs de non-lus et rafraîchissement manuel, comme sur mobile.

## Onglet Calendrier

- Vue liste par plage (aujourd'hui / semaine / mois) avec navigation avant/arrière.
- Détail d'un événement : sujet, heure, lieu, participants, lien de réunion Teams.
- Création d'un événement (sujet, date/heure, participants, réunion Teams en ligne), modification et suppression.

## Détails techniques

- Aucun changement de base de données ni de fonction serveur : les actions existent déjà.
  - `ms365-actions` : `read_emails`, `read_email_detail`, `send_email`, `reply_email`, `reply_all_email`, `forward_email`, `mark_read_email`, `archive_email`, `delete_email`, `list_folders`, `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `send_teams_message`, `create_teams_chat`, `search_contact`.
  - `ms365-teams-list` et `ms365-teams-messages` pour les conversations/équipes.
  - `ai-text-improve` pour l'amélioration IA du texte.
- Fichier principal : `src/pages/planipret/broker/PBMicrosoft.tsx` refactorisé en onglets, avec des sous-composants dans `src/components/planipret/broker/ms365/` (`MailPanel.tsx`, `ComposeEmailDialog.tsx`, `TeamsPanel.tsx`, `CalendarPanel.tsx`) pour éviter un fichier monolithique.
- Bilingue FR/EN via `useMplanipretLang`, styles `pp-card` / `PAPage` déjà utilisés dans le portail.
- La bannière « Microsoft 365 non connecté » s'affiche dans chaque onglet si le compte du courtier n'est pas relié.
