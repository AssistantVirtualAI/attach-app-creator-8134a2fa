# Fin d'appel rapide + graphiques mobiles

## 1. « Supprimer l'appel » instantané (serveur)
- Cause vérifiée : le serveur attend jusqu'à 12 s le lancement du traitement AVA avant de répondre, même pour Supprimer.
- Correctif : enregistrer la décision, répondre tout de suite, lancer le traitement en arrière-plan (même chose pour Enregistrer). Reprise automatique si le lancement échoue.
- Côté app : fermer la feuille dès que le serveur confirme la décision (< 1 s), bouton bloqué contre le double clic.

## 2. Feuille affichée après chaque appel répondu
- Vérifier pourquoi certains appels ne déclenchent pas la feuille (dossier d'appel arrivé en retard, identifiant différent, appel scindé en deux).
- Le serveur fournit la liste des appels répondus sans décision; l'app la consulte à la fin de chaque appel et au retour dans l'app, et affiche la feuille dès qu'un appel attend.
- Ne pas afficher pour appels manqués/refusés (ex. 6 s non connecté : à confirmer selon les données).

## 3. Graphiques commissions adaptés au mobile
- Remplacer le graphique « Commission par type » (barres qui débordent le cercle) par un anneau propre avec légende en liste sous le cercle (montant + %).
- Graphique mensuel : barres lisibles, étiquettes de mois réduites et sans doublons, défilement horizontal si nécessaire.
- « Dossiers et commissions » : hauteur adaptée, axes compacts (k $), info-bulle au toucher.
- Style uniforme : coins arrondis, dégradés aux couleurs de la marque, animations légères, fond clair et sombre.
- Même rendu portail mobile et app (les deux copies du code restent identiques).

## Validation
- Tests : Supprimer/Enregistrer répondent vite; feuille réaffichée après redémarrage; appel manqué sans feuille.
- Captures format téléphone des graphiques; aucune erreur de compilation.
- Déploiement uniquement de la fonction de consentement d'appel. Aucun changement natif iOS/Android; l'affichage nécessite le rafraîchissement de l'app web embarquée.
