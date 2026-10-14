# Commissions et AI Insights : tout en cache, mise à jour seulement si quelque chose change

## Objectif

- La page Commissions (portail et mobile) et la Vue d'ensemble s'affichent tout de suite, à partir de notre base de données. Aucun appel Maestro pendant l'ouverture de la page.
- Aux 15 minutes, un seul passage côté serveur interroge les deux sources Maestro (Déboursées et En attente), courtier par courtier. Ce passage compare ce qu'il reçoit avec ce qu'on a déjà :
  - **Rien de nouveau** : on ne touche à rien. On ne refait aucun calcul, on n'envoie aucun avis aux écrans et on ne relance aucune analyse IA.
  - **Du nouveau** : on met à jour seulement les lignes qui ont changé, on recalcule les totaux du courtier touché et du cabinet, puis on remet le tout en cache.
- Les AI Insights (par courtier et global) restent en cache. Une nouvelle analyse IA n'est lancée que si les chiffres de ce courtier ont vraiment changé, ou si tu cliques sur « Régénérer ». Les jetons IA ne sont donc consommés que quand il y a du nouveau.

## Comment ça fonctionne

```text
Toutes les 15 min (un seul job)
  pour chaque courtier connecté :
    Maestro Déboursées + En attente  ->  empreinte des lignes
    empreinte identique ?  -> on passe (0 écriture, 0 IA)
    sinon                  -> on ajoute ou met à jour les lignes changées
                              -> on recalcule les totaux du courtier, puis du cabinet
                              -> on marque l'AI Insight du courtier « à refaire »
                              -> avis « updated » sans chiffres aux écrans

Ouverture de la page  ->  lecture du cache seulement (instantané)
AI Insight            ->  cache ; nouvelle analyse seulement si marquée « à refaire »
                          ou si quelqu'un clique « Régénérer »
```

## Étapes

1. **Stockage local complet** : chaque ligne Maestro est gardée dans notre base, pour Déboursées et pour En attente. Pour chaque courtier et chaque source, on garde aussi une empreinte de ses lignes, la date du dernier passage et la date du dernier changement.
2. **Job unique aux 15 minutes** : le préchauffage actuel aux 15 minutes et la synchronisation aux 30 minutes sont remplacés par un seul job. Il interroge chaque courtier un par un, 5 à la fois, avec la même règle d'accès qu'aujourd'hui. Si Maestro échoue pour un courtier, ses dernières données restent en place : jamais de 0 $.
3. **Comparaison et fusion** : l'empreinte de chaque ligne sert à repérer celles qui sont nouvelles, modifiées ou retirées. Les totaux sont recalculés seulement pour les courtiers touchés, avec les règles déjà en place (dossiers = contrat + tranche de prêt, catégories officielles conservées). Le global est recalculé à partir des totaux des courtiers, pas en rappelant Maestro.
4. **Lecture des écrans** : le portail, l'app mobile et AVA lisent seulement ces totaux en cache. Le bouton « Rafraîchir » lance la mise à jour d'un seul courtier, ou du cabinet pour un admin, avec un délai minimum de 2 minutes entre deux demandes. Les écrans se mettent à jour par l'avis « updated », qui ne contient aucun chiffre.
5. **AI Insights** : chaque analyse IA est rattachée à l'empreinte des chiffres qui l'ont produite. Si l'empreinte n'a pas changé, on sert l'analyse en cache sans limite de durée. Une nouvelle analyse est faite au plus une fois par période de 15 minutes, et seulement à l'ouverture de la page. Il n'y a pas d'analyse IA en arrière-plan pour les courtiers que personne ne consulte.
6. **Vérification** : comparer, pour 3 courtiers (dont Sandra) et pour le global, les totaux en cache avec un appel direct à Maestro. Vérifier ensuite qu'un passage sans nouveauté ne fait aucune écriture et aucun appel IA, et que les pages s'ouvrent en moins de 1 seconde.

## Ce qui ne change pas

- Les règles de calcul, la visibilité admin/courtier et les catégories officielles Maestro.
- Rien ne touche à Lemtel, à la téléphonie, aux SMS, ni aux apps iOS/Android. Aucun secret n'est exposé.

## Détails techniques

- Nouvelles tables : `planipret_commission_rows` (source, maestro_broker_id, row_key, row_hash, row_data, first_seen, last_seen, removed_at) et `planipret_commission_source_state` (broker, source, set_hash, row_count, last_checked_at, last_changed_at, last_error). Accès réservé au serveur (service_role), lecture côté écrans seulement par les fonctions déjà en place.
- `planipret_commission_snapshots` reste le cache de lecture des totaux. Il est réécrit seulement quand `set_hash` change.
- Le travail se fait dans `pp-commission-live-sync`, qui devient le moteur unique. Les crons `pp-commission-snapshot-warm-15min` et `pp-commission-live-sync-30min` sont fusionnés en un seul cron `*/15`, appelé par une fonction SQL qui lit le secret dans Vault (même modèle qu'aujourd'hui, sans aucun secret dans la commande du cron).
- Pour respecter la limite de temps de calcul du serveur, le travail est découpé par lots de courtiers et reprend au courtier suivant si le temps est presque écoulé. Le global ne refait jamais un parcours complet.
- `planipret-commission-reports` et `pp-commission-stats` lisent le snapshot. Elles n'appellent Maestro que si on clique « Rafraîchir » (délai minimum par utilisateur) ou si aucun snapshot n'existe encore.
- `pp-commissions-insights` : la clé de cache devient portée + `set_hash` au lieu d'une durée de 1 h. Un verrou évite que deux analyses partent en même temps pour la même portée. Claude reste le fournisseur principal, avec la mise en cache du prompt.
- Tests : fusion des empreintes (rien de nouveau, ligne ajoutée, ligne modifiée, ligne retirée), aucun 0 $ si Maestro échoue, aucune analyse IA si l'empreinte n'a pas changé, puis la vérification de l'étape 6.
