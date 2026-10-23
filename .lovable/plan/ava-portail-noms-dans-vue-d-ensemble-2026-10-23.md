# AVA portail + noms dans Vue d'ensemble

## 1. Apparence du chatbot AVA (portail)
- Panneau latéral repensé : en-tête avec logo AVA, titre et bouton fermer, fond « glass » du portail, largeur 480 px, coins/ombres cohérents.
- Le chat (même que l'app, mêmes outils Maestro) s'adapte au format bureau : plus de cadre mobile écrasé, zone de saisie fixée en bas, défilement propre.
- Bouton flottant plus soigné (halo, info-bulle « AVA »).

## 2. Texto « Numéro manquant » (Marc)
- Cause non confirmée. Première étape : reproduire avec le même message que Marc et lire ce que AVA propose (le message « Numéro manquant » est partagé entre appel et texto ; il apparaît quand la proposition ne contient ni numéro ni nom).
- Correctif attendu : accepter le numéro écrit par l'utilisateur dans tous les champs proposés (ex. `to`, `phone`, `numero`, texte du message) et, en dernier recours, le numéro tapé dans la demande d'origine. Jamais deviner un numéro à partir d'un nom.
- Message d'erreur distinct pour texto vs appel.
- Tests : numéro formaté « 514 880-1737 », « +15148801737 », nom seul, rien.

## 3. Vue d'ensemble : noms dans Appels et Textos récents
- Afficher pour chaque ligne : nom du contact (annuaire/interne) et nom du client Maestro, sinon numéro formaté.
- Réutilise la résolution de noms déjà utilisée ailleurs (même cache par utilisateur), lecture seule, limitée aux contacts du courtier.
- Portail courtier et admin (vue d'un courtier), pour tous les courtiers.

## Technique
- Fichiers : `PortalAvaLauncher.tsx`, `MAvaChat.tsx` (styles portail via prop), `avaSmsRecipient.ts` (+ copie mobile identique), `OvRecentTables.tsx` + hook Vue d'ensemble.
- Aucun changement appels/routage, natif, serveur ou déploiement.
