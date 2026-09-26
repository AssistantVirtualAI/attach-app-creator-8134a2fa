# Commissions : retour sur l'accueil, source Maestro, accès sécurisé, commissions en attente

## 1. Vérifier ce que Maestro nous donne vraiment (en premier)
- Appeler Maestro avec un compte courtier réel et un compte admin : rapports de dépôts, liste des agents, institutions.
- Chercher dans l'API Maestro s'il existe des commissions **en attente** (dossiers financés non payés, commissions prévues, statut de paiement). Aujourd'hui, le rapport utilisé ne renvoie que les dépôts **déjà payés**.
- Rapport sans montants ni noms : ce qui est accessible, ce qui est refusé, avec les codes de réponse.

## 2. Commissions sur l'accueil
- La carte Commissions existe encore sur l'accueil, mais elle disparaît quand Maestro ne répond pas ou que le compte n'est pas relié.
- Elle restera toujours affichée : montant de l'année, tendance sur 6 mois, principaux prêteurs. Sinon, un message clair avec le bouton « Reconnecter Maestro ».
- Même chose sur l'accueil du portail courtier.

## 3. Chaque courtier tiré de Maestro
- Un courtier voit seulement ses propres commissions, lues avec son propre accès Maestro. Le serveur ignore tout identifiant d'un autre courtier envoyé dans la demande (c'est déjà le cas dans le code, et ce sera testé en vrai).

## 4. Admins : les commissions de tout le monde
- Seuls les admins Planiprêt voient « Tous les courtiers », avec un filtre par courtier.
- Il faut un accès administrateur Maestro officiel (jeton ou identifiant + secret de firme). **Il n'est pas encore configuré.** Sans lui, la vue globale reste bloquée avec un message clair. Il n'y a aucun repli sur les accès des courtiers.
- Je vous demanderai de saisir cet accès dans le formulaire sécurisé.

## 5. Commissions en attente
- **Si Maestro offre ces données :** une section « En attente » (montant prévu, prêteur, date attendue) s'ajoute à côté de « Payées », sur l'accueil, la page Commissions et la vue admin.
- **Sinon :** je vous le confirme, avec la question précise à poser à Maestro. Aucune estimation n'est inventée.

## 6. Tests
- Sans connexion : 401.
- Un courtier qui demande un autre courtier ne voit que ses propres données.
- L'admin voit tous les courtiers, puis un courtier choisi (dès que l'accès admin est fourni).
- L'accueil affiche la carte, sur le portail et dans l'app. Dans l'app, ça arrive avec la prochaine soumission iPhone/Android.

## Détails techniques
- `CommissionHomeCard` : retirer le retour `null` en cas d'erreur, afficher un état vide ou une reconnexion.
- `planipret-commission-reports` : ajouter une action `pending` seulement si un point Maestro vérifié existe (à confirmer dans la doc et par sondage de `/api/main/commissions/*`).
- Portée : `resolveCommissionScope` est inchangée. L'admin passe seulement par `MAESTRO_ADMIN_*`.
