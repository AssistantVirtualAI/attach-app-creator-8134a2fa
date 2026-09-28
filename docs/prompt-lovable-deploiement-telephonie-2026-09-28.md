# Prompt Lovable — déploiement contrôlé du correctif téléphonie

Déploie **uniquement** le code déjà présent dans la branche `Planipret` aux commits `778d89e92` et `66b4a96a9`. Ne crée aucune migration SQL. Ne construis ni n’active OTA, IPA, AAB ou release store.

## Fonctions à déployer

Déploie uniquement ces quatre fonctions Edge, avec leurs dépendances locales déjà importées :

- `ns-webhook-receiver`
- `pp-ns-calls`
- `ns-calls`
- `pp-ns-did-announcement`

Conserve exactement la configuration d’authentification actuelle de chaque fonction. Ne modifie pas `verify_jwt`, les secrets, les clés SIP, les jetons Maestro, les identifiants OAuth, les variables d’environnement, les DID, les devices, les règles d’appel, les files ou les answering rules.

## Comportement attendu du code déployé

`ns-webhook-receiver` doit lancer les pushes iOS et Android indépendamment du broadcast Realtime optionnel. Une erreur de persistance locale ou de Realtime ne doit donc pas bloquer le push urgent. Le traitement post-appel doit être gardé par `EdgeRuntime.waitUntil`. Les directions CDR inconnues doivent être normalisées ou laisser la valeur locale existante intacte.

`pp-ns-calls` et `ns-calls` doivent résoudre `planipret_profiles.id` avant toute insertion dans `planipret_phone_calls`. Une erreur de persistance ne doit jamais être avalée silencieusement. Le chemin REST `answer` de `ns-calls` doit répondre `409 answer_disabled_use_sip_dialog` : seul le dialogue SIP vivant peut envoyer le `200 OK` d’un appel entrant.

`pp-ns-did-announcement` doit rester **fail-closed**. `diagnose` et `autoheal` sont en lecture seule. Aucun auto-heal ne doit se déclencher au cold start, via en-tête HTTP ou via une tâche de fond. `repair_queues`, `enable` et `disable` exigent une confirmation explicite et ne doivent pas être appelés pendant ce déploiement. `probe_queue` doit rester désactivé.

## Interdictions absolues

Ne réactive pas les quatre tâches suspendues :

- `pp-devices-expiry-guard-6h`
- `pp-did-guardian-2h`
- `pp-did-guardian-snapshot-daily`
- `pp-did-reconcile-daily`

Ne lance aucun appel réel, aucun SMS réel, aucune mutation de configuration NetSapiens, aucun provisioning automatique, aucun changement de device, de DID, de call queue ou de caller ID. Ne teste pas le POST d’appel ni l’envoi SMS.

## Vérification après déploiement

Fais seulement les contrôles sûrs suivants et retourne un rapport concis avec le statut HTTP et le `correlation_id` s’il existe :

1. Vérifie que les quatre fonctions répondent en JSON et démarrent sans erreur de compilation.
2. Vérifie qu’un appel non authentifié à `pp-ns-calls` et `ns-calls` est refusé selon leur protection actuelle.
3. Vérifie que `ns-webhook-receiver` rejette un secret partagé invalide, sans traiter d’événement.
4. Vérifie que `pp-ns-did-announcement` refuse une écriture sans la confirmation textuelle requise. Utilise uniquement une action qui n’appelle pas NetSapiens ou un test de contrôle de forme ; ne lance pas `repair_queues`, `enable` ni `disable`.
5. Confirme explicitement que les quatre crons ci-dessus sont toujours suspendus.

Le rapport final doit distinguer clairement : **code déployé et contrôles de sécurité réussis** versus **appels physiques, SMS physiques et recette CallKit/Android encore non réalisés**. Ne déclare pas les appels fonctionnels avant les recettes sur appareils réels.

## References

[1]: https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/commit/778d89e92 "Correctif CallKit, PJSIP, WebRTC et fonctions Edge"
[2]: https://github.com/AssistantVirtualAI/attach-app-creator-8134a2fa/commit/66b4a96a9 "Normalisation du manifeste Android wake-only"
