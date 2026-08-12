# Revalidation du registre de commissions et rattachement des courtiers

## Constat actuel (vérifié)

- La table du registre de commissions contient **0 ligne** et **0 lot d'import** : aucune donnée du classeur n'a encore été importée en base.
- Le fichier joint est la **spécification v2** (règles de calcul), pas le classeur de données.
- Le rattachement des lignes à un courtier se fait aujourd'hui uniquement par **correspondance exacte du nom complet ou du courriel**. Aucun rattachement par **Maestro ID**, et le profil courtier ne stocke qu'un `full_name` (pas de prénom / nom séparés).

Conséquence : même après un import, une partie des lignes resterait non rattachée, et le portail courtier n'afficherait rien pour ces courtiers.

## Ce qui sera construit

### 1. Identité courtier complète

- Ajout au registre des colonnes d'identité résolue : **prénom**, **nom de famille**, **Maestro broker ID**, nom d'agent normalisé.
- Ajout au profil courtier de **prénom** et **nom de famille** (dérivés automatiquement du nom complet existant, modifiables).
- Table d'**alias courtier** : plusieurs orthographes du fichier (« Tremblay, Marc », « Marc Tremblay », accents, majuscules) pointent vers un même courtier.

### 2. Moteur de rattachement robuste

Cascade de résolution appliquée à chaque ligne importée :

```text
1. Alias explicite (table d'alias)      -> courtier
2. Maestro broker ID du profil          -> courtier
3. Nom normalisé (accents/ordre/casse)  -> courtier
4. Courriel                             -> courtier
5. Aucun match                          -> non rattaché (listé pour l'admin)
```

Chaque ligne conserve la **méthode de rattachement** utilisée, pour l'audit.

### 3. Import et re-dispatch

- L'import écrit le prénom, le nom, le Maestro ID et le courtier sur chaque ligne.
- Une action **« Re-dispatch »** relance la résolution sur toutes les lignes déjà en base (après ajout d'un alias ou d'un Maestro ID) sans réimporter le fichier.

### 4. Écran admin de revalidation

Dans le portail admin, page Import du registre :

- Rapport de contrôle : lignes totales, par année, montants total volume / commissions, lignes hors période, lignes sans date, doublons de ligne source.
- Tableau **Courtiers détectés** : nom du fichier, courtier rattaché, prénom, nom, Maestro ID, nb de dossiers, volume, commissions.
- Tableau **Non rattachés** : nom du fichier, nb de lignes, montant concerné, avec action « Associer à un courtier » (crée un alias) et champ Maestro ID.
- Bouton **Revalider** qui recompte tout et confirme que chaque ligne est dispatchée.

### 5. Contrôle de cohérence

Vérification automatique que : somme des volumes par courtier = volume global, somme des dossiers par courtier = dossiers globaux (unicité recalculée une seule fois sur la fenêtre complète, conformément à la spec v2), et 0 ligne orpheline.

### 6. Import réel des données

Le classeur Excel du registre (2022-2026) n'est pas encore fourni. Dès qu'il est déposé, l'import est lancé avec ce moteur et le rapport de revalidation est produit.

## Détails techniques

- Migration : colonnes `first_name`, `last_name`, `maestro_broker_id`, `agent_key`, `match_method` sur `planipret_commission_register` ; `first_name` / `last_name` sur `planipret_profiles` ; nouvelle table `planipret_commission_broker_aliases` (RLS admin en écriture, lecture admin) avec GRANTs.
- `supabase/functions/pp-commission-import` : résolution en cascade, actions `import`, `redispatch`, `alias.upsert`, `validate` (rapport de contrôle).
- `supabase/functions/pp-commission-stats` : filtrage/leaderboard basé sur `broker_user_id` avec repli sur `agent_key`, retour du prénom/nom/Maestro ID dans le classement.
- UI : `PACommissionsImport.tsx` enrichi (rapport, tableaux courtiers / non rattachés, actions alias + re-dispatch).
- Aucun recalcul de montants : les montants restent ceux du fichier source, conformément à la règle de provenance déjà en place.
