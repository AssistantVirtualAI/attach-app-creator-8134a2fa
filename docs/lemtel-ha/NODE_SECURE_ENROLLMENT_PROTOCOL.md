# Lemtel — enrôlement cryptographique de publication, source-only

> **Aucun déploiement, secret runtime, installation, activation ou PR distante.** Ce paquet prépare uniquement l'enrôlement et la publication d'observations redacted. Une preuve de possession d'une clé n'est **jamais** une preuve d'identité d'un serveur DigitalOcean ou Hostinger.

## Isolation et comparaison des sources

Base : `origin/lemtel/integration`, PR #275, commit `7daec6cde`. Le contrat de statut existant, son publisher HMAC, ses migrations/manifestes, le bootstrap scellé de l'arbitre et l'agent de failover Hostinger ont été consultés, **pas modifiés ni exécutés**. Aucun fichier Planiprêt, Avastatistic, PBX, failover, routage ou frontend n'est modifié.

Le bootstrap scellé inspire les contextes cryptographiques et l'usage unique, mais **aucune** de ses clés, bindings, callbacks de contrôle, commandes ou configurations n'est réutilisée. Le nouvel agent ne dépend pas de l'agent Hostinger et ne lit aucun de ses fichiers runtime.

Le flux préparé est :

```text
clé locale root-only -> empreinte hors bande -> invitation admin plateforme
-> challenge public -> attestation de possession (toujours unverified)
-> vérification hors bande + seconde approbation explicite admin plateforme
-> claim signé unique -> config chiffrée -> autorisation Edge courte et liée
-> relais local mTLS -> signature de plateforme Cloudflare sur le scellé
-> observation signée -> snapshot redacted PR275 -> lecture admin existante
```

## Identité : distinction non négociable

- Le rôle `do_writer` ou `hostinger_standby` est une **affectation administrative**, pas une identité cloud découverte ou attestée.
- L'invitation nécessite une session Auth validée côté serveur, un admin plateforme actif et l'empreinte complète obtenue d'un canal indépendant authentifié vers le nœud voulu. Ni email, IP, hostname, tenant admin, nom de VM ou métadonnée fournisseur n'est une preuve substituable.
- La réponse d'attestation est vide. Le portail voit `pending_unverified`, jamais « serveur authentifié » ou « healthy » pour une demande d'enrôlement.
- L'approbation requiert `APPROVE_PUBLICATION_ONLY`, `OUT_OF_BAND_KEY_VERIFIED`, l'identifiant exact, le rôle exact et l'empreinte complète repinnée. Le serveur ne peut vérifier la réalité du contrôle humain hors bande : **absence ou doute = ne pas approuver**.
- `approved_publication_only`/`delivered_publication_only` autorisent une clé à soumettre des observations pour un rôle; ils ne prouvent pas que les observations reflètent l'état réel du fournisseur. Les états restent déclaratifs; aucun probe runtime n'est fourni.

## Machine d'état et bornes

| Transition | Autorité et conditions |
|---|---|
| absent → invited | Auth + admin plateforme actif; empreinte complète pin hors bande; confirmation `PIN_OUT_OF_BAND_PUBLIC_KEY`. UUID v4 opaque, nonce public unique, TTL 300 s; au plus 16 invitations vivantes par rôle. |
| invited → pending | ECDSA valide sur le challenge exact et fingerprint du **descripteur complet**; rôle/id/nonce/TTL concordants; mutation compare-and-set atomique. La possession n'authentifie pas le serveur. |
| pending → approved | Admin plateforme revalidé et verrouillé transactionnellement; confirmation + preuve humaine explicites; rôle/empreinte exacts; demande encore vivante; un seul grant approuvé/délivré par rôle. Nouveau nonce, claim TTL 300 s, grant publication 3600 s maximum. |
| approved → delivered | Claim signé, clé approuvée et nonce exacts; consommation durable **avant** chiffrement, autorisation du signer et réponse. Le signer Cloudflare ne signe que le scellé exact après mTLS, Access, autorisation canonique expirant vite et ledger anti-rejeu. Remise chiffrée signée une seule fois. |
| delivered → observation | Clé approuvée, grant vivant, rôle/empreinte exacts, ECDSA, minute UTC et six enums PR275; séquence positive croissante consommée dans la transaction d'observation. |
| any nonrevoked → revoked | Admin plateforme actif, identité de grant exacte, confirmation `REVOKE_PUBLICATION_ONLY`; aucun effet sur un runtime. |

Une expiration ne revient jamais à un état précédent. Les grants expirés gardent le slot de rôle : révocation explicite nécessaire pour un remplacement. Rejeu, expiration, rôle/empreinte/nonce différents, champ supplémentaire, corps ambigu/dupliqué/non canonique, état absent, donnée DB inattendue ou panne ne produisent aucune config ni observation acquittée. Pas d'auto-renouvellement, de récupération, de réactivation ni de retry.

Un claim dont la réponse est perdue ou un état local partiellement écrit exige une revue humaine : révoquer et recommencer avec une **nouvelle** invitation. La remise n'est pas un protocole exactly-once de livraison fiable; c'est un protocole **at-most-once fail-closed**. Une erreur SQL connue peut faire rollback, mais le client ne doit pas retenter automatiquement un résultat incertain.

## Crypto et wire contract v1

Bibliothèque pure : `infra/lemtel-self-hosted/functions/_shared/lemtelNodeEnrollment.ts`.

- Deux paires **distinctes** P-256 locales : ECDSA/SHA-256 pour attest/claim/observations et ECDH pour confidentialité. Descripteur exact `{signingKey,encryptionKey}`, points SEC1 non compressés de 65 octets, base64url strict sans padding. Imports WebCrypto valident la courbe; même clé pour deux usages refusée.
- Fingerprint `sha256:<64 hex>` du UTF-8 `lemtel-node-enrollment-v1:descriptor\n` suivi du JSON canonique du descripteur. L'affichage autorisé est cette empreinte publique complète, **pas** une clé, IP ou hostname. Une empreinte abrégée ne suffit jamais à approuver.
- Transcript : `lemtel-node-enrollment-v1:<purpose>\n<canonical JSON>`, purpose dans `attest`, `claim`, `observe`, `seal`, `delivery`. Clés d'objets triées lexicographiquement, JSON compact, nombres entiers sûrs. Signatures ECDSA WebCrypto P1363 de 64 octets, pas DER. Les finalités ne sont pas interchangeables.
- Nonces : deux UUID v4 concaténés sans tirets, 64 hex contenant 244 bits aléatoires; ils sont **publics**, pas des secrets bearer. Le secret d'autorisation est la clé privée, plus l'approbation d'état. Index SQL unique, challenge d'attestation consommé par changement d'état, nonce remplacé à l'approbation et consommé au claim.
- Scellage : ECDH éphémère P-256, HKDF/SHA-256, salt = UTF-8 du nonce, info = transcript `seal` du challenge. AES-256-GCM, IV aléatoire 96 bits, tag 128 bits, AAD = même transcript. Challenge bind id/rôle/empreinte/finalité/nonce/expiry.
- La clé publique destinataire **n'authentifie pas l'expéditeur d'un AEAD** : toute personne connaissant cette clé pourrait produire un autre scellé. Une signature ECDSA séparée de plateforme sur le scellé complet (`delivery`) est donc **obligatoire**, avec clé publique épinglée localement root-only. La clé de remise vit uniquement dans le coffre Cloudflare lié au Worker signer; l'Edge ne peut émettre qu'une autorisation courte, déterministe et liée au scellé après le claim. Aucun fallback TLS-only, signer local ou TOFU n'est permis. Le endpoint de publication doit également correspondre exactement au pin local.
- Remise `{sealed:{challenge,ephemeralKey,iv,ciphertext},signature}` uniquement au nœud ayant signé son claim. Rien n'est retourné au portail, sauf métadonnées allowlist. Aucune clé privée ou valeur HMAC n'est dans le payload.
- Config claire après déchiffrement : `{format,requestId,role,fingerprint,endpoint,grantedUntil}` seulement. Aucun shell, instruction, config runtime, provider credential, secret d'arbitre ou URL d'action. Endpoint DNS HTTPS canonique, chemin exact `/functions/v1/lemtel-node-status-signed-ingest`, aucun port explicite, userinfo, IP littérale, query ou fragment.

Les primitives sont standard WebCrypto disponibles dans Deno/Cloudflare. Les tests exécutent Deno et le moteur PostgreSQL WASM PGlite; **aucun Worker Cloudflare ni runtime distant n'est testé**. Les Edge wrappers sont Deno/Supabase, pas des Workers complets. Les clés JWK extractables ne sont pas un HSM, TPM ou attestation matérielle. Les copies JS ne sont pas fiablement zeroisables; effacement du buffer ECDH best-effort seulement. Une compromission root, de service role, de la clé de signature plateforme, de l'admin/hors bande ou de la chaîne logicielle sort du modèle de protection.

## Fonctions Edge et permissions

| Source | Actions / sortie |
|---|---|
| `lemtel-node-enrollment` | POST `challenge`, `attest`, `claim`; challenge public, attest 204 vide, claim scellé signé uniquement après approbation par le signer externe. Sans flag explicite, autorisation Edge valide et relais local borné, la réponse est 503. `Origin`/`Sec-Fetch-Mode` refusés, pas de CORS. Aucun endpoint de commande. |
| `lemtel-node-enrollment-admin` | POST `invite`, `read`, `approve`, `revoke`; token Bearer vérifié par Auth, admin plateforme actif, SQL reverrouille sa membership; pas de droits tenant-admin. Réponse uniquement `requestId,role,fingerprint,state,expiresAt`. Aucune clé, nonce, signature, ciphertext ou config. |
| `lemtel-node-status-signed-ingest` | POST envelope signée publication-only; réponse 204 vide; grant livré/vivant et séquence croissante vérifiés dans SQL. Payload de statut PR275 inchangé dans un champ string. Origin/Sec-Fetch-Mode refusés. |

Corps JSON canonique compact et UTF-8 strict obligatoire; cap streaming 2048 octets enrollment, 768 admin, 1024 signed-status. Pas de logs applicatifs, CORS wildcard, GET bearer, query parameter, cookie auth, retour d'erreur brute ou de row brute. `no-store`/`nosniff` partout. Le DB/backend a un timeout 2 s. Les tables et RPC ne sont jamais directement accessibles à `anon`/`authenticated`. `service_role` n'a aucun SELECT/INSERT direct sur les tables d'enrôlement/audit : uniquement RPC limités. Les erreurs DB ne sont jamais sérialisées.

Les RPC machine ne refont pas ECDSA dans PostgreSQL : la frontière de confiance est l'Edge service-role qui vérifie la preuve **avant** chaque RPC. Les RPC admin n'acceptent l'acteur que du token Auth validé; le body ne peut jamais le choisir. Helpers de lecture brute internes non exécutables par service role. Audit transactionnel limité à request/event/actor/time; aucun événement d'observation ou corps d'échec conservé dans cet audit.

## Agent local et état root-only

`infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts` est un **préparateur de publication hors réseau**, pas un agent installé ni un transport automatique. Il ne contacte aucun endpoint et ne lance aucun sous-processus. Modes source : `init`, `check`, `attest`, `claim-proof`, `accept`, `observation-proof`. Aucun mode runtime, commande distante, DNS, promotion, fencing ou failover.

Une phase future autorisée doit préparer les répertoires root:root 0700 `/etc/lemtel-node-publication` et `/var/lib/lemtel-node-publication`. Tous fichiers sont réguliers, root:root 0600, un seul lien, pas de symlink; chaque parent est root-owned et non writable groupe/autres. Lecture vérifie inode/dev à l'ouverture; écritures `createNew`, fsync fichier et parent, pas d'overwrite/rotation. Ces contrôles supposent un root fiable et Linux; les permissions de fichiers ne protègent pas d'un root compromis.

- `keys.json` contient clés privées **et descripteur public root-only**. `init` exige une gate locale explicite non secrète, n'écrit que ce fichier et n'affiche que l'empreinte publique. Ce mode **n'a pas été exécuté sur un nœud**.
- `binding.json` : identifiant/rôle/empreinte, endpoint DNS API épinglé et `platformSigningKey` publique épinglée par un canal authentifié indépendant; aucun TOFU depuis un challenge.
- `challenge.json`, `sealed.json` sont des inputs root-only canoniques; ils ne sont jamais dumpés. `accept` crée d'abord le ledger claim consommé puis vérifie signature de plateforme/pins/AEAD/TTL avant `publication.json`.
- Preuves publiques et observations signées sont écrites uniquement dans des fichiers 0600, jamais stdout/argv ou logs. Le ledger de séquence crée un slot durable avant préparation; conflits et absence d'état attendu bloquent. Aucun état système n'est automatiquement inventé : l'observation fournie doit être redacted et validée.
- systemd `.service`/`.timer` sont sources **disabled** sans `[Install]`, avec marker d'activation absent et réseau interdit. Leur seule action serait `check`, jamais génération, publication ou runtime. Aucun fichier n'a été installé/activé.

## Prérequis d'une phase ultérieure (non autorisée ici)

1. Approbation séparée du schéma/paquet Edge, revue RLS/RBAC en PostgreSQL cible et vérification des digests. Aucun apply dans ce travail.
2. Revue des nouveaux chemins privés avec auth adaptée (pas de JWT gateway sur machine signée, Auth obligatoire sur admin), limites de débit/body/deadline; aucun endpoint ajouté au routage existant ici.
3. Désactiver/rendre injoignable **l'ancien chemin HMAC de PR275 avant activation** des publications par clé si l'on veut une autorité unique. Il est inchangé et aucune migration de runtime n'est faite. Une coexistence non examinée serait ambiguë et est un blocker, pas une permission de fallback.
4. Provisionnement séparé du signer externe Cloudflare : clé de remise write-only dans le coffre, pin public root-only sur les nœuds, Access service-auth et mTLS relay avec certificat dédié chiffré. L'autorité Edge émet une clé d'autorisation distincte, jamais réutilisée pour remettre une config, conservée uniquement dans un backend runtime approuvé. Aucune de ces valeurs n'est créée, lue ni transmise par ce travail. Aucun private key dans navigateur/CLI/env file Git/log.
5. Config endpoint serveur non secret `LEMTEL_NODE_PUBLICATION_ENDPOINT`, flag explicitement approuvé `LEMTEL_NODE_ENROLLMENT_ENABLED=approved_publication_only` **et** `LEMTEL_EXTERNAL_PLATFORM_SIGNER_ENABLED=approved_delivery_only`; l'autorité requiert aussi son identifiant de clé public et son matériau privé runtime. Défaut **503**, aucun appel DB, signer ou secret env avant gate dans les tests.
6. Revue logs Edge/gateway/proxy/Postgres : pas de body, clé, signature, ciphertext, token, paramètres SQL sensibles ni métriques identifiantes; rétention/cleanup audit et invitations tombstones à définir. Le code ne peut garantir la config de logs d'un service externe.
7. Transport node→API root-only non fourni : HTTPS vérifié, endpoint local épinglé, aucun proxy/redirect/retry, taille/deadline bornées et sorties silencieuses. Le transport ne doit jamais envoyer un ciphertext/secret au portail, exposer le hostname/IP du nœud en payload ou réutiliser une clé d'arbitre. Cette revue est nécessaire avant réduction effective des gestes console.
8. Installation/activation locale, validation permissions et clock sync, rollback par révocation du grant et arrêt publisher; décisions humaines séparées. Aucun grant n'autorise runtime, promotion, DNS, routage ou failover.

## Validation hors ligne reproductible

Tests synthétiques uniquement, sans accès aux valeurs runtime. Deno n'a besoin d'aucune permission env/net/read pour les unit tests après résolution des modules. PGlite est une dépendance **test-only**; il utilise un DB en mémoire avec fixtures Auth minimales, pas une URL distante.

```text
deno check --no-config --no-lock --node-modules-dir=none infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.ts infra/lemtel-self-hosted/functions/lemtel-node-enrollment-admin/index.ts infra/lemtel-self-hosted/functions/lemtel-node-status-signed-ingest/index.ts infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-agent.ts
deno test --no-config --no-lock --node-modules-dir=none infra/lemtel-self-hosted/functions/lemtel-node-enrollment/index.test.ts infra/lemtel-self-hosted/functions/lemtel-node-status-ingest/index.test.ts
node --test scripts/lemtel-node-secure-enrollment-postgres.test.mjs
node scripts/lemtel-node-secure-enrollment-contract.test.mjs
node scripts/lemtel-node-status-observability-contract.test.mjs
```

Le test PGlite vérifie des appels concurrents soumis au même moteur sérialisé, pas un stress-test multiconnexion de PostgreSQL distant. Les garde-fous réels sont les UPDATE conditionnels/verrous/transactions et l'index unique; un test multiconnexion en PostgreSQL cible reste un gate séparé. Aucun test ne prouve une identité de nœud réel ou la confidentialité des logs d'un déploiement.

### Résultats de cette préparation

- Deno **2.9.6**, Node **22.13.0**, PGlite **0.5.10** installés/utilisés uniquement comme outillage local de tests, hors du dépôt applicatif.
- `deno check` : les trois Edge handlers et l'agent local passent. `deno lint` : sept fichiers TypeScript passent; seule la règle stylistique `require-await` est explicitement ignorée pour les mocks Promise du fichier de test.
- **9** tests Deno d'enrôlement/crypto/contrat local et **5** tests d'ingestion PR275 passent sans permissions env/net/read. Les clés utilisées sont fixtures éphémères synthétiques en mémoire, jamais persistées ou affichées; aucun `init` runtime n'a été exécuté.
- **5** tests admin `node-status` existants passent dans un processus `env -i` avec seulement les deux noms env de fixtures autorisés. Le test existant qui sauvegarde l'env ne peut donc lire aucune valeur runtime réelle.
- PostgreSQL WASM en mémoire : **7 sous-tests + 1 test parent**, tous passent (RLS, RBAC, absence, mismatch, expiration, grant unique, claims concurrents sérialisés, rollback d'audit, replay/séquence, révocation).
- Contrat nouveau, digests générés et contrat PR275 : passent. Les fichiers legacy sont inchangés, leurs digests PR275 concordent.
- Aucun schéma distant, secret runtime, route, agent, service/timer ou failover n'a été créé, lu, installé ou activé. Aucun push ou PR distante.

Le générateur de sidecars est `scripts/lemtel-node-secure-enrollment-manifests.mjs`; il ne fait que calculer/écrire des digests de sources connues dans ce paquet. Il faut le relancer après toute modification source, puis rerun le contrat. La dépendance serveur nouvelle est épinglée au niveau supérieur à Supabase JS `2.117.2`; lock/audit des transitives et packaging offline de l'agent restent une gate avant tout déploiement.
