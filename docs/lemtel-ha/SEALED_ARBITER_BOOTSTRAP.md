# Lemtel — bootstrap scellé de l’arbitre, préparé sans activation

## Périmètre et invariants

Cette révision fournit du **code et des tests locaux uniquement**. La correction de sérialisation Durable Object reste elle aussi source-only et non provisionnée ; voir [la note dédiée](DURABLE_OBJECT_SERIALIZATION_SOURCE_ONLY.md). Elle ne déploie rien et ne modifie aucun secret, binding, cron, agent, fournisseur, DNS, Load Balancer ou runtime réel. Le Worker actuellement désactivé doit rester désactivé. Aucun périmètre Planipret, Avastatistic, PBX/FusionPBX ou téléphonie n’est concerné.

| Mode exact | HTTP | Cron / effets autorisés |
|---|---|---|
| Absent, `disabled`, `dry_run`, inconnu | Bootstrap `404` ; autres chemins : statut statique de refus | **Aucune lecture/écriture KV, observation, action fournisseur, commande, promotion ou routage** |
| `bootstrap` | Un GET de clé publique et un POST authentifié/chiffré ; autres chemins `404` | Retour statique `configuration_injection_only`, sans lecture/écriture KV du cron ni action |
| `active` | Bootstrap `404` ; endpoints métier existants uniquement après toutes les gates | Config scellée et non expirée, reçu de bootstrap, drill signé et sérialisation obligatoires avant observation/fencing |

**Le POST ne change jamais `FAILOVER_MODE`** et ne délivre aucune commande. Tous les indicateurs existants restent à `false` : promotion automatique, démarrage runtime automatique, routage trafic automatique, failback automatique. Le routage n’est pas un toggle d’environnement : `ROUTING_ENABLED = false` reste dans le source.

## Bindings runtime requis — noms seulement

| Binding | Type / origine / durée |
|---|---|
| `FAILOVER_MODE` | Texte ; défaut `disabled`. Fenêtre humaine `bootstrap` très courte ; **retour obligatoire à `disabled` après la tentative**, succès ou échec. Jamais d’activation par cette procédure. |
| `STATE` | Workers KV isolé Lemtel avec `get`/`put`. Contient uniquement statuts redacted, marqueurs one-use et objets chiffrés ; **jamais un verrou de sérialisation**. |
| `ARBITER_SERIALIZER` | Namespace Durable Object isolé Lemtel, requis seulement si un futur mode `active` est revu. Le source attend `idFromName`/`get`, mais ce binding, sa classe et sa migration ne sont ni déclarés, ni provisionnés, ni exécutés ici. Son absence/mauvais type bloque avant tout fetch fournisseur/commande. |
| `CONFIG_REVISION` | Texte existant ; révision opaque ASCII `[a-z0-9-]`, 8–80 caractères. Nouvelle révision obligatoire après tout changement ou résultat incertain. |
| `CONFIG_DECRYPTION_PUBLIC_JWK` | Texte **non secret**, RSA 3072–4096 bits, exposant 65537, usage `encrypt`, algorithme JWK `RSA-OAEP-256`. Seuls les composants publics sont autorisés. |
| `CONFIG_DECRYPTION_PRIVATE_JWK` | **Secret runtime Cloudflare exclusivement**, correspondant exactement au JWK public ; nécessaire au POST, pas au GET ni au mode actif. Aucune valeur dans Git, bundle, fichiers locaux, arguments CLI/MCP visibles ou logs. |
| `BOOTSTRAP_AUTH_SECRET` | **Secret runtime Cloudflare exclusivement**, aléatoire, au moins 32 caractères ; preuve HMAC-SHA256 du POST. Nécessaire seulement pendant la fenêtre bootstrap. |
| `CONFIG_STATE_ENCRYPTION_KEY` | **Secret runtime Cloudflare exclusivement**, 32 octets aléatoires encodés base64url sans padding. AES-256-GCM pour la config, le reçu de drill et les incidents. À conserver pour toute leur durée de vie ; son absence/rotation bloque le déchiffrement. |

Les quatre secrets opérationnels (`DO_API_TOKEN`, `AGENT_SHARED_SECRET`, `DO_WRITER_L7_SECRET`, `DRILL_APPROVAL_SECRET`), l’identifiant writer, les URLs et limites **ne sont plus lus comme bindings opérationnels en clair**. Ils doivent être exclusivement dans `configuration` du payload scellé. Des anciens bindings portant ces noms ne permettent aucun fallback.

Après retour confirmé à `disabled`, les secrets de bootstrap et la clé RSA privée peuvent être retirés selon une procédure distincte et autorisée ; ne pas retirer la clé AES tant que les états protégés doivent être lisibles. Aucun de ces retraits n’est exécuté ici. Le contrôleur doit obtenir toute la configuration et les credentials de provisioning par un canal autorisé **en mémoire**, sans extraction de fichiers/secrets existants par ce livrable.

## Contrôleur unique en mémoire

`infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs` est une bibliothèque sans CLI, lecture de fichiers, environnement, logs, transport réseau ou provisioning intégré :

- `createBootstrapSession(configRevision)` génère RSA, secret HMAC et clé AES en mémoire et sépare `secretBindings`, `textBindings` et le descripteur public ; **ne jamais afficher/sérialiser la session dans une sortie de tâche** ;
- `createBootstrapEnvelope(...)` épingle le descripteur public reçu au descripteur généré localement et ne retourne que l’enveloppe chiffrée et sa preuve ;
- `injectBootstrapConfiguration(...)` permet **une seule tentative par session**, appelle les adaptateurs autorisés pour entrer en `bootstrap`, GET, POST puis revenir à `disabled` dans un `finally` ; aucun chemin `active` ;
- `sealDrillReceipt(...)` chiffre un reçu **déjà signé et approuvé séparément**. Il ne signe pas le drill et ne fournit aucune preuve d’approbation.

Les adaptateurs doivent interdire redirects/proxies, borner la réponse, utiliser HTTPS avec deadline courte et vérifier un read-back du mode lors de chaque changement. L’adaptateur `enterBootstrap` est limité à `bootstrap`, l’adaptateur `returnToDisabled` à `disabled`. Une réponse perdue est **inconnue**, pas une raison de relancer le même POST. Un retour à disabled non confirmé produit `bootstrap_disabled_reset_unconfirmed` et impose une intervention humaine, jamais un succès supposé.

Un seul processus autorisé doit conserver la session, les valeurs et l’API credential en mémoire. Pas de console Hostinger, fichiers temporaires en clair, historique shell, traces HTTP, journalisation des headers, request bodies, objets session/configuration ou exceptions brutes. Désactiver les diagnostics/coredumps et vérifier les surfaces de capture avant toute utilisation future. Le nettoyage de buffers est best-effort : JavaScript/GC ne garantit pas la zéroïsation des copies mémoire.

## Mécanisme exact, sans valeurs

Le provisioning **n’est pas fourni ni exécuté**. Il faut d’abord vérifier le schéma et les permissions d’un adaptateur runtime autorisé. Pour MCP, ne pas inventer de nom de commande et **ne jamais passer une valeur sensible inline dans les arguments enregistrés** : seule une référence de credential/configuration ou un transfert secret in-memory réellement pris en charge par le connecteur est admissible. Si le connecteur ne sait pas fournir ce canal, c’est un blocage ; employer un contrôleur API officiel en mémoire avec autorisation distincte, pas un collage console ni un fichier secret.

Contrat de l’intégration future (pseudocode, aucun adaptateur réel livré) :

```js
const session = await createBootstrapSession(opaqueRevision);
// Runtime secret API depuis le contrôleur privé : secret bindings, jamais variables texte.
await authorizedRuntimeSecretAdapter.putFromMemory(session.secretBindings);
await authorizedRuntimeTextAdapter.putFromMemory(session.textBindings);
// Read-back seulement des noms/types et du mode, JAMAIS des valeurs des secrets.
await authorizedRuntimeAdapter.confirmDisabledAndBindingTypes();
const result = await injectBootstrapConfiguration({
  session,
  configuration: await authorizedConfigSource.loadInMemory(),
  enterBootstrap: () => authorizedRuntimeAdapter.setAndConfirmMode('bootstrap'),
  returnToDisabled: () => authorizedRuntimeAdapter.setAndConfirmMode('disabled'),
  transport: request => authorizedPrivateWorkerTransport(request),
});
// Seul result, redacted, peut être restitué ; ne pas afficher session/configuration.
```

Le transport ne reçoit que :

1. `GET /.well-known/lemtel-failover-bootstrap-key` sans credential ; réponse exacte `{format, version, algorithm, kid, public_jwk}` ; épingle SHA-256 JWK vérifiée contre la clé générée localement.
2. `POST /.well-known/lemtel-failover-bootstrap`, `Content-Type: application/json`, header `x-lemtel-bootstrap-proof` contenant la preuve HMAC (pas le secret) et corps chiffré. Seul `201` indique acceptation ; erreurs génériques `401`/`409`, méthodes `405`, absence de route `404`.
3. Retour confirmé `disabled` par l’adaptateur runtime, **pas par un endpoint du Worker**. Le GET de bootstrap doit ensuite être indisponible. Une configuration injectée ne rend pas l’active prêt.

Aucune commande shell ou MCP contenant des valeurs sensibles n’est nécessaire ni documentée. Une autorisation pour ce mécanisme futur n’est ni incluse ni déduite des tests.

## Format de transport hybride RSA-OAEP SHA-256

Le RSA ne peut pas chiffrer directement une configuration complète (limite OAEP). Le protocole utilise donc **RSA-OAEP/SHA-256 pour envelopper une clé AES-256 éphémère**, puis AES-GCM pour chiffrer l’objet complet ; ce n’est pas du RSA de chunks ni du chiffrement AES seul.

L’enveloppe n’accepte que les champs suivants :

| Champ | Validation |
|---|---|
| `format`, `version`, `algorithm` | `lemtel_failover_bootstrap_v1`, entier `1`, `RSA-OAEP-256+A256GCM` |
| `kid` | Thumbprint base64url SHA-256 du JSON canonique `{e, kty, n}` de la clé publique |
| `config_revision` | Identique au binding courant, jamais choisi librement pour contourner la révision |
| `nonce` | 32 octets aléatoires base64url canonique, à usage unique |
| `issued_at`, `expires_at` | Secondes Unix entières ; pas d’issuance future ; encore valide à l’acceptation ; durée **maximum 300 secondes**, défaut contrôleur 120 secondes |
| `wrapped_key` | Clé AES éphémère de 32 octets enveloppée avec RSA-OAEP/SHA-256 |
| `iv`, `ciphertext` | IV aléatoire de 12 octets, AES-GCM avec tag 128 bits ; base64url canonique ; ciphertext déchiffré borné, corps HTTP maximum 65 536 octets |

Le JSON canonique trie récursivement les clés, garde l’ordre des tableaux et n’ajoute aucun espace. La preuve est HMAC-SHA256, hexadécimal minuscule de 64 caractères, sur :

```text
lemtel-failover-bootstrap-auth-v1\n + canonical(envelope)
```

La preuve couvre **tous** les champs, y compris les ciphertexts, nonce, dates, révision et kid. L’authentification est vérifiée avant le déchiffrement privé et avant toute écriture KV. Pour RSA-OAEP `label` et AES-GCM `additionalData`, employer les mêmes octets : contexte `lemtel-failover-bootstrap-transport-v1`, saut de ligne, JSON canonique de l’enveloppe **sans** `wrapped_key`, `iv`, `ciphertext`.

Le payload déchiffré a exactement `{format, config_revision, issued_at, expires_at, configuration}`, avec `format=lemtel_failover_protected_config_v1`. Révision et issuance doivent correspondre à l’enveloppe. Son échéance doit être au moins celle de l’enveloppe, mais au plus **3 600 secondes après issuance** ; le retour à disabled ne prolonge pas cette échéance. L’activation future, si autorisée, nécessite une injection fraîche et toutes les autres gates.

`configuration` a exactement les 12 champs opérationnels : quatre secrets, `DO_WRITER_DROPLET_ID`, `DO_API_BASE_URL`, `DO_WRITER_L7_URL`, `OBSERVATION_INTERVAL_SECONDS`, `INCIDENT_FAILURE_CYCLES`, `GRACEFUL_SHUTDOWN_DELAY_SECONDS`, `POWER_STATE_TIMEOUT_SECONDS`, `COMMAND_TTL_SECONDS`. Aucune clé inconnue, mode, flag d’activation, ACK textuel de sérialisation ou reçu de drill ne peut être ajouté. Les validations de sécurité existantes sont conservées : secrets de 32–4 096 caractères, ID positif, HTTPS sans credentials/query/fragment, chemin L7 **exact** `/lemtel-lb-ready`, bornes des cycles/délais et timeout strictement supérieur au délai graceful.

## Chiffrement à repos, replay et migration fail-closed

Après authentification et validation complètes, le Worker chiffre de nouveau le payload sous **une autre clé**, `CONFIG_STATE_ENCRYPTION_KEY`, avec un **nouvel IV aléatoire**, avant la première persistence. La clé AES transport et son IV ne sont jamais réutilisés comme clé/IV de stockage.

| Clé KV sous `lemtel_failover_execution_v1` | Contenu autorisé |
|---|---|
| `sealed-config:<revision>` | Record AES-256-GCM, métadonnées non sensibles uniquement ; jamais de configuration déchiffrée |
| `bootstrap-consumed:<revision>` | Marqueur redacted `{format, version}` one-use, **sans TTL** |
| `bootstrap-nonce:<sha256-base64url(nonce)>` | Même marqueur redacted, sans nonce brut ni TTL |
| `incident` | Incident **entièrement chiffré**, y compris reçu de fence/identité writer et commande HMAC |
| `production-drill` | Enveloppe de drill signé **entièrement chiffrée** ; le contrôleur peut préparer le ciphertext après une approbation distincte |
| `status` | État et raison reconstruits sur allowlist, rôles et flags false ; jamais de champ inconnu renvoyé depuis KV |

Record AES à repos : exactement `{format, version, algorithm, kind, config_revision, issued_at, expires_at, iv, ciphertext}`. `format=lemtel_failover_sealed_state_v1`, `version=1`, `algorithm=AES-256-GCM`, `kind` lie le record à `configuration`, `incident` ou `drill`. AAD : contexte `lemtel-failover-sealed-state-v1`, saut de ligne, JSON canonique du record **sans** `iv`/`ciphertext`. Un échange de kind/révision/date/ciphertext bloque. Échéance maximale du record : une heure ; la gate de signature de drill conserve sa validation existante maximum 24 heures, mais son wrapper chiffré expire au plus après une heure.

Les anciens incidents ou reçus de drill en clair ne sont **pas** migrés implicitement : ils bloquent. Ne pas les supprimer/réarmer pour contourner un incident incertain. Cette révision n’efface aucune donnée KV existante ; toute remédiation d’éventuelles valeurs historiques en clair exige une procédure séparée autorisée. Après expiration, le ciphertext peut rester dans KV ; il est inutilisable. Les marqueurs consommés ne doivent jamais être supprimés pour réutiliser une révision.

Le Worker brûle localement nonce et révision, écrit leurs marqueurs avant le record et refuse toute réécriture de config existante. Les résultats incertains ne permettent pas une nouvelle tentative de même session/révision. Un verrou d’isolate protège les POST locaux simultanés ; les marqueurs persistent au redémarrage.

> **KV reste non transactionnel, sans CAS et sans lecture globale immédiatement cohérente.** Il ne sérialise aucune exécution. La correction source ajoute le singleton Durable Object `LemtelFailoverSerializer`, son lease court et son ledger transactionnel ; elle remplace l’ACK textuel, mais **n’ajoute aucun binding ni migration**. Sans provisionnement audité distinct de `ARBITER_SERIALIZER`, l’active reste bloqué. Le détail et les limites sont dans [la note Durable Object](DURABLE_OBJECT_SERIALIZATION_SOURCE_ONLY.md).

En active, le Worker exige le marqueur de bootstrap, déchiffre chaque fois la config, vérifie la révision et la concordance exacte dates internes/record puis revalide tous les champs. Aucune config absente, plaintext, altérée, expirée ou indéchiffrable ne déclenche de fetch fournisseur/santé. Un lease Durable Object valide est requis avant toute observation, lecture fournisseur, fencing ou préparation de promotion, et revérifié avant chaque POST destructif. Les erreurs ne reflètent jamais secret, noms de champs sensibles, token, ID, URL ou exception brute.

Les endpoints bootstrap et de statut ne retournent jamais de valeur opérationnelle. En mode `bootstrap`, désactivé ou bloqué, **aucune commande n’est accessible par HTTP** : `/agent/command` retourne `404`. Les structures scellées de reçu/commande ne sont jamais en clair dans KV et ne sont jamais retournées dans le statut. En mode actif avec toutes les gates, la commande n’est remise qu’à l’agent authentifié, une seule fois (voir [protocole d’exécution](AUTOMATIC_FAILOVER_EXECUTION_PROTOCOL.md)).

## Gates restantes : aucune activation déduite du bootstrap

1. Installation/revue de l’agent **Hostinger**, preflight root-only, secret partagé distribué séparément sans console, ledger atomique, chaîne locale et preuves PostgreSQL/Storage.
2. **Binding/migration Durable Object réellement revus**, puis drill destructif signé de même révision/writer et échéance/HMAC valides ; aucun binding, migration ou reçu n’est livré par les tests.
3. Observation HTTPS L7 exacte, ambiguïté sans fencing, délai graceful, timeout, intention persistée avant POST, absence de retries destructifs ; **deux confirmations terminales et nouvelle vérification** avant commande.
4. Configuration et drill **Cloudflare LB/routage** dans une révision distincte ; aucun DNS/route/action trafic ici.
5. Procédure/drill de **failback**, toujours sans failback automatique.
6. Validation du **mobile retry** et du writer unique ; aucun simple retour de santé n’est une preuve suffisante.

Voir [protocole d’exécution](AUTOMATIC_FAILOVER_EXECUTION_PROTOCOL.md) et [gates actuelles](CURRENT_AUTOMATIC_FAILOVER_GATES.md).

## Vérifications locales sans réseau

```bash
node --check infra/lemtel-resilience/automatic-failover/lemtel-failover-arbiter-worker.mjs
node --check infra/lemtel-resilience/automatic-failover/lemtel-sealed-bootstrap-controller.mjs
node --test scripts/lemtel-failover-arbiter.test.mjs scripts/lemtel-durable-object-serialization.test.mjs scripts/lemtel-failover-execution-protocol.test.mjs scripts/lemtel-sealed-arbiter-bootstrap.test.mjs
node --test scripts/lemtel-current-topology-failover-gate.test.mjs scripts/lemtel-current-topology-failover-guards.test.mjs
git diff --check
```

Ces tests génèrent uniquement des clés/valeurs synthétiques en mémoire, simulent KV/horloge et remplacent global fetch. Ils ne valident pas un runtime Cloudflare réel, le provisioning des bindings, le LB, le fencing réel ni un drill de production.

### Résultat de validation sur le HEAD de base

Les trois suites obligatoires arbitre/protocole/bootstrap passent **50/50**, et les guards additionnels **3/3**. La suite additionnelle `lemtel-current-topology-failover-gate.test.mjs` a **deux échecs préexistants**, reproduits avec les fichiers exacts de `HEAD` : son validateur strict n’accepte pas le champ `prepared_execution_agent` déjà présent dans le contrat, ce qui bloque aussi le scénario de readiness complète (code `78` au lieu de `0`). Aucun de ces fichiers de gate/contrat n’est modifié pour masquer ces échecs. Ils demandent une révision séparée ; le comportement reste fail-closed.
