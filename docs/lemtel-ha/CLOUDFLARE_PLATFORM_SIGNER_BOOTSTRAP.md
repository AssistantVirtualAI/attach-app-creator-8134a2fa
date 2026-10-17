# Lemtel — bootstrap du signer de plateforme Cloudflare

> **Statut : source-only, non déployable.** Le signer Cloudflare déployé reste sans binding, sans policy utilisable, sans ledger et sans route active. Les sources de ce répertoire ne créent ni secret, ni certificat, ni service, ni route de failover, ni promotion.

## État réellement attesté

Un hostname dédié `signer.lemtel.assistantvirtualai.com` existe et est protégé par Cloudflare Access en **default-deny**. Le Worker reste non exposé par `workers.dev` et ne peut pas être invoqué sans la configuration explicite attendue. Aucun service token n’existe encore, aucune policy Access `service_auth` n’est attachée, aucun binding Secrets Store, Durable Object ou variable de production n’est présent.

La clé de plateforme reste un secret write-only attendu uniquement dans un binding Cloudflare Secrets Store. Elle n’est jamais affichée, stockée dans le dépôt, ajoutée à un gist, une commande ou un journal. L’implémentation ne lit ce binding qu’après contrôle de l’hôte, de l’assertion Access, du certificat mTLS, de l’autorisation d’enrôlement et du ledger anti-rejeu.

## Interface source-only vérifiable

L’unique endpoint prévu est un `POST` HTTPS sur `/v1/node-enrollment-delivery` du hostname exact. Le body canonique contient seulement une remise chiffrée d’enrôlement, son `requestId`, le rôle de nœud admis, l’empreinte du destinataire et une autorisation d’enrôlement signée à durée courte.

Le Worker refuse toute variante d’hôte, de chemin, de méthode, d’origine navigateur, de forme JSON, d’encodage Base64URL, de rôle ou de taille. Il ne fait aucun appel HTTP sortant : le jeu de clés public Access doit être fourni par un binding de configuration redacted et mis à jour de manière contrôlée pendant une rotation Cloudflare Access. Toute absence ou incohérence répond par un résultat redacted et ne signe rien.

L’autorisation d’enrôlement lie précisément le `requestId`, le rôle, l’empreinte du nœud, le challenge, le digest de la remise et son expiration. Elle est vérifiée avec une clé publique distincte. Le transcript signé renvoie ces mêmes éléments. Ce signer n’est donc pas un oracle de signature générique.

## Identité mTLS et Access

Le futur relais DO root-only doit posséder une identité mTLS dédiée, distincte de toute clé de nœud, de plateforme, d’arbitre et de fournisseur. Cloudflare Access doit appliquer une policy `service_auth` au **Common Name exact** attendu. Le Worker doit simultanément vérifier :

- le JWT Access signé avec l’émetteur et l’audience de l’application ;
- `request.cf.tlsClientAuth.certVerified === "SUCCESS"` et `certRevoked === "0"` ;
- l’empreinte SHA-256 et le sujet RFC2253 attendus du certificat client ;
- l’autorisation d’enrôlement à finalité unique et son ledger anti-rejeu.

Les claims non documentés comme `sub`, `type` ou une identité implicite ne constituent pas une autorisation. Une durée de ledger est au moins égale à l’expiration la plus courte du JWT Access et de l’autorisation d’enrôlement. Le Durable Object programme son nettoyage à l’expiration et ne rouvre jamais une requête encore valide.

## Relais root-only, non installé

Le modèle systemd garde un relais Python root-only non installable. Il accepte un seul pair UID via socket Unix, canonicalise le message, utilise uniquement les credentials systemd chiffrés montés au runtime, et joint seulement le hostname et le chemin fixes. Après une tentative sortante, une réponse ne peut être renvoyée que si son `requestId`, rôle, empreinte et remise correspondent exactement à la requête. Tout timeout ou état incertain renvoie seulement `{"result":"unavailable"}` et ne doit jamais être relancé automatiquement.

Le relais ne fournit aucune installation, aucun socket permanent et aucune configuration active. Un socket orphelin ne peut être supprimé qu’après vérification stricte de son type, propriétaire, groupe et mode ; toute autre entrée bloque le démarrage.

## Préconditions obligatoires avant tout déploiement

1. Revue de sécurité indépendante et correction de chaque finding `NO_GO`.
2. Credential mTLS chiffré root-only attesté, isolation du socket depuis le conteneur Edge autorisé et test de redémarrage sécurisé.
3. Création séparée d’un certificat mTLS dédié, avec drill de rotation et révocation. Aucun certificat existant ne peut être réutilisé.
4. Policy Access `service_auth` au Common Name exact, testée avec certificat valable, certificat révoqué, mauvaise empreinte, mauvais sujet et sans certificat.
5. Clé publique de l’autorité d’enrôlement et jeu de clés Access versionnés/configurés sans secrets, avec tests de rotation, expiration et indisponibilité. L’absence doit rester fail-closed.
6. Service d’autorisation d’enrôlement à usage unique, autoritaire et audité ; un nœud ne peut pas choisir sa propre empreinte, rôle, challenge ni expiration.
7. Binding Secrets Store write-only, Durable Object anti-rejeu, `compatibility_date` Worker explicite et testés dans un environnement isolé. Aucune route Worker, aucun `workers.dev` et aucun preview public ne doit être activé.
8. Déploiement Edge/enrôlement attesté puis publication redacted d’un seul nœud à la fois, avec timers encore désactivés.

Même après ces étapes, le signer autoriserait au plus l’enrôlement de publication redacted. Il ne remplacerait jamais les gates L7, Node Status, trafic, fencing, promotion, runtime Hostinger, routage Cloudflare de failover, failback ni retry client requis pour un failover automatique.

## Références

[1]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ "Cloudflare Access JWT validation"

[2]: https://developers.cloudflare.com/ssl/client-certificates/client-certificate-variables/ "Cloudflare client certificate variables"

[3]: https://developers.cloudflare.com/workers/runtime-apis/request/ "Cloudflare Workers Request cf metadata"

[4]: https://developers.cloudflare.com/workers/configuration/compatibility-dates/ "Cloudflare Workers compatibility dates"
