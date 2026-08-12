# Registre dépôts par année — import, page Courtiers et dispatch

## Ce que contient réellement le fichier envoyé

J'ai lu les 5 feuilles `registre-depots 2022 → 2026` du nouveau fichier :

| Année | Lignes | Courtiers distincts |
|---|---|---|
| 2022 | 158 | 1 (Jean-Eric Gagnon) |
| 2023 | 153 | 1 |
| 2024 | 179 | 1 |
| 2025 | 238 | 1 |
| 2026 | 173 | 1 |
| **Total** | **901** | **1** |

Les feuilles de synthèse confirment la même chose : « Active Brokers = 1 », classement Club Excellence avec un seul nom.

Ces 901 lignes sont **déjà importées** dans le registre (mêmes totaux par année, 100 % des lignes rattachées à un compte courtier). Le fichier n'apporte donc aucun nouveau courtier : la page Courtiers ne peut pas afficher « tous les courtiers » tant que le registre ne contient qu'un seul `agent_name`.

## Ce que je propose

### 1. Ré-import propre et idempotent (multi-courtiers prêt)
- Relecture des 5 feuilles année par année, normalisation des dates (nombres Excel et dates réelles cohabitent dans le fichier), des montants, du prêteur et du nom de courtier.
- Upsert idempotent (clé : année + ligne source + numéro de dossier) : ré-importer le même fichier ne duplique rien, un fichier contenant d'autres courtiers ajoute simplement leurs lignes.
- Rapport d'import affiché : lignes lues / insérées / mises à jour / ignorées, et surtout **liste des courtiers non rattachés** à un compte utilisateur, avec un écran de correspondance manuelle (nom du registre → courtier du portail).

### 2. Page Courtiers (portail admin) — vue par année
- Filtre **Année** (2022→2026 + « Toutes les années ») appliqué au classement, aux KPI et à l'export.
- Tableau tous courtiers : volume, dossiers, commission, BPS, dossier moyen, part du volume, écarts vs année précédente.
- **Top vendeurs** : podium 1-2-3 (volume, commission, dossiers, au choix) + barres classées, avec infobulles expliquant les calculs.
- Évolution par courtier sur les 5 années (une ligne par courtier) et export CSV du résultat filtré.
- Clic sur un courtier → modale de drill-down existante (dossiers, chronologie, sources).
- Bandeau de couverture honnête : nombre de courtiers réellement présents dans le registre pour l'année choisie.

### 3. Dispatch vers la page Commissions de chaque courtier
- Vérification et renforcement du rattachement `nom du registre → compte courtier` : chaque courtier ne voit que ses propres lignes dans son portail.
- Écran admin de correspondance pour rattacher tout nouveau nom apparaissant dans un futur registre (sinon ses lignes restent visibles côté admin mais marquées « non rattaché »).
- La page Commissions du courtier reprend automatiquement le filtre année et les mêmes règles de calcul que la vue admin (mêmes volumes, mêmes dossiers dédupliqués).

## Détails techniques

- Import : réutilisation de la fonction `pp-commission-import` avec upsert sur `(fiscal_year, source_row, number)`, dédoublonnage volume sur contrat + prêteur + type, `unique_deal` pour le compte de dossiers.
- Agrégats par courtier et par année calculés côté `pp-commission-stats` (scope `all` pour l'admin, scope `self` pour le courtier) afin que les deux vues partagent exactement la même logique.
- Rattachement via `planipret_commission_broker_aliases` (`agent_key` → `broker_user_id`), avec repli sur le nom normalisé.
- Filtre année mémorisé par portail, comme les filtres existants.

## Point à confirmer

Si vous attendez plusieurs courtiers, il faudra un export du registre **non filtré** (le fichier actuel est filtré sur un seul courtier). Le pipeline ci-dessus les prendra alors en charge sans autre modification.
