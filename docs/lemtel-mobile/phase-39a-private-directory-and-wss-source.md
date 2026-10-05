# Phase 39A — Sources Lemtel-only : annuaire privé, lookup d’appelant et diagnostic WSS

## But et état

Cette phase ajoute les **sources offline seulement** qui permettront ultérieurement à une installation Lemtel auto-hébergée de remplacer trois comportements historiquement liés à Planiprêt :

1. un petit annuaire de contacts appareil **privé au membre**;
2. une recherche d’appelant qui ne consulte que cet annuaire privé;
3. une télémétrie WSS de fallback minimisée, sans URL ni secret.

Aucune migration n’est appliquée, aucune fonction Edge n’est déployée, aucun client n’est coupé vers Lemtel et aucune donnée de contact n’est importée. Le paquet Edge déjà scellé de phase 37A reste volontairement limité à ses deux fonctions précédentes.

## Structures proposées

La migration `0002_lemtel_private_directory_and_wss_diagnostics.sql` crée, dans une base Lemtel vide uniquement :

| Structure | But | Isolation |
| --- | --- | --- |
| `lemtel_contacts` | Contacts provenant d’un appareil, enregistrés après consentement explicite | `(organization_id, owner_user_id)`; lookup restreint au membre propriétaire. |
| `lemtel_wss_diagnostic_events` | Événements de fallback WSS minimisés | `(organization_id, actor_user_id)`; aucun WSS brut, aucun mot de passe SIP ni corps de réponse. |

Les accès directs `anon` et `authenticated` sont révoqués. La RLS est activée; les Edge Functions utilisent une clé de service uniquement après authentification du token et validation de l’adhésion active à l’organisation.

## Fonctions source uniquement

| Fonction | Opérations | Ne fait pas |
| --- | --- | --- |
| `lemtel-contacts` | Enregistre par upsert des contacts appareil limités et liste les contacts du propriétaire | Annuaire partagé, import Planiprêt, synchronisation CRM, écriture sans consentement client. |
| `lemtel-caller-lookup` | Cherche un numéro E.164 dans les contacts du membre authentifié | Recherche inter-utilisateur, Maestro/Microsoft, PBX ou données externes. |
| `lemtel-wss-diagnostics` | Enregistre ID d’endpoint, code de panne et latences bornées | Accepte/stocke une URL WSS brute, identifiant SIP, corps de réponse ou payload libre. |

## Prérequis avant toute activation future

1. Autorisation explicite d’appliquer **seulement** la migration Lemtel 0002 sur le staging, après sauvegarde/restauration fraîche;
2. comptes Auth de test et adhésions Lemtel de test; validation RBAC synthétique;
3. décision produit sur le consentement explicite de synchronisation de contacts appareil et sur la rétention des diagnostics WSS;
4. ajout formel des trois fonctions à un nouveau paquet de déploiement, vérification des hashes, router/import map et smoke tests lecture seule;
5. préparation client avec `organizationId` fiable, sans rendre le projet Lovable actuel ou `Planipret` éligible;
6. tests sur appareils physiques avant toute distribution.

## Limites importantes

- L’annuaire v1 est **privé au propriétaire de l’appareil**; il ne remplace pas encore un annuaire d’entreprise partagé.
- Les données contact restent optionnelles : sans consentement, aucune donnée appareil ne peut être envoyée au serveur.
- Le lookup sans match retourne seulement le numéro; il n’expose jamais les contacts d’un autre membre.
- Les diagnostics WSS ne remplacent pas la configuration SIP/WSS/TURN ni les tests FusionPBX avec Kenny et Phil.
- Cette phase n’active ni RESTIC, ni le standby DO, ni DNS, ni livraison GitHub/Lovable.

## Vérification offline

```sh
node --test scripts/lemtel-private-directory-and-wss-source.test.mjs
```

Le test vérifie l’isolement Lemtel, les limites de payload, l’autorisation désactivée, l’absence de Planiprêt/PBX/Storage et le fait que les trois fonctions ne sont pas incluses dans le paquet Edge déployable actuel.
