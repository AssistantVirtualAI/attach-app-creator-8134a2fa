# Commissions sur l'accueil mobile + résumé IA condensé

## 1. Nouveau widget Commissions sur l'accueil (iOS + Android)

Remplacer la petite ligne actuelle (`CommissionHomeCard`, simple bouton texte) par une carte visuelle riche, affichée uniquement aux rôles `broker` et `admin` :

- KPI principal : commissions du mois en cours (CAD, fr-CA), avec variation en % vs le mois précédent (flèche verte/rouge).
- KPI secondaires : nombre de dépôts, commission moyenne, volume de prêts.
- Mini-graphique : sparkline/aires des 6 derniers mois de commissions.
- Barres « top prêteurs » : 3 principales institutions du mois avec part en %.
- Design aligné sur les cartes existantes (dégradé, halo radial, tokens `--pp-*`), animation d'apparition, états shimmer et état vide propre.
- Tap sur la carte ou sur un prêteur → `/mplanipret/commissions` avec les filtres pré-remplis.
- Aucune donnée financière chargée si le rôle n'est pas autorisé ou si Maestro n'est pas connecté (la carte reste masquée, comme aujourd'hui).

Le même écran web sert iOS et Android via Capacitor : une seule implémentation couvre les deux plateformes.

## 2. Résumé IA (brief) plus court

Aujourd'hui le brief demande un `overview` de 8 à 12 phrases, 5 à 6 priorités et 5 à 6 conseils de 2 à 3 phrases : c'est un mur de texte.

- Nouveau format : `headline` (1 phrase), `overview` **2 à 3 phrases maximum**, 3 priorités (max 10 mots), 2 conseils d'une phrase, 2 risques, 1 focus.
- Le serveur tronque aussi les listes côté sortie pour garantir la brièveté même si le modèle déborde.
- Sur l'accueil : affichage compact par défaut (headline + 3 priorités + focus) avec un bouton « Voir plus » qui déplie conseils, risques et détails.
- Invalidation du cache du brief pour que le nouveau format apparaisse immédiatement.

## Détails techniques

- `src/components/planipret/mobile/CommissionHomeCard.tsx` : réécrit ; appelle `planipret-commission-reports` (`action: "summary"`) pour le mois courant, le mois précédent et une série mensuelle sur 6 mois (requêtes en parallèle, annulables), fuseau `America/Toronto`. Graphiques en SVG léger ou Recharts selon ce qui est déjà chargé sur l'accueil.
- Aucun changement de permissions : la passerelle applique déjà l'isolation courtier/admin et garde le jeton Maestro côté serveur.
- `supabase/functions/pp-ava-brief/index.ts` : prompts FR/EN raccourcis + `slice()` de sortie réduits ; redéploiement de la fonction.
- `src/pages/planipret/mobile/MHome.tsx` : rendu compact du brief avec bascule « Voir plus / Voir moins ».
- Aucune migration de base de données.
