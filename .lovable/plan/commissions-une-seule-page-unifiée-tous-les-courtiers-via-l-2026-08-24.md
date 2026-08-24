# Commissions : une seule page unifiée + tous les courtiers via l'API

## Constats vérifiés

- La page admin affiche **deux blocs empilés** : un bloc « live Maestro » (photo 1) et le tableau de bord riche « Commissions – vue entreprise » (photo 2). D'où l'impression de deux pages avec des chiffres différents.
- Le registre local contient **901 lignes de 2022 à 2026, mais un seul courtier** (Jean-Eric Gagnon). Les 17 921 481 $ / 70 dossiers / 146 953 $ de la photo 2 viennent donc de ce seul courtier, pas de l'entreprise.
- Le service serveur des commissions n'interroge Maestro qu'avec **le jeton de chaque courtier connecté** (fan-out). Les courtiers non connectés n'apparaissent jamais.
- Non vérifié à ce stade : si un jeton d'administrateur Planiprêt peut lire les dépôts d'un autre courtier (paramètre `users_id`). C'est la première étape du plan.

## Étape 1 — Sonder l'API (avant tout code)

Avec une session admin, appeler le service de rapports en passant l'identifiant Maestro d'un autre courtier (et sans identifiant), puis comparer :

- si Maestro renvoie les dépôts d'autrui → la portée admin existe : on l'utilise pour **tous les 224 courtiers**, connectés ou non ;
- s'il refuse (403 / résultat vide) → seul le fan-out par jeton est possible et l'écran l'indiquera clairement, avec la liste des courtiers manquants.

Le résultat de cette sonde est rapporté avant de continuer, il conditionne l'étape 3.

## Étape 2 — Une seule page

- Supprimer le bloc live séparé de `/planipret/admin/commissions` et de la page courtier.
- Le tableau de bord riche (photo 2) devient l'**unique** affichage : mêmes KPI, mêmes onglets (Vue d'ensemble, Courtiers, Tendance, Prêteurs, Mix produits, Trimestres, Club, Dossiers), mêmes exports CSV/PNG/PDF, mêmes insights IA.
- Les contrôles utiles du bloc live (rafraîchir, période « Tout », sélecteur de courtier, bandeau de portée) sont fusionnés dans la barre de filtres existante — aucun doublon de KPI.

## Étape 3 — Toutes les données de tous les courtiers

- Une seule source pour la page : le service serveur, qui fusionne **API Maestro + registre importé** et déduplique par dossier (numéro + date + montant).
- Si la portée admin est disponible : balayage de tous les courtiers de `planipret_profiles` ayant un identifiant Maestro, pagination complète côté serveur, agrégation par courtier / prêteur / mois / trimestre.
- Sinon : agrégation des courtiers connectés + registre, avec un bandeau honnête « X courtiers sur 224 couverts en direct » et la liste des non couverts.
- Vue courtier inchangée côté sécurité : verrouillage serveur sur son propre identifiant.

## Étape 4 — Vérification

- Contrôle TypeScript.
- Test bout en bout en session admin et en session courtier : totaux, onglet Courtiers (plus d'un nom quand la portée le permet), filtres période/prêteur, exports.
- Comparaison des totaux affichés avec la somme brute renvoyée par l'API pour confirmer l'absence de double comptage.

## Détails techniques

1. `supabase/functions/planipret-commission-reports/index.ts` : nouvelle action `firm` renvoyant en un appel le résumé, la série temporelle, les agrégats par courtier / prêteur / trimestre et les lignes de dossiers ; portée admin par `users_id` si l'étape 1 la confirme, sinon fan-out ; fusion avec `planipret_commission_register` et déduplication.
2. `src/pages/planipret/admin/PACommissions.tsx` et `src/pages/planipret/broker/PBCommissions.tsx` : retirer `MaestroCommissionsLive`, ne garder que `RegisterCommissions`.
3. `src/components/planipret/commissions/RegisterCommissions.tsx` : lire l'action `firm` comme source unique, ajouter la période « Tout », le bandeau de couverture et le sélecteur de courtier issu de l'action `agents`.
4. `MaestroCommissionsLive.tsx` : supprimé une fois ses éléments utiles absorbés.
