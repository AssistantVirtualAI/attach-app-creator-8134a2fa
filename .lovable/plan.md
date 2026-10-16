# Appels entrants coupés à ~30 s — preuve par traces SIP, puis correctif iPhone préparé

## Où on en est (honnête)
- **Preuves déjà acquises** : les fiches d'appel du système téléphonique montrent des entrants décrochés sur l'iPhone puis coupés après 21–32 s (1117 surtout, aussi 1136 et 1370). Les sortants tiennent. Les fiches des appareils sont identiques entre postes.
- **Pas encore prouvé** : la raison exacte. Je n'ai pas encore lu de trace SIP (les échanges détaillés entre le téléphone et le système). Le système téléphonique les fournit pour chaque appel ; c'est l'étape 1.
- **Hypothèse principale** (à confirmer) : le « bien reçu » (ACK) qui suit le décroché n'atteint pas le système. Dans l'app, l'adresse de retour annoncée au décroché est réécrite vers l'adresse publique du téléphone ; le système tente alors de joindre le téléphone par une nouvelle connexion, bloquée par le réseau, au lieu de réutiliser la connexion déjà ouverte. Il réessaie 32 s puis raccroche — ça colle exactement à la durée observée.
- **Hypothèses secondaires** : connexion sécurisée fermée/renouvelée par iOS juste après le décroché ; double enregistrement du même poste pendant l'appel.

## Étape 1 — Lire les traces SIP (lecture seule, aucun changement à l'app)
- Petit outil admin en lecture seule qui demande au système téléphonique la trace SIP d'un appel donné, et ne garde que les lignes utiles (types de messages, codes, heures, adresse de retour masquée). Aucun numéro client ni secret affiché.
- Comparer pour chaque poste (1117, 1136, 1370 + 113 et 1164 sans coupures) : 3 appels entrants coupés, 3 entrants réussis, 1 sortant.
- Ce qu'on cherche : présence ou absence du ACK, retransmissions du 200 OK, adresse de retour annoncée, fin d'appel envoyée par qui et avec quelle raison.
- Je te rapporte un tableau « preuve / hypothèse » et je te dis si une mise à jour de l'app est vraiment indispensable.

## Étape 2 — Correctif iPhone préparé (sans déploiement, sans soumission)
Seulement si l'étape 1 confirme la cause. Préparé dans le code de l'app, non installé, non soumis :
- Annoncer au décroché une adresse de retour qui réutilise la connexion déjà ouverte (mode « outbound », comme pour l'enregistrement), au lieu de la réécrire.
- Garder la connexion sécurisée active pendant tout l'appel (pas de renouvellement ou de fermeture par l'app).
- Bloquer tout ré-enregistrement du poste pendant un appel actif.
- Journal clair dans l'app : « ACK reçu » ou « ACK manquant » après chaque décroché.
- Même correctif reporté dans les modèles natifs pour survivre à la reconstruction de l'app.

## Étape 3 — Plan de tests (à faire après ton accord pour installer)
- Sur 1117, 1136, 1370, 113, 1164 : 3 appels entrants de plus de 2 min chacun (réseau Wi-Fi et cellulaire, app ouverte et écran verrouillé), 1 sortant de 2 min.
- Critère de succès : aucune coupure à ~30 s, ACK visible dans chaque trace, son dans les deux sens.
- Contrôle croisé : relire les traces SIP des appels tests avec l'outil de l'étape 1.

## Ce que je ne fais pas sans ton accord
- Aucune installation, mise à jour, soumission App Store ni changement de réglages du système téléphonique.

## Détails techniques
- Étape 1 : nouvelle fonction admin `pp-ns-call-trace` (lecture seule) basée sur l'action NS-API `getcalltrace` (docs/netsapiens/calls.md), réponse expurgée.
- Étape 2 : `PpPjsipEngine.swift` (`allow_contact_rewrite`/`contact_rewrite_method`, `use_rfc5626` avec `;ob`, `contact_use_src_port`, keep-alive TLS pendant l'appel), garde anti-REGISTER pendant appel dans `PpSipKeepAlive.swift`, mêmes changements dans `scripts/apply-native-config.mjs`.
