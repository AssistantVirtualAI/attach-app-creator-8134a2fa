# Harmonisation visuelle du portail admin Planiprêt

## Constat (vérifié dans le code)

- Le portail admin compte **52 écrans** (`src/pages/planipret/admin/`).
- Seulement **18** utilisent l'en-tête partagé `PAPageShell`; les 34 autres dessinent leur propre titre.
- Les classes de ce shell (`pa-page`, `pa-header`, `pa-header-title`, `pa-scroll`) **ne sont définies nulle part** dans le CSS : même les 18 pages "harmonisées" n'ont en réalité aucun style commun.
- Les couleurs sont recopiées à la main page par page (ex. `PACalls` redéclare `#2E9BDC`, `#00D4AA`, `#E84C4C`), alors que le thème sombre définit déjà `--pp-brand-accent-2`, `--pp-success`, `--pp-danger`.
- Les styles en dur sont massifs : 114 blocs `style={{...}}` dans l'écran d'accueil, 100 dans AVA, 94 dans Utilisateurs, etc.

Résultat : chaque page a sa propre largeur, ses marges, ses arrondis, sa taille de titre et ses nuances de couleur.

## Ce que je vais faire

### 1. Poser une vraie base visuelle commune
Définir dans la feuille de style du portail les styles manquants du shell : page, en-tête (titre, sous-titre, icône, boutons d'action), cartes, tableaux, badges, boutons, champs, états vides et de chargement — tous branchés sur les couleurs du thème existant, sans changer la palette.

### 2. Enrichir le shell partagé
Ajouter au shell les briques réutilisées partout : carte de section, barre de filtres, tableau, badge d'état, ligne de statistiques. Les pages se contentent de les appeler.

### 3. Passer les 52 pages au même gabarit
Chaque page reçoit le même en-tête (icône + titre + sous-titre + actions à droite), la même largeur, le même espacement, les mêmes cartes et tableaux. Les couleurs écrites en dur sont remplacées par les jetons du thème. Aucune donnée, requête ou logique métier n'est touchée.

### 4. Finitions
Bandeaux, onglets, pagination, fenêtres de détail et graphiques alignés sur les mêmes arrondis, ombres et contrastes, en clair comme en sombre, sur écran large et sur mobile.

## Ordre de livraison

1. Base de style + shell enrichi.
2. Écrans les plus visités : Accueil, Appels, Messages, Commissions, Contrats, Clients Maestro, Utilisateurs.
3. Écrans AVA et confirmations.
4. Écrans Maestro (santé, synchro, tâches, périmètre, en attente).
5. Écrans courtiers (parcours, performance, statistiques, rapports).
6. Écrans techniques (diagnostics, journaux, conformité, téléphonie, mobile).

## Détails techniques

- Nouveau bloc de styles `pa-*` dans `src/index.css`, sous le scope `.planipret-admin-scope`, basé sur les variables `--pp-*` déjà présentes.
- `src/components/planipret/admin/PAPageShell.tsx` étendu : `PACard`, `PAToolbar`, `PATable`, `PABadge`, `PAStat`.
- Remplacement des constantes locales (`ACCENT`, `SUCCESS`, `DANGER`, `AGENT`) par `var(--pp-…)`.
- Aucune modification des pages mobiles, du portail client, de la page d'accueil publique, ni des fonctions serveur.
- Vérification par typecheck et captures d'écran avant/après des pages principales.

## Hors périmètre

- Pas de changement de palette ni de logo.
- Pas de refonte de la navigation ni du découpage des menus.
- Pas de changement de comportement, de filtres ou de chiffres affichés.
