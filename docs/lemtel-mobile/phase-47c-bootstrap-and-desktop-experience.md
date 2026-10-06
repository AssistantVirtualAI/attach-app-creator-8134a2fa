# Phase 47C — bootstrap fiable et expérience Desktop Lemtel

## Objectif

Corriger le passage du premier mot de passe vers l’espace Lemtel et faire de la connexion Desktop une expérience de **poste de travail** plutôt qu’un formulaire mobile étiré.

## Correctifs inclus

- **Bootstrap de session robuste** : la fonction `lemtel-session-bootstrap` lit d’abord les appartenances Lemtel actives, puis les organisations actives dans une seconde requête. Elle ne dépend plus de la relation PostgREST intégrée, qui peut être temporairement indisponible après une migration sur une pile auto-hébergée.
- **Session fraîche après changement de mot de passe** : le client Desktop rafraîchit la session Auth avant de demander le bootstrap serveur. Ainsi, les métadonnées d’onboarding mises à jour sont utilisées immédiatement.
- **Véritable fenêtre Desktop** : Lemtel ouvre désormais à `1180 × 780`, avec une largeur minimale de `840 px`. Le panneau de connexion devient un espace à deux colonnes de type application VoIP moderne; il passe à une colonne seulement si l’utilisateur réduit volontairement la fenêtre.
- **Identité Lemtel cohérente** : le titre de fenêtre et les libellés visibles passent à Lemtel / Lemtel Intelligence; aucune mention visible de l’ancienne marque fournisseur ne reste dans le produit Desktop.
- **Récupération conservée** : le lien **Forgot password?** et le parcours par mot de passe temporaire restent disponibles, sans URL SIP, poste ou domaine affichés.

## Garde-fous

- Aucun secret SIP, WSS, TURN, FusionPBX ou mot de passe n’est renvoyé au client par le bootstrap.
- Les données et Auth Planiprêt ne sont pas consultées ni modifiées.
- Le bootstrap renvoie seulement une identité Lemtel, une organisation active et `telephony.status = not_provisioned` tant que le provisioning téléphonique n’est pas approuvé.

## Validation requise après déploiement staging

1. Connexion avec un mot de passe temporaire Lemtel.
2. Choix du mot de passe personnel.
3. Rafraîchissement de session et entrée dans l’espace Lemtel sans erreur Edge.
4. Vérification de l’écran **Forgot password?** avec un seul courriel de test.
5. Vérification visuelle du nouveau layout Desktop à largeur normale.

> Cette phase ne configure pas FusionPBX, ne distribue pas publiquement les applications et ne publie aucune version dans un store.
