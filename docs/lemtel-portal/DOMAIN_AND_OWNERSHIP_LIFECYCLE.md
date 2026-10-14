# Cycle de vie Lemtel — domaines et propriétaire d’organisation

> Ces commandes sont des opérations d’administration Lemtel-only. Elles ne créent ni route DNS, ni intégration PBX/SIP, ni donnée téléphonique, et ne lisent pas de contenu de communication.

## Domaine applicatif

| Action | Autorisation | Effet Lemtel | Effet exclu |
|---|---|---|---|
| Suspendre | `owner` ou `admin` actif de l’organisation | Le registre Lemtel passe à `suspended`; événement d’audit redacted. | Aucun DNS, routage, PBX, session métier ou fournisseur. |
| Réactiver | `owner` ou `admin` actif de l’organisation | Le registre Lemtel passe à `active`; événement d’audit redacted. | Aucune vérification DNS n’est forcée; le statut de vérification reste distinct. |

Un domaine reste unique et lié à une organisation. L’accès d’une personne découle de son membership actif, jamais d’une liaison directe utilisateur–domaine.

## Transfert de propriété

1. Seul le **propriétaire actif actuel** peut transférer son rôle à un membre actif existant de la même organisation.
2. L’opération est atomique : l’ancien propriétaire devient `admin`, le destinataire devient `owner`, puis l’audit Lemtel append-only est écrit dans la même transaction.
3. L’Edge Function revalide le jeton, l’organisation, le rôle actif et la cible. Le portail ne reçoit aucune donnée supplémentaire ni aucun droit implicite.
4. Le trigger existant de révision d’autorité de compte invalide les états clients périmés après les changements d’adhésion.

Les propriétaires ne sont ni rétrogradés ni suspendus par les commandes ordinaires; le transfert explicite maintient donc toujours un owner actif.
