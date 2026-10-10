# Commissions par courtier : mêmes chiffres partout, mis à jour presque en temps réel

## Le problème
- La page « Commissions par courtier » du portail (et son équivalent « Graphiques » dans l'app mobile) lit une **autre source** que les pages Commissions : un ancien registre enregistré dans la base, et non les deux rapports Maestro (déboursées et en attente). C'est pour ça que les chiffres de Sandra y sont différents.
- Elle ouvre par défaut sur le premier nom de la liste (un courtier non connecté à Maestro), d'où les 0 $, et son titre s'affiche mal.
- Les chiffres sont gardés en copie jusqu'à 60 minutes : une mise à jour dans Maestro peut prendre jusqu'à une heure à apparaître.

## Ce qui sera fait

### 1. Page « Commissions par courtier » rebranchée sur la même source
- Elle utilise les mêmes rapports validés que les pages Commissions : **déboursées** et **en attente**, avec un sélecteur entre les deux.
- La liste des courtiers ne montre que les courtiers connectés à Maestro. Elle ouvre sur une **vue de tous les courtiers** : un tableau avec, pour chacun, la commission, les dossiers, le volume et la moyenne, trié du plus élevé au plus bas.
- Un clic sur un courtier ouvre son détail : cartes, mois par mois de l'année choisie comparé à l'année précédente, et le partage personnel / équipe.
- Les dossiers et le volume suivent la règle déjà validée : seulement les lignes Base du courtier, chaque contrat compté une fois. Le total de commission reprend le total officiel Maestro.
- Le titre « Commissions par courtier » est corrigé.

### 2. Mêmes chiffres dans le portail et dans l'app mobile
- L'écran « Graphiques » de l'app mobile utilise la même page, limitée au courtier connecté.
- Les deux copies du code (portail et app) restent identiques.
- Pour Sandra, les chiffres de cette page doivent être exactement ceux de la page Commissions déboursées (1 369 383 $, 382 dossiers, 118,7 M$) et en attente (141 dossiers, 45,9 M$).

### 3. Mise à jour presque en temps réel
- La copie gardée sur le serveur est considérée à jour pendant **5 minutes** au lieu de 60. Au-delà, l'écran affiche la copie existante tout de suite et la met à jour en arrière-plan.
- Une tâche serveur rafraîchit les vues récemment consultées **toutes les 5 minutes**.
- Dès qu'une nouvelle copie est enregistrée, le portail et l'app ouverts sont **avertis et se mettent à jour d'eux-mêmes**, sans recharger la page. Chaque écran montre l'heure de la dernière mise à jour.
- Le bouton « Rafraîchir » force une nouvelle lecture Maestro (au plus une fois par minute).
- Si Maestro est en panne, les derniers bons chiffres restent affichés, jamais 0 $.

### 4. Vérification
- En tant qu'admin : chaque courtier connecté est comparé entre la page Commissions et la page « Commissions par courtier », déboursées et en attente. Les chiffres doivent être identiques au cent.
- En tant que Sandra : même comparaison sur le portail courtier et sur le portail en format téléphone.
- Mise à jour forcée sur un écran : l'autre écran ouvert doit recevoir les nouveaux chiffres en moins d'une minute.
- Je ne peux pas tester sur un vrai iPhone ou Android. Les chiffres venant du serveur, l'app installée les reçoit sans mise à jour. La nouvelle page « Graphiques » et l'actualisation automatique dans l'app installée n'arrivent qu'avec la prochaine mise à jour de l'app (le portail web les reçoit tout de suite).

## Détails techniques
- `planipret-commission-reports` : ajouter dans les réponses `summary` et `pending` un `months` (commission, dossiers et volume par mois selon la règle Base) et une liste par courtier pour les déboursées (réutiliser `by_agent`, qui donne déjà fichiers et volume Base). `FRESH_MS` = 5 min, `FORCE_MIN_MS` = 1 min. Après chaque écriture de snapshot, envoyer un événement Realtime broadcast `commissions_updated` (clé du snapshot, sans données sensibles) sur un canal par utilisateur et un canal admin.
- Cron `pp-commission-snapshots-hourly` → toutes les 5 minutes (`*/5 * * * *`), sur les vues consultées dans les 2 dernières heures, en lots limités pour ne pas surcharger Maestro.
- `PABrokerCommissions.tsx` (src et apps/planipret-mobile/src) : remplacer `pp-commission-audit` par `planipret-commission-reports` (`users_id` = `maestro_broker_id`), liste issue des profils `maestro_connected`, vue tableau par défaut, sélecteur Déboursées / En attente.
- Hook partagé `useCommissionLive` : abonnement au broadcast, repli sur une relecture toutes les 60 s quand l'écran est visible ; utilisé par `CommissionSections`, `PendingCommissionsCard`, la vue déboursées et `PABrokerCommissions`, dans les deux copies.
- Clé de traduction du titre ajoutée (FR/EN).
- Aucun changement du code natif iOS/Android. Fonctions serveur déployées ensemble, jamais partiellement.
