# Commissions prêtes pour Maestro : tous les courtiers (admin) + chacun le sien (broker)

Objectif : ne rien changer visuellement. Quand le endpoint Maestro sera branché, l'admin voit tous les courtiers et chaque courtier voit uniquement ses données, avec exactement les mêmes onglets, KPI et graphiques qu'aujourd'hui.

## État vérifié aujourd'hui

- Les deux portails lisent la même source (`planipret_commission_register`) via `pp-commission-stats`, qui filtre déjà : admin en mode global, courtier limité à ses lignes (par identifiant utilisateur, identifiant Maestro/cabinet, puis nom normalisé). Cette partie est prête.
- Le point d'entrée de synchronisation `pp-maestro-commissions-sync` ne va chercher que les dossiers **du courtier connecté** (chemins `/users/{id}/…`, un seul jeton). Il n'existe aucun mode « tous les courtiers » côté admin, ni de synchronisation planifiée : c'est le seul vrai manque pour l'objectif.
- Une seule année est écrite par appel (`fiscal_year`), alors que le fichier couvre 2022→2026.

## Ce qui sera fait

### 1. Synchronisation multi-courtiers (admin)

- Le point d'entrée accepte trois modes : un seul courtier (comportement actuel), tous les courtiers (réservé admin), et une liste d'identifiants.
- En mode « tous », la synchro parcourt les profils courtiers ayant un identifiant Maestro et rapatrie leurs dossiers un par un, avec un compte-rendu par courtier (lignes écrites, ignorées, erreurs).
- Plage d'années : de 2022 à l'année courante en un seul appel, au lieu d'une seule année.
- Écriture idempotente conservée (clé unique par dossier) : relancer la synchro ne duplique rien.

### 2. Rattachement fiable de chaque ligne à son courtier

- Chaque ligne écrite porte l'identifiant utilisateur du courtier, son identifiant Maestro et son nom normalisé, pour que le filtrage du portail courtier fonctionne même si le compte n'est pas encore connecté à Maestro.
- Les courtiers non rattachés sont listés dans le compte-rendu (déjà affiché côté admin) pour correction en un clic.

### 3. Déclenchement

- Bouton « Synchroniser Maestro » côté admin (tous les courtiers) et côté courtier (le sien), avec état et horodatage de dernière synchro, sans changer la mise en page.
- Synchro quotidienne automatique côté serveur, réutilisant le même point d'entrée.

### 4. Repli tant que le endpoint n'existe pas

- Si aucun chemin Maestro ne répond, rien n'est écrit ni effacé : les données actuelles restent affichées, et un message clair indique que le endpoint n'est pas encore disponible. Comportement déjà en place, conservé et étendu au mode multi-courtiers.

### 5. Vérification

- Test à blanc (`dry_run`) : compte les dossiers récupérés par courtier sans écrire.
- Après branchement : contrôle que le total admin égale la somme des portails courtiers, et qu'un courtier ne voit jamais les lignes d'un autre.

## Détails techniques

- `supabase/functions/pp-maestro-commissions-sync/index.ts` : ajout de `mode: "self" | "all" | "brokers"`, boucle sur `planipret_profiles` (avec `maestro_broker_id`), plage `years: [2022..now]`, agrégation du rapport par courtier, contrôle admin via `is_planipret_admin`.
- Extraction de la logique de mapping des dossiers dans un module partagé pour l'utiliser par courtier.
- `pp-commission-stats` : inchangé (scoping déjà correct) ; seule la pagination de lecture est vérifiée pour de gros volumes.
- Cron quotidien Supabase appelant la synchro en mode « all ».
- Aucun changement de composant UI hors bouton/horodatage de synchro.
