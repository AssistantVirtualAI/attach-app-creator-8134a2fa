# AVA — Confirmations : visuel + erreurs

## 1. Visuel aligné sur les autres pages admin
- Reprendre la mise en page des pages AVA voisines (Logs, Tools audit) : cartes de résumé en haut (En attente, Exécutées, Échouées, Succès), barre de filtres compacte, tableaux avec en-têtes collants.
- Statuts en pastilles colorées lisibles (vert exécuté/succès, rouge échec, ambre en attente), libellés FR/EN, noms d'actions traduits (feedback, rendez-vous, appel, client…).
- Clé anti-double-envoi et identifiants raccourcis avec copie au clic, au lieu de longues chaînes qui étirent le tableau.
- Couleurs du thème uniquement (aucune couleur codée en dur).

## 2. Erreurs du rapport de confirmations
- **« En attente » faux** : 16 lignes affichées en attente datent de septembre (tests QA, numéros 555). Une demande non décidée après 24 h sera affichée « Expirée » au lieu de « En attente » — affichage seulement, aucune donnée supprimée ni modifiée.
- **« to, subject, body requis »** (6 échecs d'hier) : causés par le bogue destinataire déjà corrigé et déployé; le rapport les marquera comme « corrigé depuis » s'ils précèdent le correctif.
- **« action_in_progress »** : affiché comme « Doublon bloqué (protection) » plutôt qu'en échec, car c'est la protection anti-double-envoi qui a fonctionné.

## 3. Les 2 erreurs « start_failed » (AVA vocale, 24 h)
- Deux courtiers différents : la connexion vocale a échoué sur les deux voies (WebRTC puis WebSocket), mais la vraie cause n'est pas enregistrée — seulement « Connexion vocale échouée ». Diagnostic non confirmé.
- Correctif : enregistrer la raison réelle (code et message des deux tentatives, permission micro refusée, jeton expiré) dans le journal de session, afin que la prochaine erreur nomme sa cause; afficher cette raison dans le panneau d'état.
- Ensuite, vérifier les journaux du service vocal pour ces deux sessions et corriger la cause si elle est côté serveur.

## Détails techniques
- `src/pages/planipret/admin/PAAvaConfirmations.tsx` : refonte UI avec `PAPage`/`PAPageHeader`, composants shadcn, statut dérivé (`expired`, `duplicate_blocked`) calculé côté écran.
- `AvaVoiceAgent.tsx` : `fallback` reçoit `webrtcErr`/`wsErr` (nom, code, message tronqué, sans secret) dans `error_message`. Changement AVA demandé explicitement; tests `src/test/ava*.test.ts` et contrat de protection doivent rester verts (ajout d'un test pour la raison détaillée).
- `AvaVoiceHealthPanel.tsx` : afficher `error_message` des erreurs récentes.
- Le dépôt GitHub synchronisé est celui du portail (`attach-app-creator`), pas l'app mobile; le correctif vocal touche l'écran web chargé par l'app. Aucune publication sans demande.
