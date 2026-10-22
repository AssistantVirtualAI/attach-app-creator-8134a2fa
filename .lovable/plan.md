# AVA dans le portail — Marc-Alexandre seulement

## Déjà en place
- Bouton AVA flottant (en bas à droite) dans les portails admin et courtier.
- Même AVA que l'application : chat et voix (Amélie), mêmes outils Maestro (clients, tâches, commissions, courriels, textos).
- Visible uniquement pour Marc-Alexandre Maglieri (1136); les autres comptes ne voient rien.

## Étapes restantes
1. Ouvrir les deux portails en tant que Marc-Alexandre et vérifier :
   - le bouton apparaît et ouvre le panneau;
   - le chat répond avec des données Maestro réelles (ex. un client, une tâche);
   - la voix démarre et répond.
2. Ouvrir le portail en tant qu'un autre courtier pour confirmer que le bouton n'apparaît pas.
3. Corriger tout problème d'affichage dans le panneau (taille, défilement, micro).
4. Publication sur avastatistic.ca seulement sur votre demande.

## Hors périmètre
- Aucun changement aux appels, à l'application mobile ou au code natif.

## Détails techniques
- Indicateur `portal_ava_enabled` sur le profil; composant PortalAvaLauncher réutilisant MAvaChat.
- La vérification exige d'ouvrir une session au nom de Marc (approbation demandée).
