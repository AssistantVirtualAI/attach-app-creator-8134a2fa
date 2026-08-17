# Corriger les SMS affichés en double

## Objectif
Afficher chaque SMS une seule fois, même lorsque la téléphonie retourne une copie `orig` et une copie `term` du même envoi.

## Plan
1. Remplacer la déduplication actuelle par une identité canonique basée sur le contenu normalisé, les participants normalisés et une fenêtre temporelle tolérante aux formats de date de la téléphonie.
2. Réconcilier explicitement le message optimiste, la copie locale et les copies `orig/term`, en privilégiant la ligne persistée sortante et son identifiant stable.
3. Appliquer la même déduplication dans la fonction qui fusionne l’historique téléphonique et local, afin que le frontend ne reçoive déjà qu’une seule occurrence.
4. Ajouter des tests de non-régression couvrant la paire `orig/term`, le message optimiste avec sa réponse serveur, les espaces invisibles, les timestamps de formats différents et deux vrais SMS identiques envoyés séparément.
5. Déployer la fonction SMS puis vérifier qu’un envoi crée une seule bulle et qu’un rafraîchissement ne la duplique pas.

## Diagnostic confirmé
- La base ne contient pas les copies visibles dans la capture; le doublage se produit pendant la fusion de l’historique téléphonique.
- Le filtre actuel compare le texte presque brut et exige moins de 120 secondes entre les timestamps. Une variation invisible ou un timestamp interprété différemment laisse passer la copie `term`.
- Aucun historique valide ne sera supprimé : la correction agit sur la fusion et l’affichage.