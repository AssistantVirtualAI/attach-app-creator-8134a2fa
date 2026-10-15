# Lemtel — sérialisation Durable Object, correction source uniquement

## Statut et périmètre strict

Cette révision remplace l’ancien accusé textuel de sérialisation par une **primitive de code fail-closed** : la classe exportée `LemtelFailoverSerializer` du bundle `lemtel-failover-arbiter-worker.mjs`. Elle ne déploie ni ne provisionne cette classe. Elle n’exécute aucune activation, aucun secret, binding, migration Cloudflare, cron, DNS, Load Balancer, routage, runtime Hostinger, promotion, fencing réel ou téléphonie.

Le défaut reste `FAILOVER_MODE=disabled`. Sans binding Durable Object valide, classe/migration correspondante, ou réponse de lease strictement valide, un éventuel mode `active` retourne `blocked` **avant toute observation L7, requête fournisseur, fencing ou livraison de commande**. Les modes disabled/inconnus n’appellent ni KV, ni Durable Object, ni réseau.

Aucun périmètre Planipret, Avastatistic, PBX/legacy Lemtel, FusionPBX ou téléphonie n’est modifié.

## Primitive ajoutée au source

| Élément | Contrat source, sans provisionnement |
|---|---|
| Classe Durable Object | Export nommée `LemtelFailoverSerializer`, dans le même module que le Worker. |
| Singleton global | Le Worker demande toujours `idFromName('lemtel-failover-arbiter-serializer-v1')`. Ce nom stable vise une unique instance globale du namespace. |
| Binding requis en actif | `ARBITER_SERIALIZER`, namespace Durable Object disposant de `idFromName` et `get`. Il n’est ni déclaré ni configuré par cette révision. |
| Lease | Capability opaque de **15 secondes**, liée à une clé d’idempotence d’exécution et à `CONFIG_REVISION`. Elle ne paraît jamais dans le statut, les logs, les erreurs publiques ou Workers KV. |
| Ledger | `storage.transaction` du Durable Object enregistre le lease et un digest d’intention `(incident, action)`. Il ne dépend pas de Workers KV et ne retient pas l’identifiant d’incident en clair dans la clé de ledger. |
| Réponses du DO | Uniquement `granted` avec capability opaque vers le Worker appelant, ou `refused` redacted. Aucun endpoint public n’est routé vers le DO. |

Le `STATE` Workers KV existant conserve seulement les records déjà scellés, marqueurs de bootstrap et statuts redacted. **Il ne participe plus et ne peut pas participer à la sérialisation.** Une erreur, un record DO inattendu, une capability expirée, une révision différente ou une intention déjà inscrite est un refus définitif pour l’exécution concernée.

## Transitions protégées

Le scheduler acquiert d’abord un lease. L’observation, les lectures fournisseur, le fencing et la préparation de promotion ne continuent que pendant ce lease. Avant chaque POST destructif (`shutdown` ou `power_off`), le Worker :

1. vérifie le lease non expiré ;
2. persiste l’intention d’incident scellée dans KV ;
3. inscrit une seule intention correspondante dans le ledger transactionnel du DO ;
4. vérifie de nouveau le lease, puis seulement émet le POST.

Ainsi, une incertitude de lease ou de ledger ne lance pas de POST destructif. Une intention persistée, un doublon d’incident/action, une réponse inconnue, une expiration ou une violation de révision bloque l’incident et interdit toute relance automatique du POST. Le passage vers la préparation de promotion porte la même gate de lease/ledger.

L’ancien champ de configuration `ARBITER_SERIALIZATION_ACK` est supprimé : une chaîne de caractères ne prouve pas une exclusion globale. Le reçu de drill signé conserve sa gate `serialized_execution_verified`, mais ce reçu ne peut ni remplacer la primitive DO ni rendre active une configuration sans binding/migration réellement valides.

## Surface HTTP volontairement réduite

Le Worker ne route **aucune commande par HTTP**. En mode actif, seuls `GET /healthz` et `GET /status` peuvent répondre, après les gates existantes ; toute ancienne route de commande renvoie `404`, sans lecture de commande ni changement d’état. Les méthodes mutantes restent refusées. Le Durable Object ne possède pas de route publique : ses requêtes internes ne sont accessibles qu’au travers du binding.

L’agent Hostinger et ses modèles restent **sans modification, non installés et non exécutés**. Ils ne doivent pas être rendus compatibles par contournement. Une future révision distincte devra revoir un transport non-HTTP de commande, l’agent, le runtime et toutes les gates avant toute activation ; elle n’est ni préparée ni autorisée ici.

## Prérequis d’une révision de provisioning distincte

Une future PR, soumise à revue séparée, devra uniquement proposer et faire auditer, sans que ce document ne les exécute :

- la déclaration du binding isolé Lemtel `ARBITER_SERIALIZER` vers la classe exportée ;
- la migration Durable Object nécessaire pour créer cette classe sous un namespace adapté ;
- la vérification read-back du type de binding et de la migration, sans valeurs sensibles ;
- la preuve que le singleton stable est le seul namespace utilisé ;
- le maintien explicite de `FAILOVER_MODE=disabled` pendant cette revue.

L’absence, le mauvais type, la mauvaise classe, une migration non appliquée ou toute réponse non conforme du binding constitue un **blocage**, pas une raison de créer des valeurs de remplacement, un fallback KV, un déploiement, ou une activation.

Les autres gates restent toutes obligatoires : bootstrap scellé, configuration et échéance valides, drill destructif signé, confirmation de fencing, validation de promotion Hostinger, routing/LB séparés, failback manuel, retry mobile et preuve de writer unique. Voir [bootstrap scellé](SEALED_ARBITER_BOOTSTRAP.md), [protocole d’exécution](AUTOMATIC_FAILOVER_EXECUTION_PROTOCOL.md) et [gates actuelles](CURRENT_AUTOMATIC_FAILOVER_GATES.md).

## Validation locale sans réseau

```bash
node --check infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs
node --test scripts/lemtel-durable-object-serialization.test.mjs \
  scripts/lemtel-sealed-arbiter-bootstrap.test.mjs \
  scripts/lemtel-failover-execution-protocol.test.mjs
git diff --check
```

Les doubles de test sont uniquement des stockage/horloge/binding synthétiques en mémoire. Ils prouvent qu’aucune paire d’isolates concurrents ne reçoit deux leases, qu’une capability expirée ou de mauvaise révision est refusée, qu’un incident/action dupliqué est refusé, et que disabled n’appelle pas KV/DO/réseau. Ils ne constituent pas une validation du runtime Cloudflare, d’un binding réel, d’une migration réelle, d’un fournisseur, d’un fencing, d’un drill ou d’une promotion.
