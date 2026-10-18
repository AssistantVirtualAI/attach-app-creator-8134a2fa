# Lemtel — cycle de vie du certificat client mTLS

> **Statut : source-only, aucun relais activable.** Ce document définit les preuves attendues avant qu’une identité mTLS puisse seulement être considérée pour un relais. Il ne crée ni certificat, ni clé, ni politique Access, ni binding Worker, ni service, ni route, ni enrollment, ni publisher, ni routage, promotion, fencing ou bascule.

## État attesté et limite actuelle

Une CA publique a été **importée hors bande** dans Cloudflare Access et associée exclusivement au hostname `signer.lemtel.assistantvirtualai.com`. Cette importation conserve une racine de confiance potentielle, mais ne permet pas d’activer une policy, un Worker ou un relais. La policy `service_auth` reste absente et le default-deny demeure effectif.

Le bootstrap local historique crée une CA et un leaf de durée brève puis détruit la clé privée de CA. Ce leaf ne peut donc pas recevoir une rotation ni une révocation traçable sous le même émetteur : il est expressément interdit comme credential d’un relais actif. Le rapprochement de l’empreinte DER entre l’attestation DO et la CA importée reste requis ; une empreinte du fichier PEM ne constitue jamais une preuve substitutive.

La fallback locale durable possède seulement un bootstrap de racine source-only. Son émetteur de candidats est **compilé désactivé** tant que la preuve indépendante de chiffrement au repos et les autres gates ne sont pas réunies. Un candidat `candidate_prepared` n’est ni émis dans Access, ni actif, ni révocable, ni consommable par le relais.

## Identité, ancre et métadonnées admises

Toute identité future doit être dédiée au seul relais et utiliser le Common Name exact `lemtel-do-signer-mtls-relay` avec l’usage `clientAuth`. Les clés de nœud, de plateforme, d’arbitre, de fournisseur et de téléphonie sont interdites. Les contrats et les journaux ne peuvent contenir que des métadonnées publiques minimales : génération monotone, empreintes SHA-256 de l’ancre de confiance, de l’intermédiaire et du leaf, serial, bornes `notBefore`/`notAfter`, état et motif terminal. Aucun PEM, identifiant Cloudflare, clé privée ou credential ne doit être versionné.

Le format lifecycle v2 distingue l’ancre de confiance stable `trustAnchorFingerprint` de l’`intermediateFingerprint` direct. Chaque génération de leaf a un intermédiaire dédié et différent. Pendant une rotation, le successeur doit conserver l’ancre de confiance, mais avoir un intermédiaire, un leaf et un serial différents. Cette séparation évite qu’une rotation conforme soit traitée comme une dérive d’émetteur, sans permettre une nouvelle ancre implicite.

La machine d’état locale est pure et non activante. Elle reconnaît `issued`, `active`, `superseded`, `revoked` et `expired`, mais son meilleur résultat est `external_evidence_required`; elle ne peut jamais autoriser le relais, Access ni le failover. Elle ne persiste ni n’authentifie l’historique : une entrée absente n’est jamais une preuve d’absence et une validation structurelle n’est jamais une autorisation. L’opérateur doit donc fournir un historique autoritaire, exhaustif et revu hors de cet évaluateur.

Une durée de leaf est bornée à 24 heures. Un overlap de rotation stocke explicitement son début et sa fin et ne peut jamais dépasser 300 secondes; le successeur doit être actif avant le début de cette fenêtre et le leaf précédent doit ensuite devenir `superseded`. Un état `revoked` ou `expired` est terminal et ne peut pas être réactivé.

## Candidat local strictement séparé

Le futur émetteur root-only de candidats ne sera utilisable qu’après des gates externes séparées. Il déchiffre la racine locale seulement dans un tmpfs, émet un intermédiaire P-256 `CA:TRUE,pathlen:0` par génération, puis un leaf P-256 `CA:FALSE` avec `digitalSignature` et `clientAuth`. Il prépare seulement une paire de credentials chiffrés liée à l’hôte et une attestation redacted dans un répertoire de candidats distinct. Il n’écrit jamais `/etc/lemtel-platform-signer/credentials`, que le relais source-only réserverait aux credentials explicitement approuvés.

Aucun candidat ne constitue une activation. Sa suppression locale ne prouve pas une révocation et son existence ne doit déclencher ni import de CA, ni policy, ni binding, ni socket, ni service, ni enrollment, ni publication. Toute consommation éventuelle des credentials nécessite une opération future, distincte, revue et attestée.

## Preuves requises avant une activation future

Un émetteur durable, distinct du bootstrap éphémère, doit être approuvé et capable d’émettre, faire tourner et révoquer un leaf sans exposer de clé. Chaque émission, activation, rotation, révocation et rollback reste une décision humaine avec attestation externe. La révocation doit produire une preuve de refus par Access : une simple révocation du grant d’enrôlement ne révoque pas une identité mTLS.

Avant toute policy, il faut démontrer une requête avec le leaf exact acceptée et une requête refusée sans certificat, avec certificat révoqué, mauvais Common Name, sujet RFC2253 additionnel, mauvaise empreinte, mauvais émetteur, certificat expiré et configuration JWKS absente ou stale. Aucun de ces refus ne doit créer de claim anti-rejeu ni lire la clé de signature. Le test de rotation doit démontrer le passage du leaf actif au successeur avec overlap borné, puis le refus du leaf précédent. Tout échec, timeout, receipt incertain, état de lifecycle incomplet ou dérive de configuration exige une revue humaine et laisse le système fermé.

## Séquence explicitement exclue

Une future activation, si toutes les preuves existent, resterait limitée à une policy `service_auth` qui cible le Common Name exact et au signer de remise d’enrôlement. Elle ne confère aucune autorité sur DigitalOcean, Hostinger, PostgreSQL, DNS, Load Balancer, runtime, promotion, fencing, téléphonie ou failover. Les gates HA autoritaires restent indépendantes et la bascule automatique reste désactivée.

## Références

[1]: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/ "Cloudflare Access mutual TLS authentication"

[2]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/ "Cloudflare Access common policies"
