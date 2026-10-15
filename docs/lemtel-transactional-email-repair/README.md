# Réparation des courriels transactionnels Lemtel — source uniquement

> **État : non déployé.** Ce paquet ne configure pas Resend, ne contacte aucun fournisseur, ne modifie aucun environnement, et n’envoie aucun courriel. Toute migration, configuration, déploiement ou vérification externe exige une approbation explicite ultérieure sur le **writer DigitalOcean**. Hostinger reste privé et passif.

## Objet et limites

Cette révision ne concerne que les invitations de bienvenue et les récupérations de mot de passe **Lemtel** :

- modèles FR/EN accessibles et responsives, avec un mot de passe temporaire présent uniquement dans le HTML en mémoire ;
- état visible et véridique de la remise ;
- relance manuelle authentifiée après réparation de la configuration ;
- audit non secret et webhook signé facultatif pour confirmer une remise.

Elle ne contient aucune opération ni configuration de téléphonie, PBX, SIP, FusionPBX, Planiprêt, Avastatistic ou système legacy.

## Sémantique de remise

| État | Signification visible dans le portail | Source d’autorité |
|---|---|---|
| `pending` | La tentative est enregistrée et n’a pas encore de résultat fournisseur. | Serveur Lemtel |
| `provider_accepted` | Le fournisseur a accepté la requête API ; **la réception en boîte est inconnue**. | Réponse API fournisseur |
| `delivered` | Remise confirmée par un webhook fournisseur **signé**. Ce n’est pas une preuve de lecture. | Webhook Resend vérifié |
| `failed` | La requête n’a pas été acceptée par le fournisseur. | Serveur Lemtel |
| `needs_attention` | Le fournisseur signale un rebond/échec, ou une situation post-acceptation requiert une action. | Webhook signé ou serveur Lemtel |

Le portail distingue l’état d’accès (`activation en attente`, `actif`, `révoqué`) de l’état de remise et affiche la **langue demandée**. Il ne prétend jamais qu’un message est arrivé sur la seule base d’une acceptation API.

## Configuration à réaliser plus tard, hors bande

Aucune valeur ne doit être ajoutée au dépôt, aux manifests, aux journaux ou aux captures de diagnostic.

| Paramètre | Règle |
|---|---|
| `RESEND_API_KEY` | Secret configuré hors bande. La clé Resend actuelle signalée invalide ne doit pas être réutilisée, affichée ni créée par cette révision. |
| `LEMTEL_WELCOME_FROM` | Format `Lemtel <adresse@domaine>` (nom d’affichage reconnaissable Lemtel). Alternative : **les deux** `LEMTEL_EMAIL_SENDER_NAME` (contient Lemtel) et `LEMTEL_EMAIL_SENDER_ADDRESS`. |
| `LEMTEL_EMAIL_LOGO_URL` | Facultatif, **HTTPS strict**, sans credentials, query string ni fragment. S’il est absent, le modèle utilise un wordmark Lemtel inline, sans requête distante. |
| `LEMTEL_DOWNLOAD_IOS_URL`, `LEMTEL_DOWNLOAD_ANDROID_URL`, `LEMTEL_DOWNLOAD_DESKTOP_URL` | HTTPS strict, sans credentials, query string ni fragment. Des valeurs sûres par défaut existent ; une valeur configurée invalide fait échouer le préflight. |
| `RESEND_WEBHOOK_SECRET` | Seulement si le webhook est activé ultérieurement, hors bande. Jamais dans un bundle ou un rapport. |

Un défaut de validation renvoie une erreur générique et arrête l’opération **avant** la création d’un nouveau compte ou la rotation d’un mot de passe de relance. Le reset public reste générique pour ne pas énumérer les comptes.

## Modèles et confidentialité

`functions/_shared/lemtelTransactionalEmail.ts` est l’unique générateur de modèle. Il applique l’échappement HTML aux nom, email et mot de passe temporaire. La donnée secrète est uniquement intégrée au corps HTML transmis au fournisseur ; elle n’est pas mise en base, auditée, journalisée, ni retournée par les endpoints.

Le modèle de bienvenue contient le nom, l’email, le mot de passe temporaire à usage unique et les liens d’applications. Le modèle de récupération ne contient que le nom, l’email et le mot de passe temporaire. Aucun contenu distant arbitraire n’est rendu.

## Reprise d’une invitation en échec

1. Réparer et vérifier la configuration expéditeur/logo/URLs dans l’environnement cible, sans utiliser ni révéler l’ancienne clé invalide.
2. Vérifier le statut source-only et faire approuver la migration/déploiement séparément.
3. Un **administrateur d’organisation** ou un **administrateur de plateforme** authentifié ouvre *Accès et invitations* et choisit **Renvoyer l’accès** pour l’invitation `failed` ou `needs_attention`.
4. Le serveur valide la configuration avant de créer un nouveau mot de passe temporaire. Il enregistre `pending`, puis seulement `provider_accepted` si l’API l’accepte.
5. Ne pas effectuer de relance en masse automatique. Les comptes précédemment échoués restent récupérables au cas par cas, après réparation.

Pour une récupération de mot de passe, l’endpoint libère la fenêtre de throttling quand l’envoi fournisseur échoue ou lorsqu’une rotation Auth échoue après acceptation. Il ne retourne jamais le mot de passe. La rotation intervient après le préflight expéditeur et, pour le reset public, seulement après acceptation fournisseur afin de préserver le mot de passe actif si la requête fournisseur échoue.

## Webhook Resend (facultatif, sécurisé)

La fonction `lemtel-resend-delivery-webhook` n’accepte que `POST`, une signature Svix valide (`svix-id`, `svix-timestamp`, `svix-signature`) et les événements `email.sent`, `email.delivered`, `email.bounced`, `email.failed`. Elle :

- limite la taille et l’âge de signature ;
- corrèle seulement l’identifiant opaque du message fournisseur déjà enregistré ;
- ne persiste pas le corps du webhook, le contenu de mail, l’adresse de destinataire ni l’identifiant dans une réponse publique ;
- est idempotente et ne rétrograde pas un `delivered` confirmé.

**Pré-requis avant toute activation :** créer l’endpoint chez Resend hors bande, placer le secret hors bande, appliquer la migration approuvée, puis vérifier un événement synthétique signé. En l’absence de ce webhook, l’UX s’arrête honnêtement à `provider_accepted`.

## Diagnostic source-only

```bash
node scripts/lemtel-transactional-email-diagnostic.mjs \
  '{"mailConfiguration":{"providerApiConfigured":true,"senderConfigured":true,"logoConfigured":false,"webhookSecretConfigured":false},"publisher":{"present":false},"deliveryAttempts":{"pending":0,"provider_accepted":0,"delivered":0,"failed":2,"needs_attention":1}}'
```

Le script retourne uniquement des booléens de configuration, la présence du publisher et des compteurs par état. Il ne lit pas l’environnement, n’écrit rien, n’utilise pas le réseau, ne déploie pas et ne peut pas envoyer un courriel. Ne lui fournir ni secrets, ni adresses, ni payloads, ni mots de passe.

## Validation source

Les validations locales prévues, sans accès aux fournisseurs, sont :

```bash
deno test --node-modules-dir=auto \
  infra/lemtel-self-hosted/functions/_shared/lemtelTransactionalEmail.test.ts \
  infra/lemtel-self-hosted/functions/lemtel-resend-delivery-webhook/index.test.ts \
  infra/lemtel-self-hosted/functions/lemtel-onboarding-admin/index.test.ts
node --test scripts/lemtel-transactional-email-diagnostic.test.mjs scripts/lemtel-email-onboarding-contract.test.mjs
npx vitest run src/pages/lemtel/onboarding/__tests__/lemtelPortalContract.test.ts
git diff --check
```

Aucun de ces tests n’exécute l’envoi réel, ne contacte Resend, DigitalOcean, Hostinger, navigateur, realtime ou fournisseur de téléphonie.
