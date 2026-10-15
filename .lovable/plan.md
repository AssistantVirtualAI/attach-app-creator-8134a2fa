# Commissions : mise à jour par changements seulement, plus aucun recalcul complet

## Constat
- La comparaison avec Maestro existe déjà (aux 15 min, ligne par ligne, par courtier). Elle sait déjà dire « rien de nouveau ».
- Le problème : dès qu'**un seul** courtier change, la vue « tous les courtiers » relit tout : environ 25 000 lignes historiques et 44 000 lignes Maestro, puis recalcule tout. C'est ce calcul qui plante et qui fait tourner la page Déboursées.

## Ce qui change
```text
Aux 15 min, par courtier (déjà en place)
  Maestro Déboursées + En attente -> comparaison avec nos lignes en base
  rien de nouveau   -> on ne touche à rien (0 calcul, 0 jeton IA)
  nouveau / modifié -> on garde seulement ces lignes-là
       -> Claude relit SEULEMENT ces lignes (contrôle, jamais de calcul)
       -> on recalcule les totaux de CE courtier seulement
       -> le global = somme des totaux des courtiers (pas de relecture)
       -> avis « updated » aux écrans

Ouverture de la page -> lecture des totaux déjà prêts en base (instantané)
```

## Étapes
1. **Totaux prêts par courtier, gardés en base** : pour chaque courtier, chaque source (Déboursées, En attente) et chaque mois, on garde les totaux déjà calculés : volume, dossiers, commission par catégorie, par prêteur, par type de prêt et par terme. Mêmes règles qu'aujourd'hui (dossier = contrat + tranche de prêt, Base datée, prêt positif, catégories officielles conservées).
2. **Recalcul limité au courtier touché** : quand la comparaison trouve du nouveau pour un courtier, on recalcule seulement ses totaux. Les autres courtiers ne sont pas relus.
3. **Vue globale = addition** : la vue « tous les courtiers » additionne les totaux des courtiers, quelques centaines de lignes au lieu de 70 000. Plus de plantage et plus d'attente.
4. **Claude sur les changements seulement** : Claude reçoit uniquement les lignes nouvelles ou modifiées du courtier (sans nom de client ni secret). Il signale ce qui semble anormal (doublon, montant étrange, mauvais courtier). Le calcul et la comparaison restent faits par le code : c'est exact et ça ne coûte aucun jeton. Si Claude bloque un changement, les derniers chiffres corrects restent affichés, avec la date.
5. **Écrans** : le portail, l'app mobile et AVA lisent seulement ces totaux en base. Déboursées et En attente restent séparés. Le bouton « Rafraîchir » lance la comparaison pour un seul courtier, ou pour le cabinet si c'est un admin, et ne fait jamais attendre l'écran.
6. **Vérification** : comparer les nouveaux totaux aux anciens pour Sandra, Etienne, Gilles et le global. Ensuite, on vérifie trois choses : un passage sans nouveauté ne fait aucun calcul ni appel à Claude, un changement ne recalcule que le courtier touché, et la page Déboursées s'ouvre en moins d'une seconde sans tourner.

## Ce qui ne change pas
- Les règles de calcul, ce que chaque admin ou courtier a le droit de voir, et les catégories officielles Maestro.
- Rien ne touche à Lemtel, à la téléphonie, aux SMS, ni aux apps iOS/Android. Aucun secret n'est exposé. Tout est livré ensemble, jamais à moitié.

## Détails techniques
- Nouvelle table `planipret_commission_broker_aggregates` (maestro_broker_id, source, year, month, dimension, dim_value, volume, deals, commission_by_type jsonb, data_hash). Accès réservé au serveur (service_role).
- `pp-commission-live-sync` : quand `probe()` détecte un changement, il appelle `rebuildBrokerAggregates(mid, src)` à partir de `planipret_commission_rows` et du registre de ce courtier seulement, puis il met à jour le `data_version` global.
- Validation Claude du delta (`added` + `changed`) dans `_shared`. Sortie JSON stricte. Claude a seulement un rôle de conseil et ne publie aucun chiffre. Si Claude échoue, la publication passe avec un avertissement : les calculs restent ceux du code.
- `pp-commission-stats` (vue globale et vue par courtier) et `planipret-commission-reports` lisent les agrégats au lieu du registre complet et du `live_cache`. L'ancien chemin reste seulement en secours si aucun agrégat n'existe encore. Il est alors fait une seule fois, en arrière-plan.
- Remplissage initial : un passage unique, par lots de courtiers.
- Tests : rien de nouveau, donc aucun recalcul ni appel IA ; un courtier modifié, donc lui seul est recalculé ; global égal à la somme des courtiers ; aucun 0 $ si Maestro échoue ; totaux identiques à l'ancien calcul.
