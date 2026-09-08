# Audit complet de l'app mobile Planiprêt + rapport PDF

Objectif : passer chaque écran et chaque fonction de l'app mobile au banc d'essai, mesurer ce qui marche vraiment avec les données réelles, et livrer un rapport PDF détaillé (une ligne par test, preuve, cause, correctif).

## Ce que l'audit couvre

**1. Connexion et identité**
- Ouverture de session courriel, code 2FA, session Microsoft 365, expiration de session.
- Lien vers le portail courtier depuis « Plus », version affichée vs version installée.
- Isolation : un courtier ne voit que ses données.

**2. Téléphonie**
- État SIP réel (inscrit / hors ligne) par courtier, poste et numéro affiché.
- Appel sortant (poste interne et numéro externe), appel entrant, écran d'appel, transfert, attente, muet, haut-parleur, second appel.
- Boîte vocale : liste, écoute, suppression, message d'accueil.

**3. Textos**
- Fils regroupés par numéro, ordre des messages, doublons, compteurs non lus, envoi/réception.
- Correspondance avec ce qui est remonté dans Maestro.

**4. Enregistrements, transcription et IA**
- Écoute et téléchargement des enregistrements dans l'app.
- Présence de la transcription, du résumé et du coaching, et cause exacte quand ils manquent.

**5. Écrans de données**
- Accueil, Appels, Messages, Contacts, Clients 360, Fiche client, Broker 360, Tâches, Commissions, Stats, Recherche, Notifications, AVA (chat et voix).
- Chaque écran testé avec un vrai compte : données présentes, écran vide légitime, ou erreur.

**6. Synchronisation Maestro**
- Appels, textos, tâches et commissions : combien remontent, combien sont en attente, et pourquoi.
- Courtiers non connectés à Maestro listés nommément.

**7. Santé technique**
- Erreurs des fonctions serveur sur la fenêtre d'audit, files bloquées, appels lents.
- Contrôles d'accès sur les tables sensibles.
- Suites de tests existantes de l'app mobile exécutées.

## Livrable

Un PDF dans les documents, en français, avec :
- Un tableau de bord d'ouverture : état global, nombre de tests PASS / ATTENTION / ÉCHEC.
- Une section par domaine ci-dessus, une ligne par test avec statut et preuve (identifiant d'appel, code de réponse, extrait de journal, chiffre mesuré).
- Un tableau par courtier : appels, textos, enregistrements, IA, état Maestro.
- La cause racine de chaque échec et le correctif proposé, classé bloquant / dégradé / cosmétique.
- Une courte liste des vérifications qui exigent un vrai téléphone (appels SIP réels, écran verrouillé, audio du voicebot, connexion Microsoft).

## Notes techniques

- Méthode : requêtes base de données sur les vraies données, appels directs aux fonctions serveur en lecture seule, lecture des journaux, exécution des suites de tests existantes, et parcours navigateur headless de la version web de l'app mobile.
- Aucun changement de code pendant l'audit ; les correctifs sont proposés à la fin et appliqués dans une phase suivante après validation.
- Aucun texto ni appel de test envoyé à un courtier réel.
- Le PDF est généré puis relu page par page avant livraison.
