# Textos : lu / non lu et suppression

## Objectif
Dans l'onglet Messages (app mobile), permettre de marquer une conversation SMS lue ou non lue, tout marquer lu, et la retirer de la liste.

## Comportement
- Chaque conversation : bouton lu/non lu; ouvrir une conversation la marque lue.
- Bouton « Tout marquer lu » quand des textos non lus existent; la pastille disparaît.
- « Supprimer » (avec confirmation) masque la conversation sur cet appareil pour ce courtier. Un nouveau texto du même contact la fait réapparaître.
- Aucun SMS n'est effacé du système téléphonique ni de l'historique serveur (téléphonie non touchée sans votre accord).

## Technique
- Nouveau module front `smsThreadState.ts` (même modèle que les appels manqués) : stockage local par utilisateur, clé = conversation + horodatage du dernier message.
- `MMessages.tsx` : compteur non lu = non lu serveur sauf si marqué lu après le dernier message; boutons sur `ThreadRow`.
- Copie identique dans `apps/planipret-mobile`; tests vitest (lu, non lu, tout lu, masquage, réapparition sur nouveau message).
- Aucun déploiement, aucune fonction serveur, aucune donnée modifiée.
