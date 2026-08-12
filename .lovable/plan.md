# Import du registre 2022-2026 + mapping corrigeable

État vérifié : la table du registre des commissions est vide (0 ligne), aucun import n'a encore été enregistré. Le classeur `registre-depots 2022-2026` n'est pas encore joint — l'import démarre dès qu'il arrive.

## Ce qui sera livré

### 1. Import complet du classeur
- Lecture de chaque onglet du classeur (un onglet ou un bloc par année 2022 → 2026), colonnes A:S.
- Extraction assistée par Claude pour les onglets dont l'entête ne correspond pas exactement au gabarit : Claude propose la correspondance colonne → champ et la normalisation des types de commission, puis la correspondance est enregistrée pour être réutilisée.
- Chaque ligne conserve sa provenance : nom d'onglet, numéro de ligne source, valeur brute par champ, lot d'import.
- Rattachement de chaque ligne à un courtier (nom + Maestro ID) ; les lignes non rattachées passent en « NON MAPPÉ » au lieu d'être perdues.

### 2. Mapping éditable dans l'admin
Nouvel écran « Mapping d'import » dans le portail admin :
- Tableau des colonnes A:S détectées avec le champ cible, modifiable.
- Table de correspondance des types de commission (libellé source → type normalisé : base, boni, volume, renouvellement, référencement, autre), avec ajout de nouveaux libellés.
- Correspondance courtier : libellé source → profil courtier / Maestro ID.
- Chaque mapping est sauvegardé et réappliqué aux imports suivants.

### 3. Ré-import incrémental
- Bouton « Rejouer le mapping » : réapplique les correspondances corrigées aux lignes déjà importées, sans purger la base ni réimporter le fichier.
- Dépôt d'un fichier partiel (uniquement les lignes corrigées) : remplacement par clé (onglet + ligne source, sinon numéro de dossier + date), le reste intact.
- Après chaque opération : compteur lignes ajoutées / remplacées / inchangées / en anomalie, et journal du lot.

### 4. Diffusion admin + courtier
- Les mêmes données alimentent le portail admin (vue globale, filtres agent / semaine / mois / trimestre / année, classement, écarts, PDF, drill-down) et le portail courtier (vue restreinte à ses propres lignes via son Maestro ID).
- Les statistiques par année 2022-2026 sont recalculées après chaque import, avec comparatif N-1 et Club Excellence par saison.

## Détails techniques

- Base : nouvelle table de mapping (colonnes, types de commission, alias courtiers) avec RLS admin, plus une clé de déduplication stable sur le registre pour l'upsert incrémental.
- Import : extension de `pp-commission-import` avec les actions `analyze` (Claude via l'AI Gateway sur les entêtes/échantillons), `import` (upsert par clé), `remap` (recalcul sans re-dépôt), `mapping.get` / `mapping.upsert`.
- Fichier : téléversé dans un bucket privé pour permettre le rejeu sans re-dépôt ; parsing xlsx/csv côté fonction.
- Stats : `pp-commission-stats` inchangé côté contrat, il lira simplement les lignes normalisées.
- Front : nouvel écran mapping + panneau d'import dans `PACommissions`, aucune modification du portail courtier au-delà de la lecture des nouvelles données.

## Prochaine étape

Joins le classeur `registre-depots 2022-2026` (xlsx ou csv) : j'analyse les onglets, je te montre le mapping proposé, puis je lance l'import complet.
