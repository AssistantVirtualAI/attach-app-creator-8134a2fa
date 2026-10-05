# Lemtel — phase 34D : RPC atomique de brouillon mobile

## Pourquoi une RPC distincte

La fonction source 34C ne doit pas enchaîner une écriture de brouillon et une écriture d’audit séparées : une panne entre les deux laisserait une modification non journalisée. Cette phase prépare donc un **paquet SQL hors ligne** qui, lorsqu’il sera explicitement approuvé puis appliqué, exécutera les deux opérations dans une seule transaction PostgreSQL.

## Contrat préparé

`lemtel_mobile_config_draft_write` ne reconnaît que `create_draft` et `update_draft`. Elle :

- vérifie l’appartenance Lemtel active de l’acteur dans la même organisation et exige `owner` ou `admin`;
- refuse un canal, une révision ou un objet JSON invalides; limite la taille des trois objets et les champs de version/message;
- crée ou modifie seulement une révision dont le statut est `draft`;
- insère l’audit minimal `config_drafted` dans la même transaction;
- renvoie uniquement le brouillon concerné.

La fonction est `SECURITY DEFINER` avec `search_path` fixe. `PUBLIC`, `anon` et `authenticated` n’ont aucune exécution; seul `service_role` reçoit une permission, et le futur endpoint 34C valide déjà le JWT et le rôle avant de l’appeler.

## Limites strictes

Le paquet est `offline_atomic_rpc_package` et garde `apply_authorized`, `function_deployment_authorized`, `data_import_authorized` et `client_cutover_authorized` à `false`.

Il ne crée ni compte Auth, ni organisation, ni appartenance, ni configuration de client, ni bucket/objet, ni release, ni fonction Edge déployée. Il n’importe aucune donnée et ne touche ni PBX, ni push, ni DNS, ni DigitalOcean.

Publication, retrait, Storage, releases et manifestes clients restent chacun des contrats séparés. Avant toute application future, il faut des comptes Auth Lemtel neufs, une organisation/appartenance de test, une recette RBAC et rollback synthétique, une autorisation d’écriture ciblée et une autorisation de déploiement Edge distincte.

## Vérification hors ligne

```sh
node --test scripts/lemtel-self-hosted-atomic-draft-rpc.test.mjs
```

Le validateur renvoie toujours le code `78` et une autorisation `false`; il lit seulement le paquet local et ne contacte aucun serveur.
