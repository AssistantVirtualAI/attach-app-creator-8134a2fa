# Commissions : vue globale pour les admins, vue personnelle pour les courtiers

## Ce qui bloque aujourd'hui (vérifié)

- La page Commissions du portail admin est verrouillée sur **une seule adresse courriel** codée en dur (`mhassoun@assistantvirtualai.com`). Les autres administrateurs Planiprêt voient « Page restreinte ».
- Le tableau des dépôts reste **toujours vide** : le composant lit `data.data`, alors que le service renvoie les lignes dans `rows`.
- Aucune **répartition par courtier** n'est affichée côté admin : seulement un filtre déroulant « Tous les courtiers », sans tableau ni graphique comparatif.
- Les 3 comptes administrateurs sont bien connectés à Maestro, donc l'appel au endpoint officiel fonctionnera dès que la page sera débloquée.

## Ce qui sera livré

### Portail admin (`/planipret/admin` › Commissions)
- Accès ouvert à **tous les administrateurs Planiprêt** (contrôle basé sur le rôle, appliqué aussi côté serveur).
- Vue globale par défaut : **tous les courtiers réunis**, données tirées en direct du endpoint officiel de rapports de commissions.
- Nouveau tableau **« Commissions par courtier »** : nom, nombre de dépôts, volume de prêts, commissions totales, moyenne — trié du plus élevé au plus bas, avec total général.
- Graphique à barres des **10 meilleurs courtiers** de la période.
- Le filtre par courtier reste disponible pour zoomer sur une personne; le tableau des dépôts affiche alors la colonne « Courtier ».
- Message clair si le compte admin n'est pas connecté à Maestro, avec le bouton de connexion.

### Portail courtier (`/planipret/broker` › Mes commissions)
- Reste strictement limité aux commissions du courtier connecté (verrouillage serveur inchangé).
- Même correctif d'affichage : la liste des dépôts se remplit correctement.
- Mêmes indicateurs et graphiques que l'admin, mais sur son périmètre personnel.

## Détails techniques

1. `src/pages/planipret/admin/PACommissions.tsx`
   - Supprimer `COMMISSIONS_ALLOWED_EMAILS`; charger le rôle depuis `planipret_profiles` et autoriser `role = 'admin'` (ou super admin). Conserver l'écran « Page restreinte » pour les autres rôles.
2. `src/components/planipret/commissions/MaestroCommissionsLive.tsx`
   - Corriger la lecture des dépôts : `d.rows` (avec repli sur `d.data`).
   - En scope `admin` sans courtier sélectionné : appeler `deposits` sur plusieurs pages (par_page 200, plafond identique au serveur) et agréger par `agent_name` / `users_id` pour construire le tableau et le graphique « par courtier ».
   - Ajouter la colonne « Courtier » au tableau des dépôts en scope admin.
   - Gérer l'erreur `maestro_not_connected` avec un message dédié plutôt que le texte brut d'erreur.
3. `supabase/functions/planipret-commission-reports/index.ts`
   - Ajouter une action `by_agent` qui parcourt les dépôts et renvoie l'agrégat par courtier (nom, users_id, total, nombre, volume), pour éviter de tirer 2000 lignes dans le navigateur.
   - Conserver l'invariant : rôle `broker` toujours forcé sur son propre `users_id`.
   - Redéployer la fonction.
4. Vérification finale : contrôle TypeScript, puis test bout en bout des actions `summary`, `deposits`, `agents` et `by_agent` en session admin et en session courtier.
